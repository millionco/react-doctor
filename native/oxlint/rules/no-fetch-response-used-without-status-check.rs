use oxc_ast::{
    AstKind,
    ast::{Argument, AssignmentTarget, CallExpression, Expression, Statement, TSType, TSTypeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const BODY_CONSUMER_METHODS: [&str; 5] = ["json", "text", "blob", "arrayBuffer", "formData"];
const STATUS_CHECK_PROPERTIES: [&str; 2] = ["ok", "status"];
const PROMISE_CHAIN_METHODS: [&str; 3] = ["then", "catch", "finally"];
const MAX_URL_BINDING_RESOLUTION_DEPTH: usize = 4;
const MESSAGE: &str = "`fetch()` resolves (does not reject) on HTTP 4xx/5xx, so this unchecked body read may treat an HTTP error payload like a successful response. Check `response.ok`/`response.status`, or deliberately handle the API's error payload, before reading the body.";

#[derive(Debug, Default, Clone)]
pub struct NoFetchResponseUsedWithoutStatusCheck;

#[derive(Default)]
struct FetchStatusAnalysis {
    return_node_ids_by_function: FxHashMap<NodeId, Vec<NodeId>>,
    validator_results: FxHashMap<(NodeId, usize), bool>,
    local_function_resolution: LocalFunctionResolutionCache,
}

declare_oxc_lint!(
    /// Require checking a fetch Response status before consuming its body.
    NoFetchResponseUsedWithoutStatusCheck,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require a fetch Response status check before body consumption.",
);

impl Rule for NoFetchResponseUsedWithoutStatusCheck {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
        let basename = filename
            .rsplit('/')
            .next()
            .unwrap_or(filename.as_str())
            .to_ascii_lowercase();
        !is_test_noise_file(ctx)
            && !basename.starts_with("gatsby-node.")
            && !basename.starts_with("gatsby-config.")
            && !basename.starts_with("gatsby-ssr.")
            && !basename.starts_with("gatsby-browser.")
            && !basename.contains(".config.")
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut analysis = FetchStatusAnalysis::default();
        let mut call_node_ids = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::ReturnStatement(_) => {
                    let function_id = fetch_status_nearest_function_or_program_id(node, ctx);
                    analysis
                        .return_node_ids_by_function
                        .entry(function_id)
                        .or_default()
                        .push(node.id());
                }
                AstKind::CallExpression(_) => call_node_ids.push(node.id()),
                _ => {}
            }
        }
        for node_id in call_node_ids {
            let node = ctx.nodes().get_node(node_id);
            let AstKind::CallExpression(fetch_call) = node.kind() else {
                unreachable!("indexed call expression")
            };
            fetch_status_check_fetch_call(node, fetch_call, &mut analysis, ctx);
        }
    }
}

fn fetch_status_check_fetch_call<'a>(
    node: &AstNode<'a>,
    fetch_call: &CallExpression<'a>,
    analysis: &mut FetchStatusAnalysis,
    ctx: &LintContext<'a>,
) {
    let Expression::Identifier(callee) = fetch_call.callee.get_inner_expression() else {
        return;
    };
    if callee.name != "fetch"
        || !ctx.is_reference_to_global_variable(callee)
        || fetch_status_fetches_inert_url(fetch_call, ctx)
    {
        return;
    }
    let fetch_root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(fetch_root.id());
    if fetch_status_direct_body_consumer(parent, fetch_root) {
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(fetch_call.span));
        return;
    }
    if let Some((member_object, property_name)) = fetch_status_member_parts(parent)
        && member_object.span() == fetch_root.span()
        && property_name.as_deref() == Some("then")
    {
        let then_root = transparent_expression_root(parent, ctx);
        let then_call_node = ctx.nodes().parent_node(then_root.id());
        let AstKind::CallExpression(then_call) = then_call_node.kind() else {
            return;
        };
        if then_call.callee.get_inner_expression().span() != then_root.span()
            || fetch_status_discarded_drain_has_rejection_handler(node, ctx)
        {
            return;
        }
        let Some(callback) = then_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let callback_node = ctx
            .nodes()
            .get_node(callback.get_inner_expression().node_id());
        let response_binding = match callback_node.kind() {
            AstKind::Function(function) => function
                .params
                .items
                .first()
                .and_then(|parameter| parameter.pattern.get_binding_identifier()),
            AstKind::ArrowFunctionExpression(function) => function
                .params
                .items
                .first()
                .and_then(|parameter| parameter.pattern.get_binding_identifier()),
            _ => None,
        };
        if let Some(response_binding) = response_binding
            && fetch_status_response_is_unguarded(
                response_binding.symbol_id(),
                callback_node.id(),
                false,
                analysis,
                ctx,
            )
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(fetch_call.span));
        }
        return;
    }
    let AstKind::AwaitExpression(_) = parent.kind() else {
        return;
    };
    let await_root = transparent_expression_root(parent, ctx);
    let after_await = ctx.nodes().parent_node(await_root.id());
    if fetch_status_direct_body_consumer(after_await, await_root) {
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(fetch_call.span));
        return;
    }
    let (response_symbol_id, can_be_undefined) = match after_await.kind() {
        AstKind::VariableDeclarator(declarator) => {
            let Some(binding) = declarator.id.get_binding_identifier() else {
                return;
            };
            (binding.symbol_id(), false)
        }
        AstKind::AssignmentExpression(assignment) => {
            let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left else {
                return;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return;
            };
            (symbol_id, true)
        }
        _ => return,
    };
    let owner_function_id = crate::ast_util::get_enclosing_function(after_await, ctx)
        .map(AstNode::id)
        .unwrap_or_else(|| ctx.nodes().iter().next().expect("program node").id());
    if fetch_status_response_is_unguarded(
        response_symbol_id,
        owner_function_id,
        can_be_undefined,
        analysis,
        ctx,
    ) {
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(fetch_call.span));
    }
}

