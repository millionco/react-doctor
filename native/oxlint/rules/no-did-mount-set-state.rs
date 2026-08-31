use oxc_ast::{
    AstKind, MemberExpressionKind,
    ast::{
        Argument, BindingPattern, ClassElement, Expression, JSXAttributeName, JSXAttributeValue,
        MemberExpression, ObjectPropertyKind, PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::LintContext,
    rule::Rule,
    utils::{is_es5_component, is_es6_component},
};

const MESSAGE: &str = "Your users see an extra render right after mount when you call `setState` in `componentDidMount`.";
const POST_MOUNT_MEMBER_NAMES: &[&str] = &[
    "current",
    "textContent",
    "innerText",
    "offsetWidth",
    "offsetHeight",
    "offsetTop",
    "offsetLeft",
    "clientWidth",
    "clientHeight",
    "scrollWidth",
    "scrollHeight",
    "scrollTop",
    "scrollLeft",
    "getBoundingClientRect",
];

#[derive(Debug, Default, Clone)]
pub struct NoDidMountSetState;

declare_oxc_lint!(
    /// Warn about synchronous state updates during componentDidMount.
    NoDidMountSetState,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warn about setState in componentDidMount.",
);

#[derive(Clone, Copy)]
struct DidMountContext {
    lifecycle_function_id: NodeId,
    class_node_id: Option<NodeId>,
    is_inside_nested_function: bool,
    lifecycle_has_identifier_key: bool,
}

#[derive(Default)]
struct CallbackRefAnalysis {
    callback_ref_field_names: FxHashSet<String>,
    exclusively_ref_owned_field_names: FxHashSet<String>,
}

impl Rule for NoDidMountSetState {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let disallow_in_nested_functions = did_mount_disallows_nested_functions(ctx);
        let mut callback_ref_analyses = FxHashMap::<NodeId, CallbackRefAnalysis>::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(member_expression) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                continue;
            };
            if !did_mount_is_set_state_member(member_expression)
                || !matches!(
                    member_expression.object().get_inner_expression(),
                    Expression::ThisExpression(_)
                )
            {
                continue;
            }
            let Some(mount_context) = did_mount_context(node, ctx) else {
                continue;
            };
            if mount_context.is_inside_nested_function {
                if disallow_in_nested_functions {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(MESSAGE).with_label(member_expression.span()),
                    );
                }
                continue;
            }
            if !mount_context.lifecycle_has_identifier_key {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(member_expression.span()));
                continue;
            }
            let Some(first_argument) = call_expression
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(member_expression.span()));
                continue;
            };
            if did_mount_is_mount_flag_argument(first_argument)
                || did_mount_is_after_await(node, mount_context.lifecycle_function_id, ctx)
            {
                continue;
            }
            let callback_ref_fields =
                mount_context
                    .class_node_id
                    .map_or_else(FxHashSet::default, |class_node_id| {
                        callback_ref_analyses
                            .entry(class_node_id)
                            .or_insert_with(|| did_mount_callback_ref_analysis(class_node_id, ctx))
                            .exclusively_ref_owned_field_names
                            .clone()
                    });
            if did_mount_argument_derives_from_post_mount_source(
                first_argument,
                mount_context.lifecycle_function_id,
                &callback_ref_fields,
                ctx,
            ) {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(member_expression.span()));
        }
    }
}

fn did_mount_disallows_nested_functions(ctx: &LintContext<'_>) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("noDidMountSetState"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("mode"))
        .and_then(serde_json::Value::as_str)
        == Some("disallow-in-func")
}

fn did_mount_context<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> Option<DidMountContext> {
    let mut lifecycle_function_id = None;
    let mut lifecycle_member_found = false;
    let mut lifecycle_has_identifier_key = false;
    let mut nested_function_count = 0;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if !lifecycle_member_found {
            if matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) {
                lifecycle_function_id = Some(ancestor.id());
                if !is_immediately_invoked_function(ancestor, ctx)
                    || did_mount_function_is_async(ancestor)
                {
                    nested_function_count += 1;
                }
            }
            if did_mount_member_name(ancestor).as_deref() == Some("componentDidMount") {
                lifecycle_member_found = true;
                lifecycle_has_identifier_key = did_mount_member_has_identifier_key(ancestor);
            }
            continue;
        }
        if is_es6_component(ancestor) {
            return Some(DidMountContext {
                lifecycle_function_id: lifecycle_function_id?,
                class_node_id: Some(ancestor.id()),
                is_inside_nested_function: nested_function_count > 1,
                lifecycle_has_identifier_key,
            });
        }
        if is_es5_component(ancestor) {
            return Some(DidMountContext {
                lifecycle_function_id: lifecycle_function_id?,
                class_node_id: None,
                is_inside_nested_function: nested_function_count > 1,
                lifecycle_has_identifier_key,
            });
        }
    }
    None
}

fn did_mount_is_set_state_member(member_expression: &MemberExpression<'_>) -> bool {
    match member_expression {
        MemberExpression::StaticMemberExpression(member) => member.property.name == "setState",
        MemberExpression::ComputedMemberExpression(member) => {
            matches!(member.expression.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "setState")
        }
        MemberExpression::PrivateFieldExpression(_) => false,
    }
}

fn did_mount_member_name(node: &AstNode<'_>) -> Option<String> {
    match node.kind() {
        AstKind::MethodDefinition(method_definition) => method_definition
            .key
            .static_name()
            .map(|name| name.to_string()),
        AstKind::PropertyDefinition(property_definition) => property_definition
            .key
            .static_name()
            .map(|name| name.to_string()),
        AstKind::ObjectProperty(property) => {
            property.key.static_name().map(|name| name.to_string())
        }
        _ => None,
    }
}

