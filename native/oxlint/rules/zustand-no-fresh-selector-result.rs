use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{LogicalOperator, UnaryOperator};
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str = "This Zustand selector creates a new reference whenever the store is read, so Object.is never sees a stable snapshot and Zustand v5 can repeatedly render or hit maximum update depth. Select a stable field or use `useShallow`.";
const ALLOCATING_ARRAY_METHODS: [&str; 8] = [
    "filter",
    "flat",
    "flatMap",
    "map",
    "toReversed",
    "toSorted",
    "toSpliced",
    "with",
];
const SAME_REFERENCE_ARRAY_METHODS: [&str; 2] = ["reverse", "sort"];
const STORE_API_METHODS: [&str; 4] = ["setState", "getState", "subscribe", "getInitialState"];

#[derive(Debug, Default, Clone)]
pub struct ZustandNoFreshSelectorResult;

declare_oxc_lint!(
    /// Disallow fresh values returned from Zustand selectors.
    ZustandNoFreshSelectorResult,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Zustand selector returns a fresh value.",
);

#[derive(Clone, Copy)]
enum ZustandFreshSelectorKind {
    Array,
    Function,
    Instance,
    Object,
}

#[derive(Clone, Copy)]
struct ZustandFreshSelectorResult {
    kind: ZustandFreshSelectorKind,
    span: Span,
}

#[derive(Clone, Copy)]
struct ZustandFreshBoundStore {
    creator_function_id: Option<NodeId>,
    has_default_equality: bool,
    supports_equality_argument: bool,
}

#[derive(Clone, Copy)]
struct ZustandFreshSelectorCall<'a> {
    selector: &'a Expression<'a>,
    creator_function_id: Option<NodeId>,
}

impl Rule for ZustandNoFreshSelectorResult {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            let Some(selector_call) = zustand_fresh_selector_call(
                call,
                ctx,
                &mut resolution_cache,
                &mut FxHashSet::default(),
            ) else {
                continue;
            };
            let Some(selector_function_id) = zustand_fresh_selector_function_id(
                selector_call.selector,
                ctx,
                &mut resolution_cache,
                &mut FxHashSet::default(),
            ) else {
                continue;
            };
            let Some(result) = zustand_fresh_selector_return(
                selector_function_id,
                selector_call.creator_function_id,
                ctx,
            ) else {
                continue;
            };
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(result.span));
        }
    }
}

fn zustand_fresh_selector_call<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<ZustandFreshSelectorCall<'a>> {
    if let Some(api_binding) = resolve_zustand_api_binding(&call.callee, ctx)
        && matches!(
            api_binding.api_name,
            ZustandApiName::UseStore | ZustandApiName::UseStoreWithEqualityFn
        )
    {
        let selector = call.arguments.get(1)?.as_expression()?;
        if api_binding.api_name == ZustandApiName::UseStoreWithEqualityFn
            && zustand_has_explicit_equality_argument(&call.arguments, 2, ctx)
        {
            return None;
        }
        return Some(ZustandFreshSelectorCall {
            selector,
            creator_function_id: None,
        });
    }

    let bound_store =
        zustand_fresh_bound_store(&call.callee, ctx, resolution_cache, visited_symbol_ids)?;
    let selector = call.arguments.first()?.as_expression()?;
    if bound_store.has_default_equality
        || (bound_store.supports_equality_argument
            && zustand_has_explicit_equality_argument(&call.arguments, 1, ctx))
    {
        return None;
    }
    Some(ZustandFreshSelectorCall {
        selector,
        creator_function_id: bound_store.creator_function_id,
    })
}

fn zustand_has_explicit_equality_argument(
    arguments: &[Argument<'_>],
    index: usize,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(argument) = arguments.get(index) else {
        return false;
    };
    let Some(expression) = argument.as_expression() else {
        return true;
    };
    !zustand_is_nullish_equality_argument(expression, ctx)
}

fn zustand_is_nullish_equality_argument(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        Expression::NullLiteral(_) => true,
        Expression::UnaryExpression(unary) => unary.operator == UnaryOperator::Void,
        _ => false,
    }
}