fn fetch_status_direct_body_consumer(parent: &AstNode<'_>, receiver: &AstNode<'_>) -> bool {
    fetch_status_member_parts(parent).is_some_and(|(object, property_name)| {
        object.span() == receiver.span()
            && property_name
                .as_deref()
                .is_some_and(|name| BODY_CONSUMER_METHODS.contains(&name))
    })
}

fn fetch_status_member_parts<'a, 'node>(
    node: &'node AstNode<'a>,
) -> Option<(&'node Expression<'a>, Option<String>)> {
    match node.kind() {
        AstKind::StaticMemberExpression(member) => {
            Some((&member.object, Some(member.property.name.to_string())))
        }
        AstKind::ComputedMemberExpression(member) => Some((
            &member.object,
            member.static_property_name().map(|name| name.to_string()),
        )),
        AstKind::PrivateFieldExpression(member) => Some((&member.object, None)),
        _ => None,
    }
}

fn fetch_status_fetches_inert_url<'a>(call: &CallExpression<'a>, ctx: &LintContext<'a>) -> bool {
    call.arguments
        .first()
        .and_then(Argument::as_expression)
        .is_some_and(|argument| fetch_status_is_inert_url(argument, 0, ctx))
}

fn fetch_status_is_inert_url<'a>(
    expression: &Expression<'a>,
    depth: usize,
    ctx: &LintContext<'a>,
) -> bool {
    if depth > MAX_URL_BINDING_RESOLUTION_DEPTH {
        return false;
    }
    let expression = expression.get_inner_expression();
    let prefix = match expression {
        Expression::StringLiteral(literal) => Some(literal.value.as_str()),
        Expression::TemplateLiteral(template) => template.quasis.first().map(|quasi| {
            quasi
                .value
                .cooked
                .as_ref()
                .map_or(quasi.value.raw.as_str(), |value| value.as_str())
        }),
        Expression::BinaryExpression(binary) if binary.operator == BinaryOperator::Addition => {
            return fetch_status_is_inert_url(&binary.left, depth + 1, ctx);
        }
        _ => None,
    };
    if prefix.is_some_and(|prefix| {
        let prefix = prefix.to_ascii_lowercase();
        prefix.starts_with("data:") || prefix.starts_with("blob:")
    }) {
        return true;
    }
    match expression {
        Expression::NewExpression(construction) => {
            fetch_status_is_import_meta_asset_url(construction, depth, ctx)
        }
        Expression::ConditionalExpression(conditional) => {
            fetch_status_is_inert_url(&conditional.consequent, depth + 1, ctx)
                && fetch_status_is_inert_url(&conditional.alternate, depth + 1, ctx)
        }
        Expression::LogicalExpression(logical) => {
            fetch_status_is_inert_url(&logical.left, depth + 1, ctx)
                && fetch_status_is_inert_url(&logical.right, depth + 1, ctx)
        }
        Expression::Identifier(identifier) => {
            fetch_status_binding_is_assigned_from_require(identifier, ctx)
                || resolve_direct_unreassigned_initializer(identifier, ctx).is_some_and(
                    |initializer| fetch_status_is_inert_url(initializer, depth + 1, ctx),
                )
        }
        Expression::CallExpression(producer_call) => {
            let callee = producer_call.callee.get_inner_expression();
            if let Expression::Identifier(identifier) = callee {
                return identifier.name == "require"
                    && ctx.is_reference_to_global_variable(identifier);
            }
            let Some(member) = callee.as_member_expression() else {
                return false;
            };
            if !member.is_computed() && member.static_property_name() == Some("createObjectURL") {
                return matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "URL" && ctx.is_reference_to_global_variable(identifier));
            }
            if member.is_computed() || member.static_property_name() != Some("toDataURL") {
                return false;
            }
            let Expression::Identifier(canvas) = member.object().get_inner_expression() else {
                return false;
            };
            if fetch_status_symbol_has_canvas_type(canvas, ctx) {
                return true;
            }
            let Some(initializer) = resolve_direct_unreassigned_initializer(canvas, ctx) else {
                return false;
            };
            let Expression::CallExpression(create_element_call) =
                initializer.get_inner_expression()
            else {
                return false;
            };
            let Some(create_element_member) = create_element_call
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                return false;
            };
            create_element_member.static_property_name() == Some("createElement")
                && !create_element_member.is_computed()
                && matches!(create_element_member.object().get_inner_expression(), Expression::Identifier(document)
                    if document.name == "document" && ctx.is_reference_to_global_variable(document))
                && matches!(create_element_call.arguments.first(), Some(Argument::StringLiteral(literal)) if literal.value == "canvas")
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            !member.is_computed()
                && member.static_property_name() == Some("href")
                && fetch_status_is_inert_url(member.object(), depth + 1, ctx)
        }),
    }
}