fn did_mount_member_has_identifier_key(node: &AstNode<'_>) -> bool {
    match node.kind() {
        AstKind::MethodDefinition(method_definition) => {
            matches!(&method_definition.key, PropertyKey::StaticIdentifier(_))
        }
        AstKind::PropertyDefinition(property_definition) => {
            matches!(&property_definition.key, PropertyKey::StaticIdentifier(_))
        }
        AstKind::ObjectProperty(property) => {
            matches!(&property.key, PropertyKey::StaticIdentifier(_))
        }
        _ => false,
    }
}

fn did_mount_function_is_async(node: &AstNode<'_>) -> bool {
    match node.kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn did_mount_is_mount_flag_argument(argument: &Expression<'_>) -> bool {
    let Expression::ObjectExpression(object_expression) = argument.get_inner_expression() else {
        return false;
    };
    !object_expression.properties.is_empty()
        && object_expression.properties.iter().all(|property| {
            matches!(property, ObjectPropertyKind::ObjectProperty(property)
                if property.kind == oxc_ast::ast::PropertyKind::Init
                    && !property.computed
                    && matches!(&property.value, Expression::BooleanLiteral(value) if value.value))
        })
}

fn did_mount_is_after_await<'a>(
    set_state_node: &AstNode<'a>,
    lifecycle_function_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let lifecycle_function = ctx.nodes().get_node(lifecycle_function_id);
    if !did_mount_function_is_async(lifecycle_function) {
        return false;
    }
    let set_state_start = set_state_node.span().start;
    lifecycle_function
        .span()
        .contains_inclusive(set_state_node.span())
        && ctx.nodes().iter().any(|candidate| {
            matches!(candidate.kind(), AstKind::AwaitExpression(_))
                && lifecycle_function
                    .span()
                    .contains_inclusive(candidate.span())
                && candidate.span().start < set_state_start
        })
}

fn did_mount_argument_derives_from_post_mount_source<'a>(
    argument: &'a Expression<'a>,
    lifecycle_function_id: NodeId,
    callback_ref_field_names: &FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut local_initializers = FxHashMap::<String, &'a Expression<'a>>::default();
    let mut local_function_ids = FxHashMap::<String, NodeId>::default();
    let mut ambiguous_names = FxHashSet::<String>::default();
    let lifecycle_span = ctx.nodes().get_node(lifecycle_function_id).span();
    for candidate in ctx.nodes().iter() {
        if !lifecycle_span.contains_inclusive(candidate.span())
            || !did_mount_node_executes_in_function(candidate, lifecycle_function_id, ctx)
        {
            continue;
        }
        match candidate.kind() {
            AstKind::VariableDeclarator(declarator) => {
                let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                    continue;
                };
                let Some(initializer) = &declarator.init else {
                    continue;
                };
                did_mount_register_local(
                    identifier.name.as_str(),
                    Some(initializer),
                    did_mount_expression_function_id(initializer, ctx),
                    &mut local_initializers,
                    &mut local_function_ids,
                    &mut ambiguous_names,
                );
            }
            AstKind::Function(function)
                if function.r#type == oxc_ast::ast::FunctionType::FunctionDeclaration =>
            {
                let Some(identifier) = &function.id else {
                    continue;
                };
                did_mount_register_local(
                    identifier.name.as_str(),
                    None,
                    Some(candidate.id()),
                    &mut local_initializers,
                    &mut local_function_ids,
                    &mut ambiguous_names,
                );
            }
            _ => {}
        }
    }
    let expression_derives = |expression: &'a Expression<'a>| {
        did_mount_expression_derives_from_post_mount_source(
            expression,
            lifecycle_function_id,
            callback_ref_field_names,
            &local_initializers,
            &local_function_ids,
            ctx,
        )
    };
    let Expression::ObjectExpression(object_expression) = argument.get_inner_expression() else {
        return expression_derives(argument);
    };
    if object_expression.properties.is_empty() {
        return false;
    }
    let mut has_post_mount_value = false;
    for property_kind in &object_expression.properties {
        if did_mount_is_mount_flag_property(property_kind) {
            continue;
        }
        let ObjectPropertyKind::ObjectProperty(property) = property_kind else {
            return false;
        };
        if property.kind != oxc_ast::ast::PropertyKind::Init || !expression_derives(&property.value)
        {
            return false;
        }
        has_post_mount_value = true;
    }
    has_post_mount_value
}

fn did_mount_is_mount_flag_property(property: &ObjectPropertyKind<'_>) -> bool {
    matches!(property, ObjectPropertyKind::ObjectProperty(property)
        if property.kind == oxc_ast::ast::PropertyKind::Init
            && !property.computed
            && matches!(&property.value, Expression::BooleanLiteral(value) if value.value))
}

fn did_mount_register_local<'a>(
    name: &str,
    initializer: Option<&'a Expression<'a>>,
    function_id: Option<NodeId>,
    local_initializers: &mut FxHashMap<String, &'a Expression<'a>>,
    local_function_ids: &mut FxHashMap<String, NodeId>,
    ambiguous_names: &mut FxHashSet<String>,
) {
    if ambiguous_names.contains(name) {
        return;
    }
    if local_initializers.contains_key(name) || local_function_ids.contains_key(name) {
        ambiguous_names.insert(name.to_string());
        local_initializers.remove(name);
        local_function_ids.remove(name);
        return;
    }
    if let Some(initializer) = initializer {
        local_initializers.insert(name.to_string(), initializer);
    }
    if let Some(function_id) = function_id {
        local_function_ids.insert(name.to_string(), function_id);
    }
}

fn did_mount_expression_function_id(
    expression: &Expression<'_>,
    _ctx: &LintContext<'_>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    }
}