fn zustand_fresh_bound_store<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<ZustandFreshBoundStore> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited_symbol_ids.insert(symbol_id)
        || cached_symbol_has_write(symbol_id, ctx, resolution_cache)
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return None;
    };
    if !variable_declaration.kind.is_const()
        || zustand_fresh_destructured_property_name(&declarator.id, symbol_id)
            .is_some_and(|property_name| STORE_API_METHODS.contains(&property_name.as_str()))
    {
        return None;
    }
    let initializer = binding_pattern_initializer_for_symbol(
        &declarator.id,
        symbol_id,
        declarator.init.as_ref(),
    )?;
    if let Some(store) = zustand_fresh_store_creation(initializer, ctx, resolution_cache) {
        return Some(store);
    }
    zustand_fresh_bound_store(initializer, ctx, resolution_cache, visited_symbol_ids)
}

fn zustand_fresh_store_creation<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<ZustandFreshBoundStore> {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return None;
    };
    let factory_call = resolve_zustand_store_factory_call(call, ctx)?;
    if !matches!(
        factory_call.factory_api_name,
        ZustandStoreFactoryApi::Create | ZustandStoreFactoryApi::CreateWithEqualityFn
    ) {
        return None;
    }
    let creator_function_id = resolve_zustand_store_creator(call, ctx, resolution_cache)
        .map(|creator| creator.creator_function_id);
    let supports_equality_argument =
        factory_call.factory_api_name == ZustandStoreFactoryApi::CreateWithEqualityFn;
    Some(ZustandFreshBoundStore {
        creator_function_id,
        has_default_equality: supports_equality_argument
            && zustand_has_explicit_equality_argument(&call.arguments, 1, ctx),
        supports_equality_argument,
    })
}

fn zustand_fresh_destructured_property_name(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
) -> Option<String> {
    match pattern {
        BindingPattern::ObjectPattern(object) => object.properties.iter().find_map(|property| {
            if zustand_fresh_direct_binding_matches(&property.value, symbol_id) {
                return property.key.static_name().map(|name| name.to_string());
            }
            zustand_fresh_destructured_property_name(&property.value, symbol_id)
        }),
        BindingPattern::ArrayPattern(array) => array
            .elements
            .iter()
            .flatten()
            .find_map(|element| zustand_fresh_destructured_property_name(element, symbol_id)),
        BindingPattern::AssignmentPattern(assignment) => {
            zustand_fresh_destructured_property_name(&assignment.left, symbol_id)
        }
        BindingPattern::BindingIdentifier(_) => None,
    }
}

fn zustand_fresh_direct_binding_matches(pattern: &BindingPattern<'_>, symbol_id: SymbolId) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(binding) => binding.symbol_id() == symbol_id,
        BindingPattern::AssignmentPattern(assignment) => {
            matches!(&assignment.left, BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id)
        }
        _ => false,
    }
}