fn fetch_status_is_import_meta_asset_url<'a>(
    construction: &oxc_ast::ast::NewExpression<'a>,
    depth: usize,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(callee) = construction.callee.get_inner_expression() else {
        return false;
    };
    if callee.name != "URL" || !ctx.is_reference_to_global_variable(callee) {
        return false;
    }
    let Some(path) = construction
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let path = path.get_inner_expression();
    let relative_path = match path {
        Expression::StringLiteral(literal) => {
            literal.value.starts_with("./") || literal.value.starts_with("../")
        }
        Expression::TemplateLiteral(template) => template.quasis.first().is_some_and(|quasi| {
            let prefix = quasi
                .value
                .cooked
                .as_ref()
                .map_or(quasi.value.raw.as_str(), |value| value.as_str());
            prefix.starts_with("./") || prefix.starts_with("../")
        }),
        Expression::BinaryExpression(binary) if binary.operator == BinaryOperator::Addition => {
            fetch_status_static_url_is_relative(&binary.left, depth + 1, ctx)
        }
        Expression::Identifier(identifier) => {
            resolve_direct_unreassigned_initializer(identifier, ctx).is_some_and(|initializer| {
                fetch_status_static_url_is_relative(initializer, depth + 1, ctx)
            })
        }
        _ => false,
    };
    if !relative_path {
        return false;
    }
    construction
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
        .and_then(Expression::as_member_expression)
        .is_some_and(|member| {
            !member.is_computed()
                && member.static_property_name() == Some("url")
                && matches!(
                    member.object().get_inner_expression(),
                    Expression::ImportMeta(_)
                )
        })
}

fn fetch_status_static_url_is_relative<'a>(
    expression: &Expression<'a>,
    depth: usize,
    ctx: &LintContext<'a>,
) -> bool {
    if depth > MAX_URL_BINDING_RESOLUTION_DEPTH {
        return false;
    }
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => {
            literal.value.starts_with("./") || literal.value.starts_with("../")
        }
        Expression::TemplateLiteral(template) => template.quasis.first().is_some_and(|quasi| {
            let prefix = quasi
                .value
                .cooked
                .as_ref()
                .map_or(quasi.value.raw.as_str(), |value| value.as_str());
            prefix.starts_with("./") || prefix.starts_with("../")
        }),
        Expression::BinaryExpression(binary) if binary.operator == BinaryOperator::Addition => {
            fetch_status_static_url_is_relative(&binary.left, depth + 1, ctx)
        }
        Expression::Identifier(identifier) => {
            resolve_direct_unreassigned_initializer(identifier, ctx).is_some_and(|initializer| {
                fetch_status_static_url_is_relative(initializer, depth + 1, ctx)
            })
        }
        _ => false,
    }
}

fn fetch_status_binding_is_assigned_from_require(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let writes = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .collect::<Vec<_>>();
    !writes.is_empty()
        && writes.iter().all(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            let AstKind::AssignmentExpression(assignment) = parent.kind() else {
                return false;
            };
            matches!(&assignment.left, AssignmentTarget::AssignmentTargetIdentifier(left)
                if left.span == reference_node.span())
                && fetch_status_is_global_require_call(&assignment.right, ctx)
        })
}

fn fetch_status_is_global_require_call(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::CallExpression(call)
        if matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "require" && ctx.is_reference_to_global_variable(identifier)))
}

fn fetch_status_symbol_has_canvas_type(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let annotation = match ctx.symbol_declaration(symbol_id).kind() {
        AstKind::VariableDeclarator(declarator) => declarator.type_annotation.as_ref(),
        AstKind::FormalParameter(parameter) => parameter.type_annotation.as_ref(),
        _ => None,
    };
    let Some(annotation) = annotation else {
        return false;
    };
    let TSType::TSTypeReference(type_reference) = &annotation.type_annotation else {
        return false;
    };
    matches!(&type_reference.type_name, TSTypeName::IdentifierReference(type_name)
        if matches!(type_name.name.as_str(), "HTMLCanvasElement" | "OffscreenCanvas"))
}