fn did_mount_expression_derives_from_post_mount_source<'a>(
    expression: &'a Expression<'a>,
    lifecycle_function_id: NodeId,
    callback_ref_field_names: &FxHashSet<String>,
    local_initializers: &FxHashMap<String, &'a Expression<'a>>,
    local_function_ids: &FxHashMap<String, NodeId>,
    ctx: &LintContext<'a>,
) -> bool {
    if did_mount_expression_directly_derives_from_post_mount_source(
        expression,
        lifecycle_function_id,
        callback_ref_field_names,
        ctx,
    ) || did_mount_expression_calls_post_mount_helper(
        expression,
        lifecycle_function_id,
        callback_ref_field_names,
        local_function_ids,
        ctx,
        &mut FxHashSet::default(),
    ) {
        return true;
    }
    let mut reached_names = did_mount_referenced_names(expression, ctx);
    let mut pending_names = reached_names.iter().cloned().collect::<Vec<_>>();
    while let Some(name) = pending_names.pop() {
        let Some(initializer) = local_initializers.get(&name) else {
            continue;
        };
        if did_mount_expression_function_id(initializer, ctx).is_some() {
            continue;
        }
        if did_mount_expression_directly_derives_from_post_mount_source(
            initializer,
            lifecycle_function_id,
            callback_ref_field_names,
            ctx,
        ) || did_mount_expression_calls_post_mount_helper(
            initializer,
            lifecycle_function_id,
            callback_ref_field_names,
            local_function_ids,
            ctx,
            &mut FxHashSet::default(),
        ) {
            return true;
        }
        for referenced_name in did_mount_referenced_names(initializer, ctx) {
            if reached_names.insert(referenced_name.clone()) {
                pending_names.push(referenced_name);
            }
        }
    }
    false
}

fn did_mount_expression_directly_derives_from_post_mount_source<'a>(
    expression: &Expression<'a>,
    lifecycle_function_id: NodeId,
    callback_ref_field_names: &FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    if did_mount_expression_contains_callback_ref_field(
        expression,
        lifecycle_function_id,
        callback_ref_field_names,
        ctx,
    ) {
        return did_mount_expression_is_callback_ref_derived(
            expression,
            callback_ref_field_names,
            ctx,
        ) || did_mount_synchronous_iterator_result_derives_from_callback_ref(
            expression,
            callback_ref_field_names,
            ctx,
        );
    }
    did_mount_expression_contains_post_mount_source(expression, lifecycle_function_id, ctx)
}

fn did_mount_synchronous_iterator_result_derives_from_callback_ref<'a>(
    expression: &Expression<'a>,
    callback_ref_field_names: &FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::CallExpression(call_expression) = expression.get_inner_expression() else {
        return false;
    };
    if call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
        .and_then(|member_expression| member_expression.static_property_name())
        == Some("forEach")
    {
        return false;
    }
    call_expression.arguments.iter().any(|argument| {
        let Some(callback_expression) = argument.as_expression() else {
            return false;
        };
        let Some(function_id) = did_mount_expression_function_id(callback_expression, ctx) else {
            return false;
        };
        analyzed_execution_is_synchronous_iterator_callback(
            call_expression,
            callback_expression,
            ctx,
        ) && did_mount_function_returns_callback_ref_derived_value(
            function_id,
            callback_ref_field_names,
            ctx,
        )
    })
}

fn did_mount_function_returns_callback_ref_derived_value(
    function_id: NodeId,
    callback_ref_field_names: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        return did_mount_expression_is_callback_ref_derived(
            expression,
            callback_ref_field_names,
            ctx,
        );
    }
    let mut combined_evidence = (false, false);
    for candidate in ctx.nodes().iter() {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if did_mount_nearest_function_id(candidate, ctx) != Some(function_id) {
            continue;
        }
        let Some(argument) = &return_statement.argument else {
            continue;
        };
        combined_evidence = did_mount_merge_callback_ref_value_evidence(
            combined_evidence,
            did_mount_callback_ref_value_evidence(argument, callback_ref_field_names, ctx),
        );
    }
    combined_evidence.0 && !combined_evidence.1
}

fn did_mount_expression_contains_post_mount_source<'a>(
    expression: &Expression<'a>,
    lifecycle_function_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let expression_span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        if !expression_span.contains_inclusive(candidate.span())
            || !did_mount_node_executes_in_function(candidate, lifecycle_function_id, ctx)
        {
            return false;
        }
        match candidate.kind() {
            AstKind::NewExpression(new_expression) => {
                matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name.ends_with("Observer"))
            }
            AstKind::StaticMemberExpression(member_expression) => POST_MOUNT_MEMBER_NAMES
                .contains(&member_expression.property.name.as_str()),
            _ => false,
        }
    })
}

fn did_mount_expression_contains_callback_ref_field<'a>(
    expression: &Expression<'a>,
    lifecycle_function_id: NodeId,
    callback_ref_field_names: &FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression_span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        if !expression_span.contains_inclusive(candidate.span())
            || !did_mount_node_executes_in_function(candidate, lifecycle_function_id, ctx)
        {
            return false;
        }
        let Some(member_expression) = candidate.kind().as_member_expression_kind() else {
            return false;
        };
        did_mount_kind_static_this_field_name(member_expression)
            .is_some_and(|field_name| callback_ref_field_names.contains(&field_name))
    })
}