fn zustand_fresh_selector_function_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::CallExpression(call) => {
            if resolve_zustand_api_binding(&call.callee, ctx)
                .is_some_and(|binding| binding.api_name == ZustandApiName::UseShallow)
                || !is_react_api_call(call, "useCallback", ctx)
            {
                return None;
            }
            zustand_fresh_selector_function_id(
                call.arguments.first()?.as_expression()?,
                ctx,
                resolution_cache,
                visited_symbol_ids,
            )
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id)
                || cached_symbol_has_write(symbol_id, ctx, resolution_cache)
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            if matches!(declaration.kind(), AstKind::Function(_)) {
                return Some(declaration.id());
            }
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let AstKind::VariableDeclaration(variable_declaration) =
                ctx.nodes().parent_node(declaration.id()).kind()
            else {
                return None;
            };
            if !variable_declaration.kind.is_const() {
                return None;
            }
            zustand_fresh_selector_function_id(
                binding_pattern_initializer_for_symbol(
                    &declarator.id,
                    symbol_id,
                    declarator.init.as_ref(),
                )?,
                ctx,
                resolution_cache,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn zustand_fresh_selector_return(
    selector_function_id: NodeId,
    creator_function_id: Option<NodeId>,
    ctx: &LintContext<'_>,
) -> Option<ZustandFreshSelectorResult> {
    if let AstKind::ArrowFunctionExpression(function) =
        ctx.nodes().get_node(selector_function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        let first_parameter_symbol_id =
            function
                .params
                .items
                .first()
                .and_then(|parameter| match &parameter.pattern {
                    BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
                    _ => None,
                });
        return zustand_resolve_fresh_selector_result(
            expression,
            first_parameter_symbol_id,
            creator_function_id,
            ctx,
            &mut FxHashSet::default(),
        );
    }
    let first_parameter_symbol_id = match ctx.nodes().get_node(selector_function_id).kind() {
        AstKind::Function(function) => {
            function
                .params
                .items
                .first()
                .and_then(|parameter| match &parameter.pattern {
                    BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
                    _ => None,
                })
        }
        AstKind::ArrowFunctionExpression(function) => {
            function
                .params
                .items
                .first()
                .and_then(|parameter| match &parameter.pattern {
                    BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
                    _ => None,
                })
        }
        _ => return None,
    };
    ctx.nodes().iter().find_map(|candidate| {
        let AstKind::ReturnStatement(statement) = candidate.kind() else {
            return None;
        };
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(selector_function_id) {
            return None;
        }
        zustand_resolve_fresh_selector_result(
            statement.argument.as_ref()?,
            first_parameter_symbol_id,
            creator_function_id,
            ctx,
            &mut FxHashSet::default(),
        )
    })
}

fn zustand_resolve_fresh_selector_result(
    expression: &Expression<'_>,
    selector_parameter_symbol_id: Option<SymbolId>,
    creator_function_id: Option<NodeId>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<ZustandFreshSelectorResult> {
    let span = expression.get_inner_expression().span();
    if let Some(kind) = zustand_fresh_render_value_kind(expression, ctx, &mut FxHashSet::default())
    {
        return Some(ZustandFreshSelectorResult { kind, span });
    }
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => {
            return zustand_fresh_result_from_call(
                call,
                selector_parameter_symbol_id,
                creator_function_id,
                ctx,
                visited_symbol_ids,
            );
        }
        Expression::ConditionalExpression(conditional) => {
            return zustand_resolve_fresh_selector_result(
                &conditional.consequent,
                selector_parameter_symbol_id,
                creator_function_id,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
            .or_else(|| {
                zustand_resolve_fresh_selector_result(
                    &conditional.alternate,
                    selector_parameter_symbol_id,
                    creator_function_id,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                )
            });
        }
        Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::And => {
            return zustand_resolve_fresh_selector_result(
                &logical.right,
                selector_parameter_symbol_id,
                creator_function_id,
                ctx,
                visited_symbol_ids,
            );
        }
        Expression::LogicalExpression(logical) => {
            return zustand_resolve_fresh_selector_result(
                &logical.left,
                selector_parameter_symbol_id,
                creator_function_id,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
            .or_else(|| {
                zustand_resolve_fresh_selector_result(
                    &logical.right,
                    selector_parameter_symbol_id,
                    creator_function_id,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                )
            });
        }
        Expression::SequenceExpression(sequence) => {
            return zustand_resolve_fresh_selector_result(
                sequence.expressions.last()?,
                selector_parameter_symbol_id,
                creator_function_id,
                ctx,
                visited_symbol_ids,
            );
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if ctx
                .scoping()
                .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
                .is_top()
                || !visited_symbol_ids.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let AstKind::VariableDeclaration(variable_declaration) =
                ctx.nodes().parent_node(declaration.id()).kind()
            else {
                return None;
            };
            if !variable_declaration.kind.is_const() {
                return None;
            }
            let initializer = binding_pattern_initializer_for_symbol(
                &declarator.id,
                symbol_id,
                declarator.init.as_ref(),
            )?;
            return zustand_resolve_fresh_selector_result(
                initializer,
                selector_parameter_symbol_id,
                creator_function_id,
                ctx,
                visited_symbol_ids,
            );
        }
        _ => {}
    }
    None
}

fn zustand_fresh_render_value_kind(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<ZustandFreshSelectorKind> {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(_) => Some(ZustandFreshSelectorKind::Object),
        Expression::ArrayExpression(_) => Some(ZustandFreshSelectorKind::Array),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
            Some(ZustandFreshSelectorKind::Function)
        }
        Expression::NewExpression(_) => Some(ZustandFreshSelectorKind::Instance),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if ctx
                .scoping()
                .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
                .is_top()
                || !visited_symbol_ids.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable) if variable.kind.is_const()
            ) || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                return None;
            }
            zustand_fresh_render_value_kind(declarator.init.as_ref()?, ctx, visited_symbol_ids)
        }
        _ => None,
    }
}