fn fetch_status_response_is_unguarded(
    response_symbol_id: SymbolId,
    owner_function_id: NodeId,
    can_be_undefined: bool,
    analysis: &mut FetchStatusAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    let response_symbol_ids = fetch_status_const_alias_symbol_ids(response_symbol_id, ctx);
    let mut consumptions = Vec::new();
    let mut status_references = Vec::new();
    let mut validator_calls = Vec::new();
    for symbol_id in &response_symbol_ids {
        for reference in ctx.scoping().get_resolved_references(*symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if fetch_status_nearest_function_or_program_id(reference_node, ctx) != owner_function_id
            {
                continue;
            }
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            if let Some((member_object, property_name)) = fetch_status_member_parts(parent)
                && member_object.span() == reference_root.span()
            {
                if property_name
                    .as_deref()
                    .is_some_and(|name| BODY_CONSUMER_METHODS.contains(&name))
                {
                    let member_root = transparent_expression_root(parent, ctx);
                    let call_node = ctx.nodes().parent_node(member_root.id());
                    if matches!(call_node.kind(), AstKind::CallExpression(call)
                        if call.callee.get_inner_expression().span() == member_root.span())
                    {
                        consumptions.push(call_node);
                    }
                } else if property_name
                    .as_deref()
                    .is_some_and(|name| STATUS_CHECK_PROPERTIES.contains(&name))
                    && fetch_status_is_condition_use(parent, ctx)
                {
                    status_references.push(FetchStatusReference {
                        node: parent,
                        is_ok: property_name.as_deref() == Some("ok"),
                    });
                }
            }
            if let AstKind::VariableDeclarator(declarator) = parent.kind()
                && declarator.init.as_ref().is_some_and(|initializer| {
                    initializer.get_inner_expression().span() == reference_root.span()
                })
                && let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id
            {
                for property in &pattern.properties {
                    let Some(property_name) = property.key.static_name() else {
                        continue;
                    };
                    if !STATUS_CHECK_PROPERTIES.contains(&property_name.as_ref()) {
                        continue;
                    }
                    let Some(binding) = property.value.get_binding_identifier() else {
                        continue;
                    };
                    let references = ctx
                        .scoping()
                        .get_resolved_references(binding.symbol_id())
                        .collect::<Vec<_>>();
                    if references.iter().any(|reference| reference.is_write()) {
                        continue;
                    }
                    for status_reference in references {
                        let status_node = ctx.nodes().get_node(status_reference.node_id());
                        if fetch_status_nearest_function_or_program_id(status_node, ctx)
                            == owner_function_id
                            && fetch_status_is_condition_use(status_node, ctx)
                        {
                            status_references.push(FetchStatusReference {
                                node: status_node,
                                is_ok: property_name.as_ref() == "ok",
                            });
                        }
                    }
                }
            }
            if let AstKind::CallExpression(call) = parent.kind()
                && call
                    .arguments
                    .iter()
                    .any(|argument| argument.span() == reference_root.span())
                && (fetch_status_known_validator_name(&call.callee)
                    || fetch_status_local_validator_checks_response_status(
                        call,
                        reference_root,
                        analysis,
                        ctx,
                    ))
            {
                validator_calls.push(parent);
            }
            if !can_be_undefined
                && let AstKind::UnaryExpression(unary) = parent.kind()
                && unary.operator == UnaryOperator::LogicalNot
                && fetch_status_is_condition_use(parent, ctx)
            {
                consumptions.push(parent);
            }
        }
    }
    !consumptions.is_empty()
        && consumptions.iter().any(|consumption| {
            !status_references.iter().any(|status_reference| {
                fetch_status_guard_protects(status_reference, consumption, owner_function_id, ctx)
            }) && !validator_calls
                .iter()
                .any(|validator| node_dominates_node(validator, consumption, ctx))
                && !fetch_status_consumption_result_is_guarded(
                    consumption,
                    &status_references,
                    owner_function_id,
                    ctx,
                )
        })
}

struct FetchStatusReference<'node, 'ast> {
    node: &'node AstNode<'ast>,
    is_ok: bool,
}

fn fetch_status_consumption_result_is_guarded<'a>(
    consumption: &AstNode<'a>,
    status_references: &[FetchStatusReference<'_, '_>],
    owner_function_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let mut result_root = transparent_expression_root(consumption, ctx);
    let parent = ctx.nodes().parent_node(result_root.id());
    if matches!(parent.kind(), AstKind::AwaitExpression(_)) {
        result_root = transparent_expression_root(parent, ctx);
    }
    let declarator_node = ctx.nodes().parent_node(result_root.id());
    if matches!(declarator_node.kind(), AstKind::ExpressionStatement(_)) {
        return status_references
            .iter()
            .any(|status_reference| status_reference.node.span().start > consumption.span().end);
    }
    let Some(result_symbol_id) = fetch_status_assigned_symbol_id(result_root, ctx) else {
        return false;
    };
    fetch_status_result_symbol_uses_are_guarded(
        result_symbol_id,
        status_references,
        owner_function_id,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn fetch_status_assigned_symbol_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<SymbolId> {
    let parent = ctx.nodes().parent_node(node.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == node.span()) =>
        {
            declarator
                .id
                .get_binding_identifier()
                .map(|binding| binding.symbol_id())
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign
                && assignment.right.span() == node.span() =>
        {
            let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left else {
                return None;
            };
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
        }
        _ => None,
    }
}

fn fetch_status_derived_symbol_id<'a>(
    reference: &AstNode<'a>,
    owner_function_id: NodeId,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let mut current = transparent_expression_root(reference, ctx);
    loop {
        if let Some(symbol_id) = fetch_status_assigned_symbol_id(current, ctx) {
            return Some(symbol_id);
        }
        let parent = ctx.nodes().parent_node(current.id());
        if parent.id() == owner_function_id {
            return None;
        }
        let carries_value = match parent.kind() {
            AstKind::StaticMemberExpression(member) => member.object.span() == current.span(),
            AstKind::ComputedMemberExpression(member) => member.object.span() == current.span(),
            AstKind::PrivateFieldExpression(member) => member.object.span() == current.span(),
            AstKind::CallExpression(call) => call
                .arguments
                .iter()
                .any(|argument| argument.span() == current.span()),
            _ => false,
        };
        if !carries_value {
            return None;
        }
        current = transparent_expression_root(parent, ctx);
    }
}