fn did_mount_expression_calls_post_mount_helper<'a>(
    expression: &Expression<'a>,
    lifecycle_function_id: NodeId,
    callback_ref_field_names: &FxHashSet<String>,
    local_function_ids: &FxHashMap<String, NodeId>,
    ctx: &LintContext<'a>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    let expression_span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return false;
        };
        if !expression_span.contains_inclusive(candidate.span())
            || !did_mount_node_executes_in_function(candidate, lifecycle_function_id, ctx)
        {
            return false;
        }
        let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression()
        else {
            return false;
        };
        let Some(function_id) = local_function_ids.get(identifier.name.as_str()).copied() else {
            return false;
        };
        visited_function_ids.insert(function_id)
            && did_mount_function_returns_post_mount_value(
                function_id,
                callback_ref_field_names,
                local_function_ids,
                ctx,
                visited_function_ids,
            )
    })
}

fn did_mount_function_returns_post_mount_value<'a>(
    function_id: NodeId,
    callback_ref_field_names: &FxHashSet<String>,
    local_function_ids: &FxHashMap<String, NodeId>,
    ctx: &LintContext<'a>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        return did_mount_expression_directly_derives_from_post_mount_source(
            expression,
            function_id,
            callback_ref_field_names,
            ctx,
        ) || did_mount_expression_calls_post_mount_helper(
            expression,
            function_id,
            callback_ref_field_names,
            local_function_ids,
            ctx,
            visited_function_ids,
        );
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            return false;
        };
        if did_mount_nearest_function_id(candidate, ctx) != Some(function_id) {
            return false;
        }
        return_statement.argument.as_ref().is_some_and(|argument| {
            did_mount_expression_directly_derives_from_post_mount_source(
                argument,
                function_id,
                callback_ref_field_names,
                ctx,
            )
        })
    })
}

fn did_mount_referenced_names(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> FxHashSet<String> {
    let expression_span = expression.span();
    ctx.nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                return None;
            };
            expression_span
                .contains_inclusive(candidate.span())
                .then(|| identifier.name.to_string())
        })
        .collect()
}

fn did_mount_node_executes_in_function<'a>(
    node: &AstNode<'a>,
    function_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == function_id {
            return true;
        }
        if matches!(ancestor.kind(), AstKind::Class(_)) {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && !is_immediately_invoked_function(ancestor, ctx)
            && !did_mount_is_synchronous_iterator_callback(ancestor, ctx)
        {
            return false;
        }
    }
    false
}

fn did_mount_is_synchronous_iterator_callback<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    call_expression.arguments.iter().any(|argument| {
        argument.as_expression().is_some_and(|expression| {
            expression.span() == function_node.span()
                && analyzed_execution_is_synchronous_iterator_callback(
                    call_expression,
                    expression,
                    ctx,
                )
        })
    })
}

fn did_mount_nearest_function_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(node.id())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .map(AstNode::id)
}

fn did_mount_static_this_field_name(member_expression: &MemberExpression<'_>) -> Option<String> {
    matches!(
        member_expression.object().get_inner_expression(),
        Expression::ThisExpression(_)
    )
    .then(|| {
        member_expression
            .static_property_name()
            .map(|name| name.to_string())
    })
    .flatten()
}

fn did_mount_kind_static_this_field_name(
    member_expression: MemberExpressionKind<'_>,
) -> Option<String> {
    matches!(
        member_expression.object().get_inner_expression(),
        Expression::ThisExpression(_)
    )
    .then(|| {
        member_expression
            .static_property_name()
            .map(|name| name.to_string())
    })
    .flatten()
}

fn did_mount_expression_is_callback_ref_derived<'a>(
    expression: &Expression<'a>,
    callback_ref_field_names: &FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    let evidence = did_mount_callback_ref_value_evidence(expression, callback_ref_field_names, ctx);
    evidence.0 && !evidence.1
}

fn did_mount_callback_ref_value_evidence<'a>(
    expression: &Expression<'a>,
    callback_ref_field_names: &FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> (bool, bool) {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression()
        && did_mount_static_this_field_name(member_expression)
            .is_some_and(|field_name| callback_ref_field_names.contains(&field_name))
    {
        return (true, false);
    }
    match expression {
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::StringLiteral(_) => (false, false),
        Expression::Identifier(identifier) => (false, identifier.name != "undefined"),
        Expression::UnaryExpression(unary) => {
            did_mount_callback_ref_value_evidence(&unary.argument, callback_ref_field_names, ctx)
        }
        Expression::AwaitExpression(await_expression) => did_mount_callback_ref_value_evidence(
            &await_expression.argument,
            callback_ref_field_names,
            ctx,
        ),
        Expression::BinaryExpression(binary) => did_mount_combine_callback_ref_value_evidence(
            [&binary.left, &binary.right],
            callback_ref_field_names,
            ctx,
        ),
        Expression::LogicalExpression(logical) => did_mount_combine_callback_ref_value_evidence(
            [&logical.left, &logical.right],
            callback_ref_field_names,
            ctx,
        ),
        Expression::ConditionalExpression(conditional) => {
            did_mount_combine_callback_ref_value_evidence(
                [
                    &conditional.test,
                    &conditional.consequent,
                    &conditional.alternate,
                ],
                callback_ref_field_names,
                ctx,
            )
        }
        Expression::SequenceExpression(sequence) => {
            sequence
                .expressions
                .last()
                .map_or((false, true), |final_expression| {
                    did_mount_callback_ref_value_evidence(
                        final_expression,
                        callback_ref_field_names,
                        ctx,
                    )
                })
        }
        Expression::TemplateLiteral(template) => did_mount_combine_callback_ref_value_evidence(
            template.expressions.iter(),
            callback_ref_field_names,
            ctx,
        ),
        Expression::ArrayExpression(array) => {
            let mut evidence = (false, false);
            for element in &array.elements {
                let Some(element) = element.as_expression() else {
                    return (false, true);
                };
                evidence = did_mount_merge_callback_ref_value_evidence(
                    evidence,
                    did_mount_callback_ref_value_evidence(element, callback_ref_field_names, ctx),
                );
            }
            evidence
        }
        Expression::ObjectExpression(object) => {
            let mut evidence = (false, false);
            for property_kind in &object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property_kind else {
                    return (false, true);
                };
                if property.kind != oxc_ast::ast::PropertyKind::Init {
                    return (false, true);
                }
                if property.computed
                    && let Some(key_expression) = property.key.as_expression()
                {
                    evidence = did_mount_merge_callback_ref_value_evidence(
                        evidence,
                        did_mount_callback_ref_value_evidence(
                            key_expression,
                            callback_ref_field_names,
                            ctx,
                        ),
                    );
                }
                evidence = did_mount_merge_callback_ref_value_evidence(
                    evidence,
                    did_mount_callback_ref_value_evidence(
                        &property.value,
                        callback_ref_field_names,
                        ctx,
                    ),
                );
            }
            evidence
        }
        expression if expression.is_member_expression() => {
            let Some(member_expression) = expression.as_member_expression() else {
                return (false, true);
            };
            let object_evidence = did_mount_callback_ref_value_evidence(
                member_expression.object(),
                callback_ref_field_names,
                ctx,
            );
            if !object_evidence.0 || object_evidence.1 {
                return (false, true);
            }
            let MemberExpression::ComputedMemberExpression(computed_member) = member_expression
            else {
                return object_evidence;
            };
            let property_evidence = did_mount_callback_ref_value_evidence(
                &computed_member.expression,
                callback_ref_field_names,
                ctx,
            );
            (true, property_evidence.1)
        }
        Expression::CallExpression(call) => did_mount_call_callback_ref_value_evidence(
            &call.callee,
            &call.arguments,
            callback_ref_field_names,
            ctx,
        ),
        Expression::NewExpression(new_expression) => did_mount_call_callback_ref_value_evidence(
            &new_expression.callee,
            &new_expression.arguments,
            callback_ref_field_names,
            ctx,
        ),
        _ => (false, true),
    }
}