fn zustand_fresh_result_from_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    selector_parameter_symbol_id: Option<SymbolId>,
    creator_function_id: Option<NodeId>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<ZustandFreshSelectorResult> {
    let member = call.callee.as_member_expression()?;
    let method_name = member.static_property_name()?;
    let receiver = member.object().get_inner_expression();
    if let Expression::Identifier(namespace) = receiver
        && ctx
            .scoping()
            .get_reference(namespace.reference_id())
            .symbol_id()
            .is_none()
    {
        let kind = match (namespace.name.as_str(), method_name) {
            ("Array", "from" | "of") | ("Object", "entries" | "keys" | "values") => {
                Some(ZustandFreshSelectorKind::Array)
            }
            ("Object", "create" | "fromEntries") => Some(ZustandFreshSelectorKind::Object),
            _ => None,
        };
        if let Some(kind) = kind {
            return Some(ZustandFreshSelectorResult {
                kind,
                span: call.span,
            });
        }
        if namespace.name == "Object" && method_name == "assign" {
            let target = call.arguments.first()?.as_expression()?;
            let fresh_target = zustand_resolve_fresh_selector_result(
                target,
                selector_parameter_symbol_id,
                creator_function_id,
                ctx,
                &mut visited_symbol_ids.clone(),
            )?;
            return Some(ZustandFreshSelectorResult {
                kind: fresh_target.kind,
                span: call.span,
            });
        }
    }
    if ALLOCATING_ARRAY_METHODS.contains(&method_name) {
        if zustand_resolve_fresh_selector_result(
            receiver,
            selector_parameter_symbol_id,
            creator_function_id,
            ctx,
            &mut visited_symbol_ids.clone(),
        )
        .is_some_and(|result| matches!(result.kind, ZustandFreshSelectorKind::Array))
            || creator_function_id.is_some_and(|creator_function_id| {
                zustand_selector_state_property_path(
                    receiver,
                    selector_parameter_symbol_id,
                    ctx,
                    &mut FxHashSet::default(),
                )
                .is_some_and(|property_path| {
                    zustand_creator_returns_array_at_path(creator_function_id, &property_path, ctx)
                })
            })
        {
            return Some(ZustandFreshSelectorResult {
                kind: ZustandFreshSelectorKind::Array,
                span: call.span,
            });
        }
        return None;
    }
    if SAME_REFERENCE_ARRAY_METHODS.contains(&method_name)
        && zustand_resolve_fresh_selector_result(
            receiver,
            selector_parameter_symbol_id,
            creator_function_id,
            ctx,
            &mut visited_symbol_ids.clone(),
        )
        .is_some()
    {
        return Some(ZustandFreshSelectorResult {
            kind: ZustandFreshSelectorKind::Array,
            span: call.span,
        });
    }
    None
}