fn fetch_status_result_symbol_uses_are_guarded(
    symbol_id: SymbolId,
    status_references: &[FetchStatusReference<'_, '_>],
    owner_function_id: NodeId,
    ctx: &LintContext<'_>,
    pending_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if !pending_symbol_ids.insert(symbol_id) {
        return false;
    }
    let references = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_read())
        .map(|reference| ctx.nodes().get_node(reference.node_id()))
        .collect::<Vec<_>>();
    let result = !references.is_empty()
        && references.iter().all(|reference| {
            if fetch_status_nearest_function_or_program_id(reference, ctx) != owner_function_id {
                return false;
            }
            if status_references.iter().any(|status_reference| {
                fetch_status_guard_protects(status_reference, reference, owner_function_id, ctx)
            }) {
                return true;
            }
            fetch_status_derived_symbol_id(reference, owner_function_id, ctx).is_some_and(
                |derived_symbol_id| {
                    fetch_status_result_symbol_uses_are_guarded(
                        derived_symbol_id,
                        status_references,
                        owner_function_id,
                        ctx,
                        pending_symbol_ids,
                    )
                },
            )
        });
    pending_symbol_ids.remove(&symbol_id);
    result
}

fn fetch_status_const_alias_symbol_ids(
    root_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let mut symbol_ids = FxHashSet::from_iter([root_symbol_id]);
    let mut pending_symbol_ids = vec![root_symbol_id];
    while let Some(symbol_id) = pending_symbol_ids.pop() {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_root =
                transparent_expression_root(ctx.nodes().get_node(reference.node_id()), ctx);
            let declarator_node = ctx.nodes().parent_node(reference_root.id());
            let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
                continue;
            };
            let declaration = ctx.nodes().parent_node(declarator_node.id());
            if !matches!(declaration.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                || declarator.init.as_ref().is_none_or(|initializer| {
                    initializer.get_inner_expression().span() != reference_root.span()
                })
            {
                continue;
            }
            let Some(binding) = declarator.id.get_binding_identifier() else {
                continue;
            };
            if symbol_ids.insert(binding.symbol_id()) {
                pending_symbol_ids.push(binding.symbol_id());
            }
        }
    }
    symbol_ids
}

fn fetch_status_is_condition_use<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let mut current = transparent_expression_root(node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::IfStatement(statement)
                if statement.test.span().contains_inclusive(current.span()) =>
            {
                return true;
            }
            AstKind::ConditionalExpression(expression)
                if expression.test.span().contains_inclusive(current.span()) =>
            {
                return true;
            }
            AstKind::WhileStatement(statement)
                if statement.test.span().contains_inclusive(current.span()) =>
            {
                return true;
            }
            AstKind::DoWhileStatement(statement)
                if statement.test.span().contains_inclusive(current.span()) =>
            {
                return true;
            }
            AstKind::ForStatement(statement)
                if statement
                    .test
                    .as_ref()
                    .is_some_and(|test| test.span().contains_inclusive(current.span())) =>
            {
                return true;
            }
            AstKind::SwitchStatement(statement)
                if statement
                    .discriminant
                    .span()
                    .contains_inclusive(current.span()) =>
            {
                return true;
            }
            AstKind::SwitchCase(case)
                if case
                    .test
                    .as_ref()
                    .is_some_and(|test| test.span().contains_inclusive(current.span())) =>
            {
                return true;
            }
            AstKind::LogicalExpression(expression) if expression.left.span() == current.span() => {
                return true;
            }
            AstKind::UnaryExpression(_)
            | AstKind::BinaryExpression(_)
            | AstKind::LogicalExpression(_)
            | AstKind::ConditionalExpression(_) => {
                current = transparent_expression_root(parent, ctx)
            }
            _ => return false,
        }
    }
}