fn did_mount_combine_callback_ref_value_evidence<'a, 'b>(
    expressions: impl IntoIterator<Item = &'b Expression<'a>>,
    callback_ref_field_names: &FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> (bool, bool)
where
    'a: 'b,
{
    expressions
        .into_iter()
        .fold((false, false), |evidence, expression| {
            did_mount_merge_callback_ref_value_evidence(
                evidence,
                did_mount_callback_ref_value_evidence(expression, callback_ref_field_names, ctx),
            )
        })
}

fn did_mount_merge_callback_ref_value_evidence(
    left: (bool, bool),
    right: (bool, bool),
) -> (bool, bool) {
    (left.0 || right.0, left.1 || right.1)
}

fn did_mount_call_callback_ref_value_evidence<'a>(
    callee: &Expression<'a>,
    arguments: &[Argument<'a>],
    callback_ref_field_names: &FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> (bool, bool) {
    let mut argument_evidence = (false, false);
    for argument in arguments {
        let Some(argument) = argument.as_expression() else {
            return (false, true);
        };
        argument_evidence = did_mount_merge_callback_ref_value_evidence(
            argument_evidence,
            did_mount_callback_ref_value_evidence(argument, callback_ref_field_names, ctx),
        );
    }
    let Some(member_expression) = callee.get_inner_expression().as_member_expression() else {
        return argument_evidence;
    };
    let receiver_evidence = did_mount_callback_ref_value_evidence(
        member_expression.object(),
        callback_ref_field_names,
        ctx,
    );
    if !receiver_evidence.0 || receiver_evidence.1 {
        return argument_evidence;
    }
    (true, argument_evidence.1)
}

fn did_mount_callback_ref_analysis<'a>(
    class_node_id: NodeId,
    ctx: &LintContext<'a>,
) -> CallbackRefAnalysis {
    let class_node = ctx.nodes().get_node(class_node_id);
    let mut analysis = CallbackRefAnalysis::default();
    for candidate in ctx.nodes().iter() {
        let AstKind::JSXAttribute(attribute) = candidate.kind() else {
            continue;
        };
        if !class_node.span().contains_inclusive(candidate.span())
            || did_mount_nearest_class_id(candidate, ctx) != Some(class_node_id)
            || !matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "ref")
        {
            continue;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            continue;
        };
        let Some(expression) = container.expression.as_expression() else {
            continue;
        };
        did_mount_collect_callback_ref_fields(
            expression,
            class_node_id,
            &mut analysis.callback_ref_field_names,
            ctx,
            &mut FxHashSet::default(),
        );
    }
    analysis.exclusively_ref_owned_field_names = analysis
        .callback_ref_field_names
        .iter()
        .filter(|field_name| {
            did_mount_field_is_exclusively_ref_owned(
                class_node_id,
                field_name,
                &analysis.callback_ref_field_names,
                ctx,
            )
        })
        .cloned()
        .collect();
    analysis
}

fn did_mount_nearest_class_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(node.id())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::Class(_)))
        .map(AstNode::id)
}