fn zustand_selector_state_property_path(
    expression: &Expression<'_>,
    selector_parameter_symbol_id: Option<SymbolId>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<Vec<String>> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        if Some(symbol_id) == selector_parameter_symbol_id {
            return Some(Vec::new());
        }
        if !visited_symbol_ids.insert(symbol_id)
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(oxc_semantic::Reference::is_write)
        {
            return None;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return None;
        };
        let AstKind::VariableDeclaration(variable_declaration) =
            ctx.nodes().parent_node(declaration.id()).kind()
        else {
            return None;
        };
        if !variable_declaration.kind.is_const() {
            return None;
        }
        return zustand_selector_state_property_path(
            binding_pattern_initializer_for_symbol(
                &declarator.id,
                symbol_id,
                declarator.init.as_ref(),
            )?,
            selector_parameter_symbol_id,
            ctx,
            visited_symbol_ids,
        );
    }
    let member = expression.as_member_expression()?;
    let mut object_path = zustand_selector_state_property_path(
        member.object(),
        selector_parameter_symbol_id,
        ctx,
        visited_symbol_ids,
    )?;
    object_path.push(member.static_property_name()?.to_string());
    Some(object_path)
}

fn zustand_creator_returns_array_at_path(
    creator_function_id: NodeId,
    property_path: &[String],
    ctx: &LintContext<'_>,
) -> bool {
    let function_node = ctx.nodes().get_node(creator_function_id);
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        return zustand_expression_at_property_path(
            expression,
            property_path,
            ctx,
            &mut FxHashSet::default(),
        )
        .is_some_and(|expression| zustand_is_array_collection(expression, ctx));
    }
    if !matches!(
        function_node.kind(),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
    ) {
        return false;
    }
    let returned_expressions = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::ReturnStatement(statement) = candidate.kind() else {
                return None;
            };
            (local_callback_nearest_function_id(candidate.id(), ctx) == Some(creator_function_id))
                .then(|| statement.argument.as_ref())
                .flatten()
        })
        .collect::<Vec<_>>();
    !returned_expressions.is_empty()
        && returned_expressions.iter().all(|expression| {
            zustand_expression_at_property_path(
                expression,
                property_path,
                ctx,
                &mut FxHashSet::default(),
            )
            .is_some_and(|expression| zustand_is_array_collection(expression, ctx))
        })
}

fn zustand_expression_at_property_path<'a>(
    expression: &'a Expression<'a>,
    property_path: &[String],
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<&'a Expression<'a>> {
    let expression = zustand_resolve_immutable_initializer(expression, ctx, visited_symbol_ids);
    let Some((property_name, remaining_path)) = property_path.split_first() else {
        return Some(expression);
    };
    let Expression::ObjectExpression(object) = expression else {
        return None;
    };
    let property = object.properties.iter().find_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        (property.key.static_name().as_deref() == Some(property_name.as_str()))
            .then_some(property.as_ref())
    })?;
    zustand_expression_at_property_path(&property.value, remaining_path, ctx, visited_symbol_ids)
}

fn zustand_resolve_immutable_initializer<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> &'a Expression<'a> {
    let expression = expression.get_inner_expression();
    let Expression::Identifier(identifier) = expression else {
        return expression;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return expression;
    };
    if !visited_symbol_ids.insert(symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return expression;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return expression;
    };
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return expression;
    };
    if !variable_declaration.kind.is_const() {
        return expression;
    }
    let Some(initializer) =
        binding_pattern_initializer_for_symbol(&declarator.id, symbol_id, declarator.init.as_ref())
    else {
        return expression;
    };
    zustand_resolve_immutable_initializer(initializer, ctx, visited_symbol_ids)
}

fn zustand_is_array_collection(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(_) => true,
        Expression::NewExpression(construction) => {
            matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "Array"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        }
        _ => false,
    }
}