fn fetch_status_guard_protects(
    status_reference: &FetchStatusReference<'_, '_>,
    consumption: &AstNode<'_>,
    owner_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let status_node = status_reference.node;
    for ancestor in ctx.nodes().ancestors(consumption.id()) {
        if ancestor.id() == owner_function_id {
            break;
        }
        match ancestor.kind() {
            AstKind::IfStatement(statement)
                if (statement
                    .consequent
                    .span()
                    .contains_inclusive(consumption.span())
                    && fetch_status_expression_guarantees_reference(
                        &statement.test,
                        status_node.span(),
                        true,
                        false,
                    ))
                    || (statement.alternate.as_ref().is_some_and(|alternate| {
                        alternate.span().contains_inclusive(consumption.span())
                    }) && fetch_status_expression_guarantees_reference(
                        &statement.test,
                        status_node.span(),
                        false,
                        false,
                    )) =>
            {
                return true;
            }
            AstKind::ConditionalExpression(expression)
                if (expression
                    .consequent
                    .span()
                    .contains_inclusive(consumption.span())
                    && fetch_status_expression_guarantees_reference(
                        &expression.test,
                        status_node.span(),
                        true,
                        false,
                    ))
                    || (expression
                        .alternate
                        .span()
                        .contains_inclusive(consumption.span())
                        && fetch_status_expression_guarantees_reference(
                            &expression.test,
                            status_node.span(),
                            false,
                            false,
                        )) =>
            {
                return true;
            }
            AstKind::LogicalExpression(expression)
                if expression
                    .right
                    .span()
                    .contains_inclusive(consumption.span())
                    && ((expression.operator == LogicalOperator::And
                        && fetch_status_expression_guarantees_reference(
                            &expression.left,
                            status_node.span(),
                            true,
                            false,
                        ))
                        || (expression.operator == LogicalOperator::Or
                            && fetch_status_expression_guarantees_reference(
                                &expression.left,
                                status_node.span(),
                                false,
                                false,
                            ))) =>
            {
                return true;
            }
            AstKind::WhileStatement(statement)
                if fetch_status_expression_guarantees_reference(
                    &statement.test,
                    status_node.span(),
                    true,
                    false,
                ) && statement.body.span().contains_inclusive(consumption.span()) =>
            {
                return true;
            }
            AstKind::ForStatement(statement)
                if statement.test.as_ref().is_some_and(|test| {
                    fetch_status_expression_guarantees_reference(
                        test,
                        status_node.span(),
                        true,
                        false,
                    )
                }) && statement.body.span().contains_inclusive(consumption.span()) =>
            {
                return true;
            }
            _ => {}
        }
    }
    for ancestor in ctx.nodes().ancestors(consumption.id()) {
        if ancestor.id() == owner_function_id && !matches!(ancestor.kind(), AstKind::Program(_)) {
            break;
        }
        let statements = match ancestor.kind() {
            AstKind::BlockStatement(block) => block.body.as_slice(),
            AstKind::FunctionBody(body) => body.statements.as_slice(),
            AstKind::Program(program) => program.body.as_slice(),
            _ => continue,
        };
        let Some(consumption_statement_index) = statements
            .iter()
            .position(|statement| statement.span().contains_inclusive(consumption.span()))
        else {
            continue;
        };
        if statements[..consumption_statement_index]
            .iter()
            .any(|candidate| {
                let Statement::IfStatement(statement) = candidate else {
                    return false;
                };
                let consequent_exit_guards =
                    fetch_status_statement_is_early_exit(&statement.consequent)
                        && fetch_status_expression_guarantees_reference(
                            &statement.test,
                            status_node.span(),
                            false,
                            false,
                        )
                        && (!status_reference.is_ok
                            || fetch_status_expression_guarantees_reference(
                                &statement.test,
                                status_node.span(),
                                false,
                                true,
                            ));
                let alternate_exit_guards = statement.alternate.as_ref().is_some_and(|alternate| {
                    fetch_status_statement_is_early_exit(alternate)
                        && fetch_status_expression_guarantees_reference(
                            &statement.test,
                            status_node.span(),
                            true,
                            false,
                        )
                        && (!status_reference.is_ok
                            || fetch_status_expression_guarantees_reference(
                                &statement.test,
                                status_node.span(),
                                true,
                                true,
                            ))
                });
                consequent_exit_guards || alternate_exit_guards
            })
        {
            return true;
        }
    }
    false
}

fn fetch_status_expression_guarantees_reference(
    expression: &Expression<'_>,
    reference_span: oxc_span::Span,
    branch_runs_when_truthy: bool,
    must_guarantee_truthy_reference: bool,
) -> bool {
    let expression = expression.without_parentheses();
    if expression.span() == reference_span
        && (matches!(expression, Expression::Identifier(_))
            || expression.as_member_expression().is_some())
    {
        return !must_guarantee_truthy_reference || branch_runs_when_truthy;
    }
    if !expression.span().contains_inclusive(reference_span) {
        return false;
    }
    match expression {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            fetch_status_expression_guarantees_reference(
                &unary.argument,
                reference_span,
                !branch_runs_when_truthy,
                must_guarantee_truthy_reference,
            )
        }
        Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::And => {
            if branch_runs_when_truthy {
                fetch_status_expression_guarantees_reference(
                    &logical.left,
                    reference_span,
                    true,
                    must_guarantee_truthy_reference,
                ) || fetch_status_expression_guarantees_reference(
                    &logical.right,
                    reference_span,
                    true,
                    must_guarantee_truthy_reference,
                )
            } else {
                fetch_status_expression_guarantees_reference(
                    &logical.left,
                    reference_span,
                    false,
                    must_guarantee_truthy_reference,
                ) && (fetch_status_expression_guarantees_reference(
                    &logical.left,
                    reference_span,
                    true,
                    must_guarantee_truthy_reference,
                ) || fetch_status_expression_guarantees_reference(
                    &logical.right,
                    reference_span,
                    false,
                    must_guarantee_truthy_reference,
                ))
            }
        }
        Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::Or => {
            if branch_runs_when_truthy {
                fetch_status_expression_guarantees_reference(
                    &logical.left,
                    reference_span,
                    true,
                    must_guarantee_truthy_reference,
                ) && (fetch_status_expression_guarantees_reference(
                    &logical.left,
                    reference_span,
                    false,
                    must_guarantee_truthy_reference,
                ) || fetch_status_expression_guarantees_reference(
                    &logical.right,
                    reference_span,
                    true,
                    must_guarantee_truthy_reference,
                ))
            } else {
                fetch_status_expression_guarantees_reference(
                    &logical.left,
                    reference_span,
                    false,
                    must_guarantee_truthy_reference,
                ) || fetch_status_expression_guarantees_reference(
                    &logical.right,
                    reference_span,
                    false,
                    must_guarantee_truthy_reference,
                )
            }
        }
        Expression::ConditionalExpression(conditional) => {
            let test_always_checks = fetch_status_expression_guarantees_reference(
                &conditional.test,
                reference_span,
                true,
                must_guarantee_truthy_reference,
            ) && fetch_status_expression_guarantees_reference(
                &conditional.test,
                reference_span,
                false,
                must_guarantee_truthy_reference,
            );
            test_always_checks
                || (fetch_status_expression_guarantees_reference(
                    &conditional.consequent,
                    reference_span,
                    branch_runs_when_truthy,
                    must_guarantee_truthy_reference,
                ) && fetch_status_expression_guarantees_reference(
                    &conditional.alternate,
                    reference_span,
                    branch_runs_when_truthy,
                    must_guarantee_truthy_reference,
                ))
        }
        _ => !must_guarantee_truthy_reference,
    }
}