fn did_mount_collect_callback_ref_fields<'a>(
    expression: &Expression<'a>,
    class_node_id: NodeId,
    field_names: &mut FxHashSet<String>,
    ctx: &LintContext<'a>,
    visited_handler_names: &mut FxHashSet<String>,
) {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
            if let Some(function_id) = did_mount_expression_function_id(expression, ctx) {
                did_mount_collect_callback_assigned_fields(
                    function_id,
                    class_node_id,
                    field_names,
                    ctx,
                    visited_handler_names,
                );
            }
        }
        Expression::ConditionalExpression(conditional) => {
            did_mount_collect_callback_ref_fields(
                &conditional.consequent,
                class_node_id,
                field_names,
                ctx,
                visited_handler_names,
            );
            did_mount_collect_callback_ref_fields(
                &conditional.alternate,
                class_node_id,
                field_names,
                ctx,
                visited_handler_names,
            );
        }
        Expression::LogicalExpression(logical) => {
            if logical.operator != oxc_syntax::operator::LogicalOperator::And {
                did_mount_collect_callback_ref_fields(
                    &logical.left,
                    class_node_id,
                    field_names,
                    ctx,
                    visited_handler_names,
                );
            }
            did_mount_collect_callback_ref_fields(
                &logical.right,
                class_node_id,
                field_names,
                ctx,
                visited_handler_names,
            );
        }
        expression => {
            let Some(member_expression) = expression.as_member_expression() else {
                return;
            };
            let Some(handler_name) = did_mount_static_this_field_name(member_expression) else {
                return;
            };
            if !visited_handler_names.insert(handler_name.clone()) {
                return;
            }
            if let Some(function_id) =
                did_mount_class_member_function_id(class_node_id, &handler_name, ctx)
            {
                did_mount_collect_callback_assigned_fields(
                    function_id,
                    class_node_id,
                    field_names,
                    ctx,
                    visited_handler_names,
                );
            }
        }
    }
}

fn did_mount_class_member_function_id(
    class_node_id: NodeId,
    member_name: &str,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let AstKind::Class(class) = ctx.nodes().get_node(class_node_id).kind() else {
        return None;
    };
    class.body.body.iter().find_map(|element| match element {
        ClassElement::MethodDefinition(method)
            if !method.r#static && method.key.static_name().as_deref() == Some(member_name) =>
        {
            Some(method.value.node_id.get())
        }
        ClassElement::PropertyDefinition(property)
            if !property.r#static && property.key.static_name().as_deref() == Some(member_name) =>
        {
            property
                .value
                .as_ref()
                .and_then(|value| did_mount_expression_function_id(value, ctx))
        }
        _ => None,
    })
}

fn did_mount_collect_callback_assigned_fields<'a>(
    function_id: NodeId,
    class_node_id: NodeId,
    field_names: &mut FxHashSet<String>,
    ctx: &LintContext<'a>,
    visited_handler_names: &mut FxHashSet<String>,
) {
    let Some(parameter_symbol_id) = did_mount_first_parameter_symbol(function_id, ctx) else {
        return;
    };
    let function_span = ctx.nodes().get_node(function_id).span();
    let this_alias_symbol_ids = did_mount_this_alias_symbol_ids(class_node_id, ctx);
    for candidate in ctx.nodes().iter() {
        if !function_span.contains_inclusive(candidate.span())
            || !did_mount_node_executes_in_function(candidate, function_id, ctx)
        {
            continue;
        }
        if let AstKind::AssignmentExpression(assignment) = candidate.kind()
            && assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign
            && did_mount_expression_is_parameter_value(&assignment.right, parameter_symbol_id, ctx)
            && let Some(member_expression) = assignment.left.as_member_expression()
            && did_mount_is_this_or_alias(
                member_expression.object(),
                class_node_id,
                &this_alias_symbol_ids,
                ctx,
            )
            && let Some(field_name) = member_expression.static_property_name()
        {
            field_names.insert(field_name.to_string());
            continue;
        }
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        let Some(member_expression) = call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()
        else {
            continue;
        };
        if let Some((receiver_kind, method_name)) =
            did_mount_mutation_receiver_and_method(member_expression, ctx)
        {
            let Some(target) = call_expression
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            if !did_mount_is_this_or_alias(target, class_node_id, &this_alias_symbol_ids, ctx) {
                continue;
            }
            if receiver_kind == "object" && method_name == "assign" {
                for source in call_expression.arguments.iter().skip(1) {
                    let Some(Expression::ObjectExpression(object)) =
                        source.as_expression().map(Expression::get_inner_expression)
                    else {
                        continue;
                    };
                    for property_kind in &object.properties {
                        let ObjectPropertyKind::ObjectProperty(property) = property_kind else {
                            continue;
                        };
                        let Some(property_name) = property.key.static_name() else {
                            continue;
                        };
                        if did_mount_expression_is_parameter_value(
                            &property.value,
                            parameter_symbol_id,
                            ctx,
                        ) {
                            field_names.insert(property_name.to_string());
                        } else {
                            field_names.remove(property_name.as_ref());
                        }
                    }
                }
                continue;
            }
            if receiver_kind == "reflect" && method_name == "set" {
                let Some(property_name) = call_expression
                    .arguments
                    .get(1)
                    .and_then(Argument::as_expression)
                    .and_then(did_mount_static_string)
                else {
                    continue;
                };
                if call_expression
                    .arguments
                    .get(2)
                    .and_then(Argument::as_expression)
                    .is_some_and(|value| {
                        did_mount_expression_is_parameter_value(value, parameter_symbol_id, ctx)
                    })
                {
                    field_names.insert(property_name.to_string());
                } else {
                    field_names.remove(property_name);
                }
                continue;
            }
        }
        let Some(handler_name) = did_mount_static_this_field_name(member_expression) else {
            continue;
        };
        let Some(forwarded_value) = call_expression
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            continue;
        };
        if !did_mount_expression_is_parameter_value(forwarded_value, parameter_symbol_id, ctx)
            || !visited_handler_names.insert(handler_name.clone())
        {
            continue;
        }
        if let Some(handler_id) =
            did_mount_class_member_function_id(class_node_id, &handler_name, ctx)
        {
            did_mount_collect_callback_assigned_fields(
                handler_id,
                class_node_id,
                field_names,
                ctx,
                visited_handler_names,
            );
        }
    }
}