fn fetch_status_statement_is_early_exit(statement: &Statement<'_>) -> bool {
    if statement_always_exits(statement) {
        return true;
    }
    match statement {
        Statement::ContinueStatement(_) | Statement::BreakStatement(_) => true,
        Statement::BlockStatement(block) => block
            .body
            .last()
            .is_some_and(fetch_status_statement_is_early_exit),
        _ => false,
    }
}

fn fetch_status_known_validator_name(callee: &Expression<'_>) -> bool {
    let name = match callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(|member| member.static_property_name()),
    };
    name.is_some_and(|name| {
        let lowercase = name.to_ascii_lowercase();
        ["assert", "check", "ensure", "require", "throw", "validate"]
            .iter()
            .any(|prefix| lowercase.starts_with(prefix))
    })
}

fn fetch_status_local_validator_checks_response_status<'a>(
    call: &CallExpression<'a>,
    response_reference: &AstNode<'a>,
    analysis: &mut FetchStatusAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(argument_index) = call
        .arguments
        .iter()
        .position(|argument| argument.span() == response_reference.span())
    else {
        return false;
    };
    let Some(function_id) = fetch_status_exact_local_function_id(&call.callee, analysis, ctx)
    else {
        return false;
    };
    if let Some(result) = analysis
        .validator_results
        .get(&(function_id, argument_index))
    {
        return *result;
    }
    let function_node = ctx.nodes().get_node(function_id);
    let parameter = match function_node.kind() {
        AstKind::Function(function) => function.params.items.get(argument_index),
        AstKind::ArrowFunctionExpression(function) => function.params.items.get(argument_index),
        _ => None,
    };
    let Some(parameter_symbol_id) = parameter
        .and_then(|parameter| parameter.pattern.get_binding_identifier())
        .map(|identifier| identifier.symbol_id())
    else {
        return false;
    };
    let has_response_shape_guard =
        fetch_status_function_has_response_shape_guard(function_node, parameter_symbol_id, ctx);
    let mut returned_expressions = Vec::new();
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        returned_expressions.push(expression);
    } else {
        returned_expressions.extend(
            analysis
                .return_node_ids_by_function
                .get(&function_id)
                .into_iter()
                .flatten()
                .filter_map(|node_id| {
                    let AstKind::ReturnStatement(statement) = ctx.nodes().get_node(*node_id).kind()
                    else {
                        return None;
                    };
                    statement.argument.as_ref()
                }),
        );
    }
    let status_aware_return_count = returned_expressions
        .iter()
        .filter(|expression| {
            fetch_status_expression_reads_parameter_status(expression, parameter_symbol_id, ctx)
        })
        .count();
    let result = status_aware_return_count > 0
        && returned_expressions.iter().all(|expression| {
            fetch_status_expression_reads_parameter_status(expression, parameter_symbol_id, ctx)
                || fetch_status_boolean_return_is_status_guarded(
                    expression,
                    function_id,
                    parameter_symbol_id,
                    ctx,
                )
                || (has_response_shape_guard
                    && matches!(
                        expression.get_inner_expression(),
                        Expression::BooleanLiteral(_)
                    ))
        });
    analysis
        .validator_results
        .insert((function_id, argument_index), result);
    result
}

fn fetch_status_exact_local_function_id<'a>(
    expression: &Expression<'a>,
    analysis: &mut FetchStatusAnalysis,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    exact_local_function_id_including_generators(
        expression,
        ctx,
        &mut Vec::new(),
        &mut analysis.local_function_resolution,
    )
}

fn fetch_status_function_has_response_shape_guard(
    function_node: &AstNode<'_>,
    parameter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let statements = match function_node.kind() {
        AstKind::Function(function) => function
            .body
            .as_ref()
            .map(|body| body.statements.as_slice()),
        AstKind::ArrowFunctionExpression(function) => function
            .body
            .as_function_body()
            .map(|body| body.statements.as_slice()),
        _ => None,
    };
    statements.is_some_and(|statements| {
        statements.iter().any(|statement| {
            let Statement::IfStatement(if_statement) = statement else {
                return false;
            };
            fetch_status_statement_is_early_exit(&if_statement.consequent)
                && fetch_status_test_has_typed_parameter_status_property(
                    &if_statement.test,
                    parameter_symbol_id,
                    ctx,
                )
                && fetch_status_statement_reads_parameter_status(
                    &if_statement.consequent,
                    parameter_symbol_id,
                    ctx,
                )
        })
    })
}