fn did_mount_first_parameter_symbol(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let parameters = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return None,
    };
    parameters
        .items
        .first()?
        .pattern
        .get_binding_identifier()
        .map(|identifier| identifier.symbol_id())
}

fn did_mount_expression_is_parameter_value(
    expression: &Expression<'_>,
    parameter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                == Some(parameter_symbol_id)
        }
        Expression::LogicalExpression(logical)
            if logical.operator == oxc_syntax::operator::LogicalOperator::Coalesce =>
        {
            did_mount_expression_is_parameter_value(&logical.left, parameter_symbol_id, ctx)
                && matches!(logical.right.get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "undefined")
        }
        _ => false,
    }
}

fn did_mount_field_is_exclusively_ref_owned<'a>(
    class_node_id: NodeId,
    field_name: &str,
    callback_ref_field_names: &FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    if field_name.starts_with('#') || !callback_ref_field_names.contains(field_name) {
        return false;
    }
    let class_node = ctx.nodes().get_node(class_node_id);
    let AstKind::Class(class) = class_node.kind() else {
        return false;
    };
    if class.body.body.iter().any(|element| {
        matches!(element, ClassElement::PropertyDefinition(property)
            if !property.r#static
                && property.key.static_name().as_deref() == Some(field_name)
                && property.value.as_ref().is_some_and(|value| !did_mount_is_nullish(value)))
    }) {
        return false;
    }
    let this_alias_symbol_ids = did_mount_this_alias_symbol_ids(class_node_id, ctx);
    let mut writer_function_ids = FxHashSet::<NodeId>::default();
    for candidate in ctx.nodes().iter() {
        if !class_node.span().contains_inclusive(candidate.span()) {
            continue;
        }
        let field_write = match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => assignment.left.as_member_expression(),
            AstKind::UpdateExpression(update) => update.argument.as_member_expression(),
            AstKind::UnaryExpression(unary)
                if unary.operator == oxc_syntax::operator::UnaryOperator::Delete =>
            {
                unary.argument.as_member_expression()
            }
            _ => None,
        };
        if let Some(member_expression) = field_write {
            if !did_mount_is_this_or_alias(
                member_expression.object(),
                class_node_id,
                &this_alias_symbol_ids,
                ctx,
            ) {
                continue;
            }
            let Some(written_field_name) = member_expression.static_property_name() else {
                return false;
            };
            if written_field_name != field_name {
                continue;
            }
            let Some(writer_function_id) = did_mount_nearest_function_id(candidate, ctx) else {
                return false;
            };
            writer_function_ids.insert(writer_function_id);
            continue;
        }
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        let Some(member_expression) = call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()
        else {
            continue;
        };
        let Some((receiver_kind, method_name)) =
            did_mount_mutation_receiver_and_method(member_expression, ctx)
        else {
            continue;
        };
        let Some(target) = call_expression
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            continue;
        };
        if !did_mount_is_this_or_alias(target, class_node_id, &this_alias_symbol_ids, ctx)
            || !did_mount_mutation_call_may_write_field(
                call_expression,
                receiver_kind,
                &method_name,
                field_name,
            )
        {
            continue;
        }
        let Some(writer_function_id) = did_mount_nearest_function_id(candidate, ctx) else {
            return false;
        };
        writer_function_ids.insert(writer_function_id);
    }
    let Some(writer_function_id) = writer_function_ids.iter().copied().next() else {
        return false;
    };
    if writer_function_ids.len() != 1 {
        return false;
    }
    let parent = ctx.nodes().parent_node(writer_function_id);
    let Some(writer_member_name) = did_mount_member_name(parent) else {
        return true;
    };
    if ctx.nodes().iter().any(|candidate| {
        if !class_node.span().contains_inclusive(candidate.span()) {
            return false;
        }
        let Some(member_expression) = candidate.kind().as_member_expression_kind() else {
            return false;
        };
        member_expression.static_property_name().as_deref() == Some(writer_member_name.as_str())
            && did_mount_is_this_or_alias(
                member_expression.object(),
                class_node_id,
                &this_alias_symbol_ids,
                ctx,
            )
            && !did_mount_is_valid_ref_attribute_use(candidate, ctx)
    }) {
        return false;
    }
    did_mount_destructured_handler_is_ref_only(
        class_node_id,
        &writer_member_name,
        &this_alias_symbol_ids,
        ctx,
    )
}

fn did_mount_is_valid_ref_attribute_use<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let mut wrapper_function_id = None;
    let mut forwarding_call = None;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::CallExpression(call_expression)
                if forwarding_call.is_none()
                    && call_expression
                        .callee
                        .span()
                        .contains_inclusive(node.span()) =>
            {
                forwarding_call = Some(call_expression);
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                if wrapper_function_id.is_some() {
                    return false;
                }
                wrapper_function_id = Some(ancestor.id());
            }
            AstKind::JSXAttribute(attribute) if matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "ref") =>
            {
                let Some(wrapper_function_id) = wrapper_function_id else {
                    return true;
                };
                let Some(parameter_symbol_id) =
                    did_mount_first_parameter_symbol(wrapper_function_id, ctx)
                else {
                    return false;
                };
                return forwarding_call
                    .and_then(|call_expression| call_expression.arguments.first())
                    .and_then(Argument::as_expression)
                    .is_some_and(|argument| {
                        did_mount_expression_is_parameter_value(argument, parameter_symbol_id, ctx)
                    });
            }
            _ => {}
        }
    }
    false
}