fn fetch_status_test_has_typed_parameter_status_property(
    test: &Expression<'_>,
    parameter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(parameter_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if !test.span().contains_inclusive(reference_node.span()) {
                return false;
            }
            let reference_root = transparent_expression_root(reference_node, ctx);
            let member_node = ctx.nodes().parent_node(reference_root.id());
            let Some((member_object, property_name)) = fetch_status_member_parts(member_node)
            else {
                return false;
            };
            if member_object.span() != reference_root.span() {
                return false;
            }
            let expected_type = match property_name.as_deref() {
                Some("ok") => "boolean",
                Some("status") => "number",
                _ => return false,
            };
            let member_root = transparent_expression_root(member_node, ctx);
            let unary_node = ctx.nodes().parent_node(member_root.id());
            let AstKind::UnaryExpression(unary) = unary_node.kind() else {
                return false;
            };
            if unary.operator != UnaryOperator::Typeof
                || unary.argument.span() != member_root.span()
            {
                return false;
            }
            let unary_root = transparent_expression_root(unary_node, ctx);
            let binary_node = ctx.nodes().parent_node(unary_root.id());
            let AstKind::BinaryExpression(binary) = binary_node.kind() else {
                return false;
            };
            if !matches!(
                binary.operator,
                BinaryOperator::Equality | BinaryOperator::StrictEquality
            ) {
                return false;
            }
            let type_literal = if binary.left.span() == unary_root.span() {
                &binary.right
            } else if binary.right.span() == unary_root.span() {
                &binary.left
            } else {
                return false;
            };
            matches!(type_literal.get_inner_expression(), Expression::StringLiteral(literal)
                if literal.value == expected_type)
        })
}

fn fetch_status_statement_reads_parameter_status(
    statement: &Statement<'_>,
    parameter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let statement_span = statement.span();
    ctx.scoping()
        .get_resolved_references(parameter_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            statement_span.contains_inclusive(reference_node.span())
                && fetch_status_reference_reads_status_property(reference_node, ctx)
        })
}

fn fetch_status_expression_reads_parameter_status(
    expression: &Expression<'_>,
    parameter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let expression_span = expression.span();
    ctx.scoping()
        .get_resolved_references(parameter_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            expression_span.contains_inclusive(reference_node.span())
                && fetch_status_reference_reads_status_property(reference_node, ctx)
        })
}

fn fetch_status_reference_reads_status_property<'a, 'node>(
    reference_node: &'node AstNode<'a>,
    ctx: &'node LintContext<'a>,
) -> bool {
    let reference_root = transparent_expression_root(reference_node, ctx);
    let parent = ctx.nodes().parent_node(reference_root.id());
    fetch_status_member_parts(parent).is_some_and(|(object, property_name)| {
        object.span() == reference_root.span()
            && property_name
                .as_deref()
                .is_some_and(|name| STATUS_CHECK_PROPERTIES.contains(&name))
    })
}

fn fetch_status_boolean_return_is_status_guarded(
    expression: &Expression<'_>,
    function_id: NodeId,
    parameter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    if !matches!(
        expression.get_inner_expression(),
        Expression::BooleanLiteral(_)
    ) {
        return false;
    }
    let expression_node = ctx
        .nodes()
        .get_node(expression.get_inner_expression().node_id());
    for ancestor in ctx.nodes().ancestors(expression_node.id()) {
        if ancestor.id() == function_id {
            break;
        }
        if let AstKind::IfStatement(if_statement) = ancestor.kind()
            && if_statement
                .consequent
                .span()
                .contains_inclusive(expression.span())
            && fetch_status_expression_reads_parameter_status(
                &if_statement.test,
                parameter_symbol_id,
                ctx,
            )
        {
            return true;
        }
    }
    false
}

fn fetch_status_discarded_drain_has_rejection_handler<'a>(
    fetch_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut chain_link = transparent_expression_root(fetch_node, ctx);
    let mut saw_rejection_handler = false;
    loop {
        let member_node = ctx.nodes().parent_node(chain_link.id());
        let Some((member_object, property_name)) = fetch_status_member_parts(member_node) else {
            break;
        };
        let Some(method_name) = property_name else {
            break;
        };
        if member_object.span() != chain_link.span()
            || !PROMISE_CHAIN_METHODS.contains(&method_name.as_str())
        {
            break;
        }
        let member_root = transparent_expression_root(member_node, ctx);
        let call_node = ctx.nodes().parent_node(member_root.id());
        let AstKind::CallExpression(call) = call_node.kind() else {
            break;
        };
        if call.callee.get_inner_expression().span() != member_root.span() {
            break;
        }
        if method_name == "then" {
            if call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|handler| !fetch_status_is_pure_drain_handler(handler, ctx))
            {
                return false;
            }
            if call.arguments.get(1).is_some() {
                saw_rejection_handler = true;
            }
        } else if method_name == "catch" && !call.arguments.is_empty() {
            saw_rejection_handler = true;
        }
        chain_link = transparent_expression_root(call_node, ctx);
    }
    saw_rejection_handler
        && matches!(
            ctx.nodes().parent_node(chain_link.id()).kind(),
            AstKind::ExpressionStatement(_)
        )
}

fn fetch_status_is_pure_drain_handler(handler: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let Expression::ArrowFunctionExpression(function) = handler.get_inner_expression() else {
        return false;
    };
    let Some(parameter) = function
        .params
        .items
        .first()
        .and_then(|parameter| parameter.pattern.get_binding_identifier())
    else {
        return false;
    };
    let Some(body) = function.get_expression() else {
        return false;
    };
    match body.get_inner_expression() {
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            == Some(parameter.symbol_id()),
        Expression::CallExpression(call) => call
            .callee
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|member| {
                member
                    .static_property_name()
                    .is_some_and(|name| BODY_CONSUMER_METHODS.contains(&name))
                    && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(parameter.symbol_id()))
            }),
        _ => false,
    }
}

fn fetch_status_nearest_function_or_program_id<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> NodeId {
    crate::ast_util::get_enclosing_function(node, ctx)
        .map(AstNode::id)
        .unwrap_or_else(|| ctx.nodes().iter().next().expect("program node").id())
}