fn did_mount_destructured_handler_is_ref_only<'a>(
    class_node_id: NodeId,
    handler_name: &str,
    this_alias_symbol_ids: &FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    let class_span = ctx.nodes().get_node(class_node_id).span();
    for candidate in ctx.nodes().iter() {
        let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
            continue;
        };
        if !class_span.contains_inclusive(candidate.span()) {
            continue;
        }
        let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
            continue;
        };
        let Some(initializer) = &declarator.init else {
            continue;
        };
        if !did_mount_is_this_or_alias(initializer, class_node_id, this_alias_symbol_ids, ctx) {
            continue;
        }
        for property in &pattern.properties {
            if property.key.static_name().as_deref() != Some(handler_name) {
                continue;
            }
            let binding_pattern = match &property.value {
                BindingPattern::AssignmentPattern(assignment) => &assignment.left,
                pattern => pattern,
            };
            let Some(binding) = binding_pattern.get_binding_identifier() else {
                continue;
            };
            if ctx
                .scoping()
                .get_resolved_references(binding.symbol_id())
                .any(|reference| {
                    !did_mount_is_valid_ref_attribute_use(
                        ctx.nodes().get_node(reference.node_id()),
                        ctx,
                    )
                })
            {
                return false;
            }
        }
    }
    true
}

fn did_mount_this_alias_symbol_ids(
    class_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let class_span = ctx.nodes().get_node(class_node_id).span();
    let mut alias_symbol_ids = FxHashSet::default();
    let mut did_add_alias = true;
    while did_add_alias {
        did_add_alias = false;
        for candidate in ctx.nodes().iter() {
            let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
                continue;
            };
            if !class_span.contains_inclusive(candidate.span()) {
                continue;
            }
            let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
                continue;
            };
            let Some(initializer) = &declarator.init else {
                continue;
            };
            let is_alias = match initializer.get_inner_expression() {
                Expression::ThisExpression(_) => {
                    did_mount_nearest_class_id(candidate, ctx) == Some(class_node_id)
                }
                Expression::Identifier(identifier) => ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_some_and(|symbol_id| alias_symbol_ids.contains(&symbol_id)),
                _ => false,
            };
            if is_alias && alias_symbol_ids.insert(binding.symbol_id()) {
                did_add_alias = true;
            }
        }
    }
    alias_symbol_ids
}

fn did_mount_is_this_or_alias(
    expression: &Expression<'_>,
    class_node_id: NodeId,
    alias_symbol_ids: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ThisExpression(this_expression) => {
            ctx.nodes()
                .iter()
                .find(|candidate| candidate.span() == this_expression.span)
                .and_then(|candidate| did_mount_nearest_class_id(candidate, ctx))
                == Some(class_node_id)
        }
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| alias_symbol_ids.contains(&symbol_id)),
        _ => false,
    }
}

fn did_mount_mutation_receiver_and_method<'a>(
    member_expression: &'a MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<(&'static str, String)> {
    let method_name = member_expression.static_property_name()?.to_string();
    let Expression::Identifier(receiver) = member_expression.object().get_inner_expression() else {
        return None;
    };
    let receiver_kind = did_mount_global_mutation_receiver_kind(receiver, ctx)?;
    Some((receiver_kind, method_name))
}

fn did_mount_global_mutation_receiver_kind(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<&'static str> {
    did_mount_global_mutation_receiver_kind_inner(identifier, ctx, &mut FxHashSet::default())
}

fn did_mount_global_mutation_receiver_kind_inner(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<&'static str> {
    let reference = ctx.scoping().get_reference(identifier.reference_id());
    let Some(symbol_id) = reference.symbol_id() else {
        return match identifier.name.as_str() {
            "Object" => Some("object"),
            "Reflect" => Some("reflect"),
            _ => None,
        };
    };
    if !visited_symbol_ids.insert(symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
    {
        return None;
    }
    let Expression::Identifier(root_identifier) = declarator.init.as_ref()?.get_inner_expression()
    else {
        return None;
    };
    did_mount_global_mutation_receiver_kind_inner(root_identifier, ctx, visited_symbol_ids)
}

fn did_mount_mutation_call_may_write_field(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    receiver_kind: &str,
    method_name: &str,
    field_name: &str,
) -> bool {
    let property_or_source = call_expression.arguments.get(1);
    if receiver_kind == "object" && method_name == "assign" {
        return call_expression.arguments.iter().skip(1).any(|source| {
            let Some(Expression::ObjectExpression(object)) =
                source.as_expression().map(Expression::get_inner_expression)
            else {
                return true;
            };
            object.properties.iter().any(|property_kind| {
                let ObjectPropertyKind::ObjectProperty(property) = property_kind else {
                    return true;
                };
                property
                    .key
                    .static_name()
                    .is_none_or(|name| name == field_name)
            })
        });
    }
    if receiver_kind == "object" && method_name == "defineProperties" {
        return property_or_source
            .and_then(Argument::as_expression)
            .is_none_or(|source| {
                let Expression::ObjectExpression(object) = source.get_inner_expression() else {
                    return true;
                };
                object.properties.iter().any(|property_kind| {
                    let ObjectPropertyKind::ObjectProperty(property) = property_kind else {
                        return true;
                    };
                    property
                        .key
                        .static_name()
                        .is_none_or(|name| name == field_name)
                })
            });
    }
    if (receiver_kind == "object" && method_name == "defineProperty")
        || (receiver_kind == "reflect"
            && matches!(method_name, "defineProperty" | "deleteProperty" | "set"))
    {
        return property_or_source
            .and_then(Argument::as_expression)
            .and_then(did_mount_static_string)
            .is_none_or(|name| name == field_name);
    }
    false
}

fn did_mount_static_string<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(value) => Some(value.value.as_str()),
        _ => None,
    }
}

fn did_mount_is_nullish(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name == "undefined",
        Expression::NullLiteral(_) => true,
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::Void =>
        {
            matches!(unary.argument.get_inner_expression(), Expression::NumericLiteral(value) if value.value == 0.0)
        }
        _ => false,
    }
}
