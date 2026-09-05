use rustc_hash::{FxHashMap, FxHashSet};

use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, CallExpression, Expression, FormalParameters, FunctionType,
        JSXAttributeName, MemberExpression, ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::Span;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EFFECT_HOOK_NAMES: [&str; 3] = ["useEffect", "useInsertionEffect", "useLayoutEffect"];
const IMPORTED_EFFECT_WRAPPER_NAMES: [&str; 3] = [
    "useIsomorphicEffect",
    "useIsomorphicLayoutEffect",
    "useModernLayoutEffect",
];
const SUBSCRIPTION_METHOD_NAMES: [&str; 8] = [
    "subscribe",
    "addEventListener",
    "addListener",
    "on",
    "watch",
    "listen",
    "sub",
    "observe",
];
const SOCKET_CONSTRUCTOR_NAMES: [&str; 4] = [
    "WebSocket",
    "EventSource",
    "BroadcastChannel",
    "RTCPeerConnection",
];
const BOUND_RELEASE_METHOD_NAMES: [&str; 14] = [
    "unsubscribe",
    "remove",
    "cleanup",
    "dispose",
    "destroy",
    "stop",
    "teardown",
    "abort",
    "disconnect",
    "unobserve",
    "close",
    "unlisten",
    "unsub",
    "off",
];
const SYNCHRONOUS_ITERATOR_METHOD_NAMES: [&str; 8] = [
    "every",
    "filter",
    "find",
    "findIndex",
    "flatMap",
    "forEach",
    "map",
    "some",
];
const SYNCHRONOUS_ITERATOR_CALLBACK_METHOD_NAMES: [&str; 8] = [
    "every",
    "filter",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
];
const PROMISE_CHAIN_METHOD_NAMES: [&str; 3] = ["then", "catch", "finally"];
const INERT_REF_ONE_SHOT_TIMER_MAX_DELAY_MS: f64 = 300.0;

#[derive(Debug, Default, Clone)]
pub struct EffectNeedsCleanup;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum ResourceKind {
    Subscribe,
    Timer,
    Socket,
}

#[derive(Debug, Clone)]
struct ResourceUsage {
    kind: ResourceKind,
    node_id: NodeId,
    span: Span,
    resource_name: String,
    handle_key: Option<String>,
    receiver_key: Option<String>,
    registration_method: Option<String>,
    event_key: Option<String>,
    handler_key: Option<String>,
    capture_key: Option<String>,
    local_abort_controller: Option<String>,
    channel_client_key: Option<String>,
    collection_key: Option<String>,
}

declare_oxc_lint!(
    /// Require effects and retained callbacks to release subscriptions, timers, and connections.
    EffectNeedsCleanup,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Effect subscription or timer never cleaned up.",
);

impl Rule for EffectNeedsCleanup {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let resource_owner_function_ids = effect_cleanup_resource_owner_function_ids(ctx);
        if resource_owner_function_ids.is_empty() {
            return;
        }
        let mut checked_retained_function_ids = FxHashSet::default();
        for node in ctx.nodes().iter() {
            if let AstKind::CallExpression(effect_call) = node.kind()
                && effect_cleanup_is_effect_hook_call(effect_call, ctx)
            {
                effect_cleanup_check_effect(effect_call, ctx);
            }
            let retained_function_id = match node.kind() {
                AstKind::Function(function) => Some(function.node_id.get()),
                AstKind::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                _ => None,
            };
            if let Some(retained_function_id) = retained_function_id
                && resource_owner_function_ids.contains(&retained_function_id)
                && checked_retained_function_ids.insert(retained_function_id)
                && effect_cleanup_is_retained_function(retained_function_id, ctx)
            {
                effect_cleanup_check_retained_function(retained_function_id, ctx);
            }
        }
    }
}

fn effect_cleanup_resource_owner_function_ids(ctx: &LintContext<'_>) -> FxHashSet<NodeId> {
    ctx.nodes()
        .iter()
        .filter(|node| match node.kind() {
            AstKind::NewExpression(construction) => {
                matches!(construction.callee.get_inner_expression(), Expression::Identifier(callee)
                    if SOCKET_CONSTRUCTOR_NAMES.contains(&callee.name.as_str()))
            }
            AstKind::CallExpression(call) => {
                effect_cleanup_timer_name(call).is_some()
                    || call
                        .callee
                        .get_inner_expression()
                        .as_member_expression()
                        .and_then(effect_cleanup_subscription_method_name)
                        .is_some_and(|name| SUBSCRIPTION_METHOD_NAMES.contains(&name))
            }
            _ => false,
        })
        .filter_map(|node| effect_cleanup_nearest_function_id(node.id(), ctx))
        .collect()
}

fn effect_cleanup_check_effect<'a>(effect_call: &'a CallExpression<'a>, ctx: &LintContext<'a>) {
    let Some(callback_expression) = effect_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return;
    };
    let Some(callback_id) =
        effect_cleanup_exact_local_function_id(callback_expression, ctx, &mut FxHashSet::default())
    else {
        return;
    };
    if !effect_cleanup_is_effect_callback_function(callback_id, ctx) {
        return;
    }
    let execution = effect_cleanup_execution_function_ids(callback_id, ctx, None);
    let execution_function_ids = &execution.function_ids;
    let usages = effect_cleanup_collect_usages(callback_id, execution_function_ids, ctx);
    let Some(first_leak) = usages.iter().find(|usage| {
        if effect_cleanup_is_synchronously_released(usage, callback_id, ctx) {
            return false;
        }
        let is_external_listener_timer = usage.kind == ResourceKind::Timer
            && effect_cleanup_nearest_function_id(usage.node_id, ctx).is_some_and(|function_id| {
                execution
                    .external_listener_function_ids
                    .contains(&function_id)
            });
        if is_external_listener_timer
            && !effect_cleanup_resource_is_stored_in_react_ref(usage.node_id, ctx)
            && !effect_cleanup_deferred_timer_has_lifecycle_guard(usage, callback_id, ctx)
        {
            return true;
        }
        if effect_cleanup_has_split_lifecycle_release(usage, callback_id, ctx)
            && effect_cleanup_releases_previous_handle(usage, ctx)
        {
            return false;
        }
        let has_returned_release =
            effect_cleanup_has_returned_release(usage, callback_id, execution_function_ids, ctx);
        let is_deferred_timer = usage.kind == ResourceKind::Timer
            && effect_cleanup_nearest_function_id(usage.node_id, ctx) != Some(callback_id)
            && !effect_cleanup_mapped_resource_collection_symbol(
                ctx.nodes().get_node(usage.node_id),
                ctx,
            )
            .is_some_and(|symbol_id| {
                effect_cleanup_nearest_function_id(ctx.symbol_declaration(symbol_id).id(), ctx)
                    == Some(callback_id)
            });
        if !is_deferred_timer {
            let is_deferred_registration = usage.kind == ResourceKind::Subscribe
                && effect_cleanup_nearest_function_id(usage.node_id, ctx).is_some_and(
                    |function_id| {
                        function_id != callback_id
                            && effect_cleanup_has_deferred_execution_path(
                                function_id,
                                callback_id,
                                ctx,
                                &mut FxHashSet::default(),
                            )
                    },
                );
            let has_owned_listener_trigger = effect_cleanup_nearest_function_id(usage.node_id, ctx)
                .is_some_and(|function_id| {
                    effect_cleanup_has_effect_owned_listener_trigger(function_id, callback_id, ctx)
                });
            return is_deferred_registration
                && !(has_returned_release && has_owned_listener_trigger)
                || !has_returned_release;
        }
        if has_returned_release
            && effect_cleanup_has_owned_nested_timer_cleanup(
                usage,
                &usages,
                callback_id,
                execution_function_ids,
                ctx,
            )
        {
            return false;
        }
        effect_cleanup_has_competing_deferred_allocations(usage, &usages, callback_id, ctx)
            || !has_returned_release
            || (!effect_cleanup_deferred_timer_has_lifecycle_guard(usage, callback_id, ctx)
                && !effect_cleanup_is_directly_started_self_rescheduling_timer(
                    usage,
                    &usages,
                    callback_id,
                    ctx,
                ))
    }) else {
        return;
    };
    let resource_noun = effect_cleanup_resource_noun(first_leak.kind);
    let hook_name = effect_cleanup_callee_name(effect_call).unwrap_or("effect");
    let message = format!(
        "`{}` creates a {} in {} without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
        first_leak.resource_name, resource_noun, hook_name
    );
    ctx.diagnostic(OxcDiagnostic::error(message).with_label(effect_call.span));
}

fn effect_cleanup_check_retained_function(function_id: NodeId, ctx: &LintContext<'_>) {
    let execution_function_ids = FxHashSet::from_iter([function_id]);
    let is_external_store_subscribe =
        effect_cleanup_is_use_sync_external_store_subscribe_function(function_id, ctx);
    let is_ref_effect_invoked = effect_cleanup_is_ref_effect_invoked_function(function_id, ctx);
    let is_react_ref_callback = effect_cleanup_function_is_react_ref_callback(function_id, ctx);
    let usages = effect_cleanup_collect_usages(function_id, &execution_function_ids, ctx);
    let effect_invocations = usages
        .iter()
        .any(|usage| usage.resource_name == "setTimeout")
        .then(|| effect_cleanup_effect_invocations(function_id, ctx));
    let is_effect_invoked = effect_invocations.as_ref().is_some_and(|invocations| {
        !invocations.direct_invocation_ids.is_empty() || invocations.has_indirect
    });
    let Some(first_leak) = usages.iter().find(|usage| {
        if usage.resource_name == "setTimeout"
            && !effect_cleanup_timer_has_global_callee(usage, ctx)
        {
            return false;
        }
        if usage.resource_name == "setTimeout" && !is_ref_effect_invoked && !is_effect_invoked {
            return false;
        }
        if effect_cleanup_is_synchronously_released(usage, function_id, ctx) {
            return false;
        }
        if (usage.kind != ResourceKind::Timer
            || !is_effect_invoked
                && (effect_cleanup_resource_is_stored_in_react_ref(usage.node_id, ctx)
                    || effect_cleanup_releases_previous_handle(usage, ctx)))
            && effect_cleanup_file_contains_release(usage, ctx)
        {
            return false;
        }
        if effect_cleanup_has_split_lifecycle_release(usage, function_id, ctx)
            && !(usage.kind == ResourceKind::Timer && is_effect_invoked)
        {
            return false;
        }
        if usage.kind == ResourceKind::Timer
            && is_effect_invoked
            && effect_cleanup_has_returned_release(usage, function_id, &execution_function_ids, ctx)
            && effect_invocations.as_ref().is_some_and(|invocations| {
                effect_cleanup_effect_invocations_own_returned_cleanup(invocations, ctx)
            })
        {
            return false;
        }
        let caller_owns_returned_cleanup = is_external_store_subscribe
            || is_react_ref_callback
            || is_ref_effect_invoked
                && effect_cleanup_every_ref_effect_invocation_returns_result(function_id, ctx);
        if caller_owns_returned_cleanup
            && (effect_cleanup_has_returned_release(
                usage,
                function_id,
                &execution_function_ids,
                ctx,
            ) || is_external_store_subscribe
                && effect_cleanup_external_store_returns_cleanup(usage, function_id, ctx))
            && (!is_react_ref_callback
                || effect_cleanup_returned_release_covers_function_entry(
                    usage,
                    function_id,
                    &execution_function_ids,
                    ctx,
                ))
        {
            return false;
        }
        if is_external_store_subscribe || is_react_ref_callback || is_ref_effect_invoked {
            return true;
        }
        if is_effect_invoked && usage.kind == ResourceKind::Timer {
            return true;
        }
        if effect_cleanup_resource_result_is_persisted_without_return(usage, function_id, ctx) {
            return true;
        }
        !effect_cleanup_resource_result_escapes(usage, function_id, ctx)
    }) else {
        return;
    };
    if first_leak.resource_name == "setTimeout"
        && effect_invocations.as_ref().is_some_and(|invocations| {
            effect_cleanup_effect_invocations_disable_leak(
                function_id,
                first_leak.node_id,
                invocations,
                ctx,
            )
        })
    {
        return;
    }
    let message = format!(
        "`{}` creates a {} in a function that outlives the render, with no cleanup path. Store the handle and release it, or move this into a useEffect that returns cleanup, so it does not leak after unmount.",
        first_leak.resource_name,
        effect_cleanup_resource_noun(first_leak.kind),
    );
    ctx.diagnostic(OxcDiagnostic::error(message).with_label(first_leak.span));
}

#[derive(Clone, Copy)]
struct EffectCleanupInvocationValue {
    truthiness: Option<bool>,
    is_definitely_undefined: bool,
}

struct EffectCleanupEffectInvocations {
    direct_invocation_ids: Vec<NodeId>,
    has_indirect: bool,
}

fn effect_cleanup_effect_invocations(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> EffectCleanupEffectInvocations {
    let mut direct_invocation_ids = Vec::new();
    let mut has_indirect = false;
    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(effect_call) = candidate.kind() else {
            continue;
        };
        if !effect_cleanup_is_effect_hook_call(effect_call, ctx) {
            continue;
        }
        let Some(callback_id) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(|callback| {
                effect_cleanup_exact_local_function_id(callback, ctx, &mut FxHashSet::default())
            })
        else {
            continue;
        };
        for effect_child in ctx.nodes().iter() {
            if effect_cleanup_nearest_function_id(effect_child.id(), ctx) != Some(callback_id)
                || !effect_cleanup_node_is_reachable(effect_child, callback_id, ctx)
            {
                continue;
            }
            let AstKind::CallExpression(call) = effect_child.kind() else {
                continue;
            };
            if effect_cleanup_retained_function_id(&call.callee, ctx, &mut FxHashSet::default())
                == Some(function_id)
            {
                direct_invocation_ids.push(effect_child.id());
                continue;
            }
            if effect_cleanup_is_synchronous_iterator_call(call)
                && call.arguments.iter().any(|argument| {
                    argument.as_expression().is_some_and(|argument| {
                        effect_cleanup_retained_function_id(
                            argument,
                            ctx,
                            &mut FxHashSet::default(),
                        ) == Some(function_id)
                    })
                })
            {
                has_indirect = true;
            }
        }
    }
    EffectCleanupEffectInvocations {
        direct_invocation_ids,
        has_indirect,
    }
}

fn effect_cleanup_effect_invocations_own_returned_cleanup(
    invocations: &EffectCleanupEffectInvocations,
    ctx: &LintContext<'_>,
) -> bool {
    !invocations.has_indirect
        && !invocations.direct_invocation_ids.is_empty()
        && invocations
            .direct_invocation_ids
            .iter()
            .all(|invocation_id| effect_cleanup_effect_invocation_owns_result(*invocation_id, ctx))
}

fn effect_cleanup_effect_invocation_owns_result(
    invocation_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(callback_id) = effect_cleanup_nearest_function_id(invocation_id, ctx) else {
        return false;
    };
    if !effect_cleanup_is_effect_callback_function(callback_id, ctx)
        || effect_cleanup_function_is_async(callback_id, ctx)
    {
        return false;
    }
    if effect_cleanup_expression_is_returned_from_function(invocation_id, callback_id, ctx) {
        return true;
    }
    let invocation_node = ctx.nodes().get_node(invocation_id);
    let Some(result_symbol_id) = effect_cleanup_stored_result_symbol_id(invocation_node, ctx)
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(result_symbol_id);
    if effect_cleanup_symbol_has_write(result_symbol_id, ctx)
        || !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable) if variable.kind.is_const()
        )
    {
        return false;
    }
    let matching_return_spans = effect_cleanup_return_expressions(callback_id, ctx)
        .into_iter()
        .filter(|expression| {
            effect_cleanup_exact_local_function_id(expression, ctx, &mut FxHashSet::default())
                .is_some_and(|cleanup_function_id| {
                    effect_cleanup_function_invokes_symbol(
                        cleanup_function_id,
                        result_symbol_id,
                        ctx,
                    )
                })
        })
        .map(Expression::span)
        .collect::<Vec<_>>();
    if matching_return_spans.is_empty() {
        return false;
    }
    let return_nodes = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            matches!(candidate.kind(), AstKind::ReturnStatement(statement)
                if statement.argument.as_ref().is_some_and(|argument| matching_return_spans.contains(&argument.span())))
        })
        .collect::<Vec<_>>();
    do_nodes_cover_every_path_after_node(
        invocation_node,
        &return_nodes,
        ctx.nodes().get_node(callback_id),
        ctx,
    )
}

fn effect_cleanup_function_invokes_symbol(
    function_id: NodeId,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    if effect_cleanup_function_is_async(function_id, ctx)
        || effect_cleanup_function_is_generator(function_id, ctx)
    {
        return false;
    }
    let matching_calls = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
                return false;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if call.arguments.is_empty()
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id()
                        == Some(symbol_id))
        })
        .collect::<Vec<_>>();
    matching_calls.iter().any(|call| {
        effect_cleanup_node_is_unconditional_from(call, function_id, ctx)
            && !effect_cleanup_has_earlier_await(function_id, call.span().start, ctx)
    }) || effect_cleanup_nodes_cover_if_branches(function_id, &matching_calls, ctx)
}

fn effect_cleanup_effect_invocations_disable_leak(
    function_id: NodeId,
    leak_node_id: NodeId,
    invocations: &EffectCleanupEffectInvocations,
    ctx: &LintContext<'_>,
) -> bool {
    let parameters = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return false,
    };
    if parameters.items.is_empty() && parameters.rest.is_none() {
        return false;
    }
    !invocations.has_indirect
        && !invocations.direct_invocation_ids.is_empty()
        && invocations.direct_invocation_ids.iter().all(|call_id| {
            let AstKind::CallExpression(call) = ctx.nodes().get_node(*call_id).kind() else {
                return false;
            };
            let parameter_values =
                effect_cleanup_invocation_parameter_values(parameters, call, leak_node_id, ctx);
            effect_cleanup_leak_path_is_disabled(function_id, leak_node_id, &parameter_values, ctx)
        })
}

fn effect_cleanup_invocation_parameter_values(
    parameters: &FormalParameters<'_>,
    call: &CallExpression<'_>,
    leak_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashMap<SymbolId, EffectCleanupInvocationValue> {
    let leak_start = ctx.nodes().get_node(leak_node_id).span().start;
    let mut parameter_values = FxHashMap::default();
    for (parameter_index, parameter) in parameters.items.iter().enumerate() {
        let (binding, default_value) = match &parameter.pattern {
            BindingPattern::BindingIdentifier(binding) => (binding, None),
            BindingPattern::AssignmentPattern(assignment) => {
                let BindingPattern::BindingIdentifier(binding) = &assignment.left else {
                    continue;
                };
                (binding, Some(&assignment.right))
            }
            _ => continue,
        };
        let mut parameter_value = match call.arguments.get(parameter_index) {
            None => EffectCleanupInvocationValue {
                truthiness: Some(false),
                is_definitely_undefined: true,
            },
            Some(argument) => argument.as_expression().map_or(
                EffectCleanupInvocationValue {
                    truthiness: None,
                    is_definitely_undefined: false,
                },
                |expression| effect_cleanup_invocation_value(expression, ctx),
            ),
        };
        if parameter_value.is_definitely_undefined
            && let Some(default_value) = default_value
        {
            parameter_value = effect_cleanup_invocation_value(default_value, ctx);
        }
        let symbol_id = binding.symbol_id();
        if ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| {
                reference.is_write()
                    && ctx.nodes().get_node(reference.node_id()).span().start < leak_start
            })
        {
            parameter_value = EffectCleanupInvocationValue {
                truthiness: None,
                is_definitely_undefined: false,
            };
        }
        parameter_values.insert(symbol_id, parameter_value);
    }
    if let Some(rest) = &parameters.rest
        && let BindingPattern::BindingIdentifier(binding) = &rest.rest.argument
    {
        parameter_values.insert(
            binding.symbol_id(),
            EffectCleanupInvocationValue {
                truthiness: Some(true),
                is_definitely_undefined: false,
            },
        );
    }
    parameter_values
}

fn effect_cleanup_invocation_value(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> EffectCleanupInvocationValue {
    let expression = expression.get_inner_expression();
    if let Some(truthiness) = static_literal_truthiness(expression) {
        return EffectCleanupInvocationValue {
            truthiness: Some(truthiness),
            is_definitely_undefined: false,
        };
    }
    if let Expression::Identifier(identifier) = expression
        && identifier.name == "undefined"
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
    {
        return EffectCleanupInvocationValue {
            truthiness: Some(false),
            is_definitely_undefined: true,
        };
    }
    if matches!(expression, Expression::UnaryExpression(unary)
        if unary.operator == oxc_syntax::operator::UnaryOperator::Void)
    {
        return EffectCleanupInvocationValue {
            truthiness: Some(false),
            is_definitely_undefined: true,
        };
    }
    let truthiness = matches!(
        expression,
        Expression::ArrayExpression(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::ClassExpression(_)
            | Expression::FunctionExpression(_)
            | Expression::NewExpression(_)
            | Expression::ObjectExpression(_)
    )
    .then_some(true);
    EffectCleanupInvocationValue {
        truthiness,
        is_definitely_undefined: false,
    }
}

fn effect_cleanup_invocation_condition_truthiness(
    expression: &Expression<'_>,
    parameter_values: &FxHashMap<SymbolId, EffectCleanupInvocationValue>,
    ctx: &LintContext<'_>,
) -> Option<bool> {
    let expression = expression.get_inner_expression();
    let atomic_value = effect_cleanup_invocation_value(expression, ctx);
    if atomic_value.truthiness.is_some() {
        return atomic_value.truthiness;
    }
    match expression {
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .and_then(|symbol_id| parameter_values.get(&symbol_id)?.truthiness),
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
        {
            effect_cleanup_invocation_condition_truthiness(&unary.argument, parameter_values, ctx)
                .map(|truthiness| !truthiness)
        }
        Expression::LogicalExpression(logical) => {
            let left = effect_cleanup_invocation_condition_truthiness(
                &logical.left,
                parameter_values,
                ctx,
            );
            let right = effect_cleanup_invocation_condition_truthiness(
                &logical.right,
                parameter_values,
                ctx,
            );
            match logical.operator {
                oxc_syntax::operator::LogicalOperator::And => {
                    if left == Some(false) || right == Some(false) {
                        Some(false)
                    } else if left == Some(true) && right == Some(true) {
                        Some(true)
                    } else {
                        None
                    }
                }
                oxc_syntax::operator::LogicalOperator::Or => {
                    if left == Some(true) || right == Some(true) {
                        Some(true)
                    } else if left == Some(false) && right == Some(false) {
                        Some(false)
                    } else {
                        None
                    }
                }
                oxc_syntax::operator::LogicalOperator::Coalesce => None,
            }
        }
        Expression::ConditionalExpression(conditional) => {
            match effect_cleanup_invocation_condition_truthiness(
                &conditional.test,
                parameter_values,
                ctx,
            ) {
                Some(true) => effect_cleanup_invocation_condition_truthiness(
                    &conditional.consequent,
                    parameter_values,
                    ctx,
                ),
                Some(false) => effect_cleanup_invocation_condition_truthiness(
                    &conditional.alternate,
                    parameter_values,
                    ctx,
                ),
                None => {
                    let consequent = effect_cleanup_invocation_condition_truthiness(
                        &conditional.consequent,
                        parameter_values,
                        ctx,
                    );
                    let alternate = effect_cleanup_invocation_condition_truthiness(
                        &conditional.alternate,
                        parameter_values,
                        ctx,
                    );
                    (consequent == alternate).then_some(consequent).flatten()
                }
            }
        }
        Expression::CallExpression(call)
            if matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "Boolean"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()) =>
        {
            call.arguments
                .first()
                .and_then(Argument::as_expression)
                .and_then(|argument| {
                    effect_cleanup_invocation_condition_truthiness(argument, parameter_values, ctx)
                })
        }
        _ => None,
    }
}

fn effect_cleanup_leak_path_is_disabled(
    function_id: NodeId,
    leak_node_id: NodeId,
    parameter_values: &FxHashMap<SymbolId, EffectCleanupInvocationValue>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child_id = leak_node_id;
    loop {
        let ancestor = ctx.nodes().parent_node(child_id);
        if ancestor.id() == function_id {
            return false;
        }
        let child_span = ctx.nodes().get_node(child_id).span();
        if let AstKind::BlockStatement(block) = ancestor.kind()
            && let Some(child_index) = block
                .body
                .iter()
                .position(|statement| statement.span() == child_span)
        {
            for preceding_statement in &block.body[..child_index] {
                let oxc_ast::ast::Statement::IfStatement(guard) = preceding_statement else {
                    continue;
                };
                if guard.alternate.is_none()
                    && statement_always_exits(&guard.consequent)
                    && effect_cleanup_invocation_condition_truthiness(
                        &guard.test,
                        parameter_values,
                        ctx,
                    ) == Some(true)
                {
                    return true;
                }
            }
        }
        let required_truthiness = match ancestor.kind() {
            AstKind::IfStatement(statement) => {
                if statement.consequent.span() == child_span {
                    Some((&statement.test, true))
                } else if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span() == child_span)
                {
                    Some((&statement.test, false))
                } else {
                    None
                }
            }
            AstKind::ConditionalExpression(expression) => {
                if expression.consequent.span() == child_span {
                    Some((&expression.test, true))
                } else if expression.alternate.span() == child_span {
                    Some((&expression.test, false))
                } else {
                    None
                }
            }
            AstKind::LogicalExpression(expression)
                if expression.right.span() == child_span
                    && expression.operator != oxc_syntax::operator::LogicalOperator::Coalesce =>
            {
                Some((
                    &expression.left,
                    expression.operator == oxc_syntax::operator::LogicalOperator::And,
                ))
            }
            AstKind::WhileStatement(statement) if statement.body.span() == child_span => {
                Some((&statement.test, true))
            }
            AstKind::DoWhileStatement(statement) if statement.body.span() == child_span => {
                Some((&statement.test, true))
            }
            AstKind::ForStatement(statement) if statement.body.span() == child_span => {
                statement.test.as_ref().map(|test| (test, true))
            }
            _ => None,
        };
        if let Some((condition, required_truthiness)) = required_truthiness
            && effect_cleanup_invocation_condition_truthiness(condition, parameter_values, ctx)
                .is_some_and(|actual_truthiness| actual_truthiness != required_truthiness)
        {
            return true;
        }
        child_id = ancestor.id();
    }
}

fn effect_cleanup_resource_noun(kind: ResourceKind) -> &'static str {
    match kind {
        ResourceKind::Subscribe => "subscription",
        ResourceKind::Timer => "timer",
        ResourceKind::Socket => "connection",
    }
}

fn effect_cleanup_is_retained_function(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    if effect_cleanup_function_is_effect_callback(function_id, ctx) {
        return false;
    }
    if effect_cleanup_assigned_react_ref_key(function_id, ctx).is_some() {
        return effect_cleanup_is_ref_effect_invoked_function(function_id, ctx);
    }
    if effect_cleanup_function_is_react_ref_callback(function_id, ctx) {
        return true;
    }
    if effect_cleanup_node_is_jsx_event_handler(function_id, ctx) {
        return true;
    }
    if effect_cleanup_function_is_inline_config_handler(function_id, ctx) {
        return true;
    }
    if effect_cleanup_function_is_use_callback_argument(function_id, ctx) {
        return true;
    }
    if !effect_cleanup_is_retained_component_scope_function(function_id, ctx) {
        return false;
    }
    let Some(symbol_id) = effect_cleanup_retained_function_binding_symbol_id(function_id, ctx)
    else {
        return false;
    };
    effect_cleanup_function_has_external_reference(function_id, symbol_id, ctx)
}

fn effect_cleanup_is_retained_component_scope_function(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let node = ctx.nodes().get_node(function_id);
    match node.kind() {
        AstKind::Function(function) if function.r#type == FunctionType::FunctionExpression => {
            matches!(
                ctx.nodes().parent_node(function_id).kind(),
                AstKind::VariableDeclarator(_)
            ) && effect_cleanup_enclosing_component_or_hook_function_id(function_id, ctx).is_some()
        }
        AstKind::ArrowFunctionExpression(_) => {
            matches!(
                ctx.nodes().parent_node(function_id).kind(),
                AstKind::VariableDeclarator(_)
            ) && effect_cleanup_enclosing_component_or_hook_function_id(function_id, ctx).is_some()
        }
        _ => false,
    }
}

fn effect_cleanup_function_has_external_reference(
    function_id: NodeId,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            effect_cleanup_nearest_function_id(reference.node_id(), ctx) != Some(function_id)
        })
}

fn effect_cleanup_function_is_effect_callback(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    if !effect_cleanup_is_effect_callback_function(function_id, ctx) {
        return false;
    }
    ctx.nodes().ancestors(function_id).any(|ancestor| {
        let AstKind::CallExpression(call) = ancestor.kind() else {
            return false;
        };
        effect_cleanup_is_effect_hook_call(call, ctx)
            && call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .and_then(|argument| {
                    effect_cleanup_exact_local_function_id(argument, ctx, &mut FxHashSet::default())
                })
                == Some(function_id)
    })
}

fn effect_cleanup_is_effect_callback_function(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.r#type == FunctionType::FunctionExpression,
        AstKind::ArrowFunctionExpression(_) => true,
        _ => false,
    }
}

fn effect_cleanup_function_is_use_callback_argument(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().ancestors(function_id).any(|ancestor| {
        let AstKind::CallExpression(call) = ancestor.kind() else {
            return false;
        };
        effect_cleanup_react_hook_call_matches(call, &["useCallback"], ctx)
            && call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .and_then(|argument| {
                    effect_cleanup_exact_local_function_id(argument, ctx, &mut FxHashSet::default())
                })
                == Some(function_id)
    })
}

fn effect_cleanup_use_callback_is_jsx_event_handler(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().ancestors(function_id).any(|ancestor| {
        matches!(ancestor.kind(), AstKind::CallExpression(call)
            if effect_cleanup_react_hook_call_matches(call, &["useCallback"], ctx))
            && effect_cleanup_node_is_jsx_event_handler(ancestor.id(), ctx)
    })
}

fn effect_cleanup_node_is_jsx_event_handler(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::JSXAttribute(attribute) => {
                return matches!(&attribute.name, JSXAttributeName::Identifier(identifier)
                    if identifier.name.strip_prefix("on")
                        .and_then(|suffix| suffix.as_bytes().first())
                        .is_some_and(u8::is_ascii_uppercase));
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                if ancestor.id() != node_id =>
            {
                return false;
            }
            _ => {}
        }
    }
    false
}

fn effect_cleanup_function_is_inline_config_handler(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    let property_node = ctx.nodes().parent_node(function_id);
    let AstKind::ObjectProperty(property) = property_node.kind() else {
        return false;
    };
    if property.computed
        || property.value.span() != function_node.span()
        || !property.key.static_name().is_some_and(|name| {
            name.strip_prefix("on")
                .and_then(|suffix| suffix.as_bytes().first())
                .is_some_and(u8::is_ascii_uppercase)
        })
    {
        return false;
    }
    let object_node = ctx.nodes().parent_node(property_node.id());
    let AstKind::ObjectExpression(_) = object_node.kind() else {
        return false;
    };
    let object_parent = ctx.nodes().parent_node(object_node.id());
    let is_passed_inline = match object_parent.kind() {
        AstKind::CallExpression(call) => call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|argument| argument.span() == object_node.span())
        }),
        AstKind::JSXExpressionContainer(_) => true,
        _ => false,
    };
    is_passed_inline && find_render_phase_component_or_hook(property_node, ctx).is_some()
}

fn effect_cleanup_function_is_react_ref_callback(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if effect_cleanup_node_is_jsx_ref(function_id, ctx) {
        return true;
    }
    if effect_cleanup_function_is_returned_react_hook_ref(function_id, ctx) {
        return true;
    }
    let Some(symbol_id) = effect_cleanup_retained_function_binding_symbol_id(function_id, ctx)
    else {
        return false;
    };
    let mut has_reference = false;
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        has_reference = true;
        if !effect_cleanup_node_is_jsx_ref(reference.node_id(), ctx) {
            return false;
        }
    }
    has_reference
}

fn effect_cleanup_function_is_returned_react_hook_ref(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = effect_cleanup_retained_function_binding_symbol_id(function_id, ctx)
    else {
        return false;
    };
    let Some(owner_id) = effect_cleanup_nearest_function_id(function_id, ctx) else {
        return false;
    };
    let owner_node = ctx.nodes().get_node(owner_id);
    if component_or_hook_function_name(owner_node, ctx)
        .is_none_or(|name| !crate::utils::is_react_hook_name(name))
    {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_root_id =
                effect_cleanup_transparent_root_node_id(reference.node_id(), ctx);
            let reference_root = ctx.nodes().get_node(reference_root_id);
            let property_node = ctx.nodes().parent_node(reference_root_id);
            let AstKind::ObjectProperty(property) = property_node.kind() else {
                return false;
            };
            if property.value.span() != reference_root.span()
                || property
                    .key
                    .static_name()
                    .is_none_or(|name| name != "ref" && !name.ends_with("Ref"))
            {
                return false;
            }
            let object_node = ctx.nodes().parent_node(property_node.id());
            if !matches!(object_node.kind(), AstKind::ObjectExpression(_)) {
                return false;
            }
            let object_root_id = effect_cleanup_transparent_root_node_id(object_node.id(), ctx);
            let return_node = ctx.nodes().parent_node(object_root_id);
            matches!(return_node.kind(), AstKind::ReturnStatement(statement)
            if statement.argument.as_ref().is_some_and(|argument| {
                argument.span() == ctx.nodes().get_node(object_root_id).span()
                    && effect_cleanup_nearest_function_id(return_node.id(), ctx) == Some(owner_id)
            }))
        })
}

fn effect_cleanup_node_is_jsx_ref(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::JSXAttribute(attribute) => {
                return matches!(&attribute.name, JSXAttributeName::Identifier(identifier)
                    if identifier.name == "ref");
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                if ancestor.id() != node_id =>
            {
                return false;
            }
            _ => {}
        }
    }
    false
}

fn effect_cleanup_retained_function_binding_symbol_id(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let node = ctx.nodes().get_node(function_id);
    if let AstKind::Function(function) = node.kind()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.symbol_id());
    }
    let function_root_id = effect_cleanup_transparent_root_node_id(function_id, ctx);
    let function_root = ctx.nodes().get_node(function_root_id);
    let parent = ctx.nodes().parent_node(function_root_id);
    match parent.kind() {
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == function_root.span()) =>
        {
            declarator
                .id
                .get_binding_identifier()
                .map(|identifier| identifier.symbol_id())
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.right.span() == function_root.span() =>
        {
            let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) =
                &assignment.left
            else {
                return None;
            };
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
        }
        AstKind::CallExpression(call)
            if effect_cleanup_react_hook_call_matches(call, &["useCallback"], ctx)
                && call.arguments.first().is_some_and(|argument| {
                    argument.as_expression().is_some_and(|argument| {
                        argument.span().contains_inclusive(function_root.span())
                    })
                }) =>
        {
            let call_parent = ctx.nodes().parent_node(parent.id());
            let AstKind::VariableDeclarator(declarator) = call_parent.kind() else {
                return None;
            };
            declarator
                .id
                .get_binding_identifier()
                .map(|identifier| identifier.symbol_id())
        }
        _ => None,
    }
}

fn effect_cleanup_is_potentially_reachable_function(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if effect_cleanup_node_is_jsx_event_handler(function_id, ctx)
        || effect_cleanup_use_callback_is_jsx_event_handler(function_id, ctx)
        || effect_cleanup_function_is_inline_config_handler(function_id, ctx)
        || effect_cleanup_is_returned_effect_cleanup(function_id, ctx)
    {
        return true;
    }
    if effect_cleanup_is_deferred_callback_function(function_id, ctx) {
        return true;
    }
    effect_cleanup_retained_function_binding_symbol_id(function_id, ctx).is_some_and(|symbol_id| {
        effect_cleanup_function_has_external_reference(function_id, symbol_id, ctx)
    })
}

fn effect_cleanup_enclosing_component_or_hook_function_id(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let enclosing_function = ctx.nodes().ancestors(function_id).find(|ancestor| {
        ancestor.id() != function_id
            && matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
    })?;
    component_or_hook_function_name(enclosing_function, ctx)
        .is_some()
        .then_some(enclosing_function.id())
}

fn effect_cleanup_is_use_sync_external_store_subscribe_function(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = effect_cleanup_retained_function_binding_symbol_id(function_id, ctx)
    else {
        return false;
    };
    effect_cleanup_symbol_is_exclusively_external_store_subscribe(
        symbol_id,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn effect_cleanup_symbol_is_exclusively_external_store_subscribe(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    let references = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .map(|reference| reference.node_id())
        .collect::<Vec<_>>();
    !references.is_empty()
        && references.into_iter().all(|reference_id| {
            let reference_span = ctx.nodes().get_node(reference_id).span();
            let root_id = effect_cleanup_transparent_root_node_id(reference_id, ctx);
            let parent = ctx.nodes().parent_node(root_id);
            if let AstKind::CallExpression(call) = parent.kind()
                && call.arguments.first().is_some_and(|argument| {
                    argument
                        .as_expression()
                        .is_some_and(|argument| argument.span().contains_inclusive(reference_span))
                })
            {
                return effect_cleanup_react_hook_call_matches(
                    call,
                    &["useSyncExternalStore"],
                    ctx,
                );
            }
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                return false;
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| !initializer.span().contains_inclusive(reference_span))
            {
                return false;
            }
            let variable_declaration = ctx.nodes().parent_node(parent.id());
            if !matches!(variable_declaration.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
            {
                return false;
            }
            declarator
                .id
                .get_binding_identifier()
                .is_some_and(|identifier| {
                    effect_cleanup_symbol_is_exclusively_external_store_subscribe(
                        identifier.symbol_id(),
                        ctx,
                        visited_symbol_ids,
                    )
                })
        })
}

fn effect_cleanup_transparent_root_node_id(node_id: NodeId, ctx: &LintContext<'_>) -> NodeId {
    let mut root_id = node_id;
    loop {
        let parent = ctx.nodes().parent_node(root_id);
        if !matches!(
            parent.kind(),
            AstKind::ParenthesizedExpression(_)
                | AstKind::TSAsExpression(_)
                | AstKind::TSSatisfiesExpression(_)
                | AstKind::TSNonNullExpression(_)
                | AstKind::TSTypeAssertion(_)
                | AstKind::ChainExpression(_)
        ) {
            return root_id;
        }
        root_id = parent.id();
    }
}

fn effect_cleanup_assigned_react_ref_key(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let root_id = effect_cleanup_transparent_root_node_id(function_id, ctx);
    let parent = ctx.nodes().parent_node(root_id);
    let AstKind::AssignmentExpression(assignment) = parent.kind() else {
        return None;
    };
    if assignment.operator.as_str() != "="
        || !assignment
            .right
            .span()
            .contains_inclusive(ctx.nodes().get_node(root_id).span())
    {
        return None;
    }
    let member = assignment
        .left
        .as_simple_assignment_target()?
        .as_member_expression()?;
    if effect_cleanup_resolved_member_name(member, ctx).as_deref() != Some("current")
        || !effect_cleanup_expression_is_react_ref(member.object(), ctx)
    {
        return None;
    }
    effect_cleanup_expression_key(member.object(), ctx, &mut FxHashSet::default())
}

fn effect_cleanup_expression_is_react_ref<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    effect_cleanup_expression_is_react_ref_inner(expression, ctx, &mut FxHashSet::default())
}

fn effect_cleanup_expression_is_react_ref_inner<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    let Some(initializer) = effect_cleanup_stable_initializer(symbol_id, ctx) else {
        return false;
    };
    match initializer.get_inner_expression() {
        Expression::CallExpression(call) => {
            effect_cleanup_react_hook_call_matches(call, &["useRef"], ctx)
        }
        Expression::Identifier(_) => {
            effect_cleanup_expression_is_react_ref_inner(initializer, ctx, visited_symbol_ids)
        }
        _ => false,
    }
}

fn effect_cleanup_is_ref_effect_invoked_function(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(ref_key) = effect_cleanup_assigned_react_ref_key(function_id, ctx) else {
        return false;
    };
    !effect_cleanup_ref_effect_invocations(&ref_key, ctx).is_empty()
}

fn effect_cleanup_ref_effect_invocations(
    ref_key: &str,
    ctx: &LintContext<'_>,
) -> Vec<(NodeId, NodeId)> {
    let mut invocations = Vec::new();
    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(effect_call) = candidate.kind() else {
            continue;
        };
        if !effect_cleanup_is_effect_hook_call(effect_call, ctx) {
            continue;
        }
        let Some(callback_id) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(|callback| {
                effect_cleanup_exact_local_function_id(callback, ctx, &mut FxHashSet::default())
            })
        else {
            continue;
        };
        for effect_child in ctx.nodes().iter() {
            if effect_cleanup_nearest_function_id(effect_child.id(), ctx) != Some(callback_id) {
                continue;
            }
            let AstKind::CallExpression(call) = effect_child.kind() else {
                continue;
            };
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                continue;
            };
            if effect_cleanup_resolved_member_name(member, ctx).as_deref() == Some("current")
                && effect_cleanup_expression_key(member.object(), ctx, &mut FxHashSet::default())
                    .as_deref()
                    == Some(ref_key)
            {
                invocations.push((effect_child.id(), callback_id));
            }
        }
    }
    invocations
}

fn effect_cleanup_every_ref_effect_invocation_returns_result(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(ref_key) = effect_cleanup_assigned_react_ref_key(function_id, ctx) else {
        return false;
    };
    let invocations = effect_cleanup_ref_effect_invocations(&ref_key, ctx);
    !invocations.is_empty()
        && invocations.into_iter().all(|(call_id, callback_id)| {
            effect_cleanup_expression_is_returned_from_function(call_id, callback_id, ctx)
        })
}

fn effect_cleanup_expression_is_returned_from_function(
    node_id: NodeId,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut root_id = effect_cleanup_transparent_root_node_id(node_id, ctx);
    loop {
        let parent = ctx.nodes().parent_node(root_id);
        match parent.kind() {
            AstKind::SequenceExpression(sequence)
                if sequence.expressions.last().is_some_and(|expression| {
                    expression.span() == ctx.nodes().get_node(root_id).span()
                }) =>
            {
                root_id = parent.id();
            }
            AstKind::LogicalExpression(_) | AstKind::ConditionalExpression(_) => {
                root_id = parent.id();
            }
            AstKind::ReturnStatement(_) => {
                return effect_cleanup_nearest_function_id(parent.id(), ctx) == Some(function_id);
            }
            AstKind::ArrowFunctionExpression(function)
                if function.node_id.get() == function_id && function.get_expression().is_some() =>
            {
                return true;
            }
            _ => return false,
        }
    }
}

fn effect_cleanup_resource_result_escapes(
    usage: &ResourceUsage,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if effect_cleanup_function_is_async(function_id, ctx)
        || effect_cleanup_node_is_jsx_event_handler(function_id, ctx)
        || effect_cleanup_use_callback_is_jsx_event_handler(function_id, ctx)
    {
        return false;
    }
    if effect_cleanup_expression_is_returned_from_function(usage.node_id, function_id, ctx) {
        return true;
    }
    let Some(symbol_id) =
        effect_cleanup_stored_result_symbol_id(ctx.nodes().get_node(usage.node_id), ctx)
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable) if variable.kind.is_const()
    ) || effect_cleanup_symbol_has_write(symbol_id, ctx)
    {
        return false;
    }
    let matching_returns = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .filter_map(|reference| {
            let mut root_id = effect_cleanup_transparent_root_node_id(reference.node_id(), ctx);
            loop {
                let parent = ctx.nodes().parent_node(root_id);
                match parent.kind() {
                    AstKind::SequenceExpression(sequence)
                        if sequence.expressions.last().is_some_and(|expression| {
                            expression.span() == ctx.nodes().get_node(root_id).span()
                        }) =>
                    {
                        root_id = effect_cleanup_transparent_root_node_id(parent.id(), ctx);
                    }
                    AstKind::LogicalExpression(_) | AstKind::ConditionalExpression(_) => {
                        root_id = effect_cleanup_transparent_root_node_id(parent.id(), ctx);
                    }
                    AstKind::ReturnStatement(_)
                        if effect_cleanup_nearest_function_id(parent.id(), ctx)
                            == Some(function_id) =>
                    {
                        return Some(parent);
                    }
                    _ => return None,
                }
            }
        })
        .collect::<Vec<_>>();
    matching_returns.iter().any(|return_node| {
        effect_cleanup_node_is_unconditional_from(return_node, function_id, ctx)
            || effect_cleanup_nodes_share_branch_path(
                ctx.nodes().get_node(usage.node_id),
                return_node,
                function_id,
                ctx,
            )
    }) || effect_cleanup_nodes_cover_if_branches(function_id, &matching_returns, ctx)
}

fn effect_cleanup_resource_result_is_persisted_without_return(
    usage: &ResourceUsage,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) =
        effect_cleanup_stored_result_symbol_id(ctx.nodes().get_node(usage.node_id), ctx)
    else {
        return false;
    };
    let references = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .map(|reference| reference.node_id())
        .collect::<Vec<_>>();
    if references.iter().any(|reference_id| {
        effect_cleanup_expression_is_returned_from_function(*reference_id, function_id, ctx)
    }) {
        return false;
    }
    references.into_iter().any(|reference_id| {
        let reference_span = ctx.nodes().get_node(reference_id).span();
        let mut is_inside_object_property = false;
        for ancestor in ctx.nodes().ancestors(reference_id) {
            if ancestor.id() == function_id {
                return false;
            }
            if matches!(ancestor.kind(), AstKind::ObjectProperty(_)) {
                is_inside_object_property = true;
                continue;
            }
            if is_inside_object_property && let AstKind::CallExpression(call) = ancestor.kind() {
                return call.arguments.iter().any(|argument| {
                    argument
                        .as_expression()
                        .is_some_and(|argument| argument.span().contains_inclusive(reference_span))
                });
            }
        }
        false
    })
}

fn effect_cleanup_external_store_returns_cleanup(
    usage: &ResourceUsage,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut root_id = effect_cleanup_transparent_root_node_id(usage.node_id, ctx);
    loop {
        let root_span = ctx.nodes().get_node(root_id).span();
        let parent = ctx.nodes().parent_node(root_id);
        match parent.kind() {
            AstKind::ConditionalExpression(conditional) => {
                let fallback = if conditional.consequent.span().contains_inclusive(root_span) {
                    &conditional.alternate
                } else if conditional.alternate.span().contains_inclusive(root_span) {
                    &conditional.consequent
                } else {
                    return false;
                };
                if effect_cleanup_exact_local_function_id(fallback, ctx, &mut FxHashSet::default())
                    .is_none()
                {
                    return false;
                }
                root_id = effect_cleanup_transparent_root_node_id(parent.id(), ctx);
            }
            AstKind::LogicalExpression(logical)
                if logical.operator.as_str() == "??"
                    && logical.left.span().contains_inclusive(root_span)
                    && effect_cleanup_exact_local_function_id(
                        &logical.right,
                        ctx,
                        &mut FxHashSet::default(),
                    )
                    .is_some() =>
            {
                root_id = effect_cleanup_transparent_root_node_id(parent.id(), ctx);
            }
            _ => {
                return effect_cleanup_expression_is_returned_from_function(
                    root_id,
                    function_id,
                    ctx,
                );
            }
        }
    }
}

fn effect_cleanup_has_split_lifecycle_release(
    usage: &ResourceUsage,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if !effect_cleanup_resource_is_stored_in_react_ref(usage.node_id, ctx) {
        return false;
    }
    let Some(component_id) =
        effect_cleanup_enclosing_component_or_hook_function_id(function_id, ctx)
    else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(effect_call) = candidate.kind() else {
            return false;
        };
        if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(component_id)
            || !effect_cleanup_is_effect_hook_call(effect_call, ctx)
        {
            return false;
        }
        let Some(effect_callback_id) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(|callback| {
                effect_cleanup_exact_local_function_id(callback, ctx, &mut FxHashSet::default())
            })
        else {
            return false;
        };
        effect_cleanup_returned_cleanup_function_ids(effect_callback_id, ctx)
            .into_iter()
            .any(|cleanup_function_id| {
                effect_cleanup_function_releases_usage(
                    cleanup_function_id,
                    usage,
                    ctx,
                    &mut FxHashSet::default(),
                )
            })
    })
}

fn effect_cleanup_releases_previous_handle(usage: &ResourceUsage, ctx: &LintContext<'_>) -> bool {
    let Some(owner_id) = effect_cleanup_nearest_function_id(usage.node_id, ctx) else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        if candidate.span().start >= usage.span.start
            || effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(owner_id)
        {
            return false;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        if !effect_cleanup_release_call_matches(
            candidate.id(),
            call,
            usage,
            ctx,
            &FxHashMap::default(),
        ) {
            return false;
        }
        let release_anchor = effect_cleanup_live_handle_guard(
            candidate,
            owner_id,
            usage,
            &FxHashMap::default(),
            ctx,
        )
        .unwrap_or(candidate);
        effect_cleanup_node_is_unconditional_from(release_anchor, owner_id, ctx)
            && !effect_cleanup_has_earlier_await(owner_id, candidate.span().start, ctx)
    })
}

fn effect_cleanup_resource_is_stored_in_react_ref(
    resource_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let root_id = effect_cleanup_transparent_root_node_id(resource_node_id, ctx);
    let parent = ctx.nodes().parent_node(root_id);
    let AstKind::AssignmentExpression(assignment) = parent.kind() else {
        return false;
    };
    if assignment.operator.as_str() != "=" {
        return false;
    }
    let Some(member) = assignment
        .left
        .as_simple_assignment_target()
        .and_then(|target| target.as_member_expression())
    else {
        return false;
    };
    effect_cleanup_resolved_member_name(member, ctx).as_deref() == Some("current")
        && effect_cleanup_expression_is_react_ref(member.object(), ctx)
}

fn effect_cleanup_is_effect_hook_call<'a>(
    call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if effect_cleanup_react_hook_call_matches(call, &EFFECT_HOOK_NAMES, ctx) {
        return true;
    }
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    IMPORTED_EFFECT_WRAPPER_NAMES.contains(&identifier.name.as_str())
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                matches!(
                    ctx.symbol_declaration(symbol_id).kind(),
                    AstKind::ImportSpecifier(_)
                        | AstKind::ImportDefaultSpecifier(_)
                        | AstKind::ImportNamespaceSpecifier(_)
                )
            })
}

fn effect_cleanup_react_hook_call_matches<'a>(
    call: &CallExpression<'a>,
    hook_names: &[&str],
    ctx: &LintContext<'a>,
) -> bool {
    effect_cleanup_is_react_hook_callee(&call.callee, hook_names, ctx, &mut FxHashSet::default())
}

fn effect_cleanup_is_react_hook_callee<'a>(
    expression: &Expression<'a>,
    hook_names: &[&str],
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return hook_names.contains(&identifier.name.as_str());
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            if effect_cleanup_symbol_is_react_import(symbol_id, ctx)
                && effect_cleanup_imported_name(symbol_id, ctx)
                    .is_some_and(|name| hook_names.contains(&name.as_str()))
            {
                return true;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                && !effect_cleanup_symbol_has_write(symbol_id, ctx)
                && declarator.init.as_ref().is_some_and(|initializer| {
                    effect_cleanup_is_react_hook_callee(
                        initializer,
                        hook_names,
                        ctx,
                        visited_symbol_ids,
                    )
                })
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            member
                .static_property_name()
                .is_some_and(|name| hook_names.contains(&name))
                && effect_cleanup_is_react_namespace(member.object(), ctx)
        }),
    }
}

fn effect_cleanup_imported_name(symbol_id: SymbolId, ctx: &LintContext<'_>) -> Option<String> {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::ImportSpecifier(specifier) => {
            let name = match &specifier.imported {
                oxc_ast::ast::ModuleExportName::IdentifierName(identifier) => {
                    identifier.name.as_str()
                }
                oxc_ast::ast::ModuleExportName::IdentifierReference(identifier) => {
                    identifier.name.as_str()
                }
                oxc_ast::ast::ModuleExportName::StringLiteral(literal) => literal.value.as_str(),
            };
            Some(name.to_string())
        }
        _ => None,
    }
}

fn effect_cleanup_symbol_is_react_import(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        matches!(
            entry.module_request.name(),
            "react" | "react-dom" | "preact/compat" | "preact/hooks" | "@wordpress/element"
        ) && ctx
            .scoping()
            .get_root_binding(entry.local_name.name().into())
            == Some(symbol_id)
    })
}

fn effect_cleanup_is_react_namespace(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return identifier.name == "React";
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    matches!(
        declaration.kind(),
        AstKind::ImportNamespaceSpecifier(_) | AstKind::ImportDefaultSpecifier(_)
    ) && effect_cleanup_symbol_is_react_import(symbol_id, ctx)
}

fn effect_cleanup_callee_name<'a>(call: &'a CallExpression<'a>) -> Option<&'a str> {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(MemberExpression::static_property_name),
    }
}

fn effect_cleanup_exact_local_function_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    let expression = expression.get_inner_expression();
    if matches!(expression, Expression::ArrowFunctionExpression(_))
        || matches!(expression, Expression::FunctionExpression(_))
    {
        return Some(expression.node_id());
    }
    if visited_symbol_ids.len() >= 15 {
        return None;
    }
    match expression {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id)
                || effect_cleanup_symbol_has_write(symbol_id, ctx)
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) if !function.generator => Some(function.node_id.get()),
                AstKind::VariableDeclarator(declarator)
                    if matches!(
                        ctx.nodes().parent_node(declaration.id()).kind(),
                        AstKind::VariableDeclaration(_)
                    ) =>
                {
                    effect_cleanup_exact_local_function_id(
                        declarator.init.as_ref()?,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn effect_cleanup_retained_function_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    if let Expression::CallExpression(call) = expression.get_inner_expression()
        && effect_cleanup_react_hook_call_matches(call, &["useCallback"], ctx)
    {
        return call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(|callback| {
                effect_cleanup_exact_local_function_id(callback, ctx, visited_symbol_ids)
            });
    }
    if let Expression::Identifier(identifier) = expression.get_inner_expression()
        && let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
    {
        if !visited_symbol_ids.insert(symbol_id) || effect_cleanup_symbol_has_write(symbol_id, ctx)
        {
            return None;
        }
        if let Some(initializer) = effect_cleanup_stable_initializer(symbol_id, ctx) {
            return effect_cleanup_retained_function_id(initializer, ctx, visited_symbol_ids);
        }
        return match ctx.symbol_declaration(symbol_id).kind() {
            AstKind::Function(function) if !function.generator => Some(function.node_id.get()),
            _ => None,
        };
    }
    effect_cleanup_exact_local_function_id(expression, ctx, visited_symbol_ids)
}

fn effect_cleanup_symbol_has_write(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
}

fn effect_cleanup_function_is_async(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn effect_cleanup_function_is_generator(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    matches!(
        ctx.nodes().get_node(function_id).kind(),
        AstKind::Function(function) if function.generator
    )
}

fn effect_cleanup_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

struct EffectCleanupExecution {
    function_ids: FxHashSet<NodeId>,
    external_listener_function_ids: FxHashSet<NodeId>,
}

fn effect_cleanup_execution_function_ids(
    root_function_id: NodeId,
    ctx: &LintContext<'_>,
    excluded_function_id: Option<NodeId>,
) -> EffectCleanupExecution {
    let execution_root_span = ctx.nodes().get_node(root_function_id).span();
    let mut execution_function_ids = FxHashSet::default();
    let mut direct_execution_function_ids = FxHashSet::default();
    let mut external_listener_function_ids = FxHashSet::default();
    execution_function_ids.insert(root_function_id);
    direct_execution_function_ids.insert(root_function_id);
    let mut pending = vec![(root_function_id, true)];
    while let Some((function_id, follows_direct_calls)) = pending.pop() {
        for candidate in ctx.nodes().iter() {
            if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
                continue;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                continue;
            };
            if follows_direct_calls {
                if let Some(called_function_id) = effect_cleanup_exact_local_function_id(
                    &call.callee,
                    ctx,
                    &mut FxHashSet::default(),
                ) && Some(called_function_id) != excluded_function_id
                    && !matches!(
                        ctx.nodes().get_node(called_function_id).kind(),
                        AstKind::Function(function) if function.r#type == FunctionType::FunctionDeclaration
                    )
                    && execution_root_span
                        .contains_inclusive(ctx.nodes().get_node(called_function_id).span())
                {
                    effect_cleanup_enqueue_execution_function(
                        called_function_id,
                        true,
                        &mut execution_function_ids,
                        &mut direct_execution_function_ids,
                        &mut pending,
                    );
                }
            }
            if follows_direct_calls && effect_cleanup_is_synchronous_iterator_call(call) {
                for argument_index in 0..call.arguments.len() {
                    effect_cleanup_enqueue_argument_function(
                        call,
                        argument_index,
                        ctx,
                        excluded_function_id,
                        Some(execution_root_span),
                        true,
                        &mut execution_function_ids,
                        &mut direct_execution_function_ids,
                        &mut pending,
                    );
                }
            }
            effect_cleanup_enqueue_owned_callback_functions(
                call,
                ctx,
                excluded_function_id,
                execution_root_span,
                follows_direct_calls,
                &mut execution_function_ids,
                &mut direct_execution_function_ids,
                &mut external_listener_function_ids,
                &mut pending,
            );
        }
    }
    for candidate in ctx.nodes().iter() {
        if !matches!(
            candidate.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) || effect_cleanup_synchronous_iterator_call_for_callback(candidate.id(), ctx).is_none()
        {
            continue;
        }
        let mut owner_id = effect_cleanup_nearest_function_id(candidate.id(), ctx);
        while let Some(function_id) = owner_id {
            if execution_function_ids.contains(&function_id) {
                execution_function_ids.insert(candidate.id());
                break;
            }
            if effect_cleanup_synchronous_iterator_call_for_callback(function_id, ctx).is_none() {
                break;
            }
            owner_id = effect_cleanup_nearest_function_id(function_id, ctx);
        }
    }
    EffectCleanupExecution {
        function_ids: execution_function_ids,
        external_listener_function_ids,
    }
}

fn effect_cleanup_enqueue_execution_function(
    function_id: NodeId,
    follows_direct_calls: bool,
    execution_function_ids: &mut FxHashSet<NodeId>,
    direct_execution_function_ids: &mut FxHashSet<NodeId>,
    pending: &mut Vec<(NodeId, bool)>,
) {
    let is_new_execution_function = execution_function_ids.insert(function_id);
    let is_direct_execution_upgrade =
        follows_direct_calls && direct_execution_function_ids.insert(function_id);
    if is_new_execution_function || is_direct_execution_upgrade {
        pending.push((function_id, follows_direct_calls));
    }
}

fn effect_cleanup_enqueue_argument_function<'a>(
    call: &CallExpression<'a>,
    argument_index: usize,
    ctx: &LintContext<'a>,
    excluded_function_id: Option<NodeId>,
    required_owner_span: Option<Span>,
    follows_direct_calls: bool,
    execution_function_ids: &mut FxHashSet<NodeId>,
    direct_execution_function_ids: &mut FxHashSet<NodeId>,
    pending: &mut Vec<(NodeId, bool)>,
) {
    let Some(argument) = call
        .arguments
        .get(argument_index)
        .and_then(Argument::as_expression)
    else {
        return;
    };
    if let Some(callback_id) =
        effect_cleanup_exact_local_function_id(argument, ctx, &mut FxHashSet::default())
        && Some(callback_id) != excluded_function_id
        && required_owner_span.is_none_or(|owner_span| {
            owner_span.contains_inclusive(ctx.nodes().get_node(callback_id).span())
        })
    {
        effect_cleanup_enqueue_execution_function(
            callback_id,
            follows_direct_calls,
            execution_function_ids,
            direct_execution_function_ids,
            pending,
        );
    }
}

fn effect_cleanup_enqueue_owned_callback_functions<'a>(
    call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
    excluded_function_id: Option<NodeId>,
    execution_root_span: Span,
    follows_direct_calls: bool,
    execution_function_ids: &mut FxHashSet<NodeId>,
    direct_execution_function_ids: &mut FxHashSet<NodeId>,
    external_listener_function_ids: &mut FxHashSet<NodeId>,
    pending: &mut Vec<(NodeId, bool)>,
) {
    if effect_cleanup_timer_name(call).is_some() {
        effect_cleanup_enqueue_argument_function(
            call,
            0,
            ctx,
            excluded_function_id,
            Some(execution_root_span),
            false,
            execution_function_ids,
            direct_execution_function_ids,
            pending,
        );
        return;
    }
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return;
    };
    let Some(method_name) = effect_cleanup_subscription_method_name(member) else {
        return;
    };
    if PROMISE_CHAIN_METHOD_NAMES.contains(&method_name)
        && matches!(
            member.object().get_inner_expression(),
            Expression::CallExpression(_)
        )
    {
        for argument_index in 0..call.arguments.len() {
            effect_cleanup_enqueue_argument_function(
                call,
                argument_index,
                ctx,
                excluded_function_id,
                Some(execution_root_span),
                follows_direct_calls,
                execution_function_ids,
                direct_execution_function_ids,
                pending,
            );
        }
        return;
    }
    if !SUBSCRIPTION_METHOD_NAMES.contains(&method_name) {
        return;
    }
    let argument_index = usize::from(call.arguments.len() != 1);
    if method_name == "addEventListener"
        && let Some(callback_id) = call
            .arguments
            .get(argument_index)
            .and_then(Argument::as_expression)
            .and_then(|callback| {
                effect_cleanup_exact_local_function_id(callback, ctx, &mut FxHashSet::default())
            })
        && Some(callback_id) != excluded_function_id
        && execution_root_span.contains_inclusive(ctx.nodes().get_node(callback_id).span())
    {
        external_listener_function_ids.insert(callback_id);
    }
    effect_cleanup_enqueue_argument_function(
        call,
        argument_index,
        ctx,
        excluded_function_id,
        Some(execution_root_span),
        false,
        execution_function_ids,
        direct_execution_function_ids,
        pending,
    );
}

fn effect_cleanup_is_deferred_callback(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        let is_deferred_call = effect_cleanup_timer_name(call).is_some()
            || call
                .callee
                .get_inner_expression()
                .as_member_expression()
                .is_some_and(|member| {
                    effect_cleanup_subscription_method_name(member).is_some_and(|method_name| {
                        PROMISE_CHAIN_METHOD_NAMES.contains(&method_name)
                            && matches!(
                                member.object().get_inner_expression(),
                                Expression::CallExpression(_)
                            )
                    })
                });
        is_deferred_call
            && call.arguments.iter().any(|argument| {
                argument.as_expression().and_then(|callback| {
                    effect_cleanup_exact_local_function_id(callback, ctx, &mut FxHashSet::default())
                }) == Some(function_id)
            })
    })
}

fn effect_cleanup_is_deferred_callback_function(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if effect_cleanup_is_deferred_callback(function_id, ctx) {
        return true;
    }
    if ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            return false;
        };
        effect_cleanup_subscription_method_name(member)
            .is_some_and(|method_name| SUBSCRIPTION_METHOD_NAMES.contains(&method_name))
            && call.arguments.iter().any(|argument| {
                argument.as_expression().and_then(|callback| {
                    effect_cleanup_exact_local_function_id(callback, ctx, &mut FxHashSet::default())
                }) == Some(function_id)
            })
    }) {
        return true;
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::NewExpression(construction) = candidate.kind() else {
            return false;
        };
        let Expression::Identifier(callee) = construction.callee.get_inner_expression() else {
            return false;
        };
        matches!(
            callee.name.as_str(),
            "IntersectionObserver" | "MutationObserver" | "ResizeObserver"
        ) && construction.arguments.iter().any(|argument| {
            argument.as_expression().and_then(|callback| {
                effect_cleanup_exact_local_function_id(callback, ctx, &mut FxHashSet::default())
            }) == Some(function_id)
        })
    })
}

fn effect_cleanup_has_deferred_execution_path(
    function_id: NodeId,
    callback_id: NodeId,
    ctx: &LintContext<'_>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    if !visited_function_ids.insert(function_id) {
        return false;
    }
    let callback_span = ctx.nodes().get_node(callback_id).span();
    if function_id != callback_id
        && callback_span.contains_inclusive(ctx.nodes().get_node(function_id).span())
        && effect_cleanup_is_deferred_callback_function(function_id, ctx)
    {
        return true;
    }
    ctx.nodes().iter().any(|candidate| {
        if !callback_span.contains_inclusive(candidate.span()) {
            return false;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        if effect_cleanup_exact_local_function_id(&call.callee, ctx, &mut FxHashSet::default())
            != Some(function_id)
        {
            return false;
        }
        let Some(caller_id) = effect_cleanup_nearest_function_id(candidate.id(), ctx) else {
            return false;
        };
        caller_id != callback_id
            && (effect_cleanup_is_deferred_callback_function(caller_id, ctx)
                || effect_cleanup_has_deferred_execution_path(
                    caller_id,
                    callback_id,
                    ctx,
                    &mut visited_function_ids.clone(),
                ))
    })
}

fn effect_cleanup_has_effect_owned_listener_trigger(
    function_id: NodeId,
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(callback_id) {
            return false;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            return false;
        };
        effect_cleanup_subscription_method_name(member) == Some("addEventListener")
            && call.arguments.get(1).is_some_and(|argument| {
                argument.as_expression().and_then(|handler| {
                    effect_cleanup_exact_local_function_id(handler, ctx, &mut FxHashSet::default())
                }) == Some(function_id)
            })
    })
}

fn effect_cleanup_is_synchronous_iterator_call(call: &CallExpression<'_>) -> bool {
    matches!(call.callee.get_inner_expression(), Expression::StaticMemberExpression(member)
        if SYNCHRONOUS_ITERATOR_METHOD_NAMES.contains(&member.property.name.as_str()))
}

fn effect_cleanup_collect_usages(
    callback_id: NodeId,
    execution_function_ids: &FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> Vec<ResourceUsage> {
    let cleanup_function_ids = effect_cleanup_returned_cleanup_function_ids(callback_id, ctx);
    let mut usages = Vec::new();
    for candidate in ctx.nodes().iter() {
        let Some(owner_id) = effect_cleanup_nearest_function_id(candidate.id(), ctx) else {
            continue;
        };
        if !execution_function_ids.contains(&owner_id)
            || cleanup_function_ids.contains(&owner_id)
            || !effect_cleanup_node_is_reachable(candidate, owner_id, ctx)
        {
            continue;
        }
        match candidate.kind() {
            AstKind::NewExpression(construction) => {
                let Expression::Identifier(callee) = construction.callee.get_inner_expression()
                else {
                    continue;
                };
                if !SOCKET_CONSTRUCTOR_NAMES.contains(&callee.name.as_str()) {
                    continue;
                }
                usages.push(ResourceUsage {
                    kind: ResourceKind::Socket,
                    node_id: candidate.id(),
                    span: construction.span,
                    resource_name: callee.name.to_string(),
                    handle_key: effect_cleanup_stored_result_key(candidate, ctx).or_else(|| {
                        effect_cleanup_fluent_chain_stored_result_key(candidate.id(), ctx)
                    }),
                    receiver_key: None,
                    registration_method: None,
                    event_key: None,
                    handler_key: None,
                    capture_key: None,
                    local_abort_controller: None,
                    channel_client_key: None,
                    collection_key: effect_cleanup_resource_collection_key(candidate, ctx),
                });
            }
            AstKind::CallExpression(call) => {
                if let Some(timer_name) = effect_cleanup_timer_name(call) {
                    if timer_name == "setTimeout"
                        && (effect_cleanup_is_deferred_teardown_timer(call, ctx)
                            || effect_cleanup_is_short_inert_ref_timer(call, ctx))
                    {
                        continue;
                    }
                    usages.push(ResourceUsage {
                        kind: ResourceKind::Timer,
                        node_id: candidate.id(),
                        span: call.span,
                        resource_name: timer_name.to_string(),
                        handle_key: effect_cleanup_stored_result_key(candidate, ctx),
                        receiver_key: None,
                        registration_method: Some(timer_name.to_string()),
                        event_key: None,
                        handler_key: None,
                        capture_key: None,
                        local_abort_controller: None,
                        channel_client_key: None,
                        collection_key: effect_cleanup_resource_collection_key(candidate, ctx),
                    });
                    continue;
                }
                let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                    continue;
                };
                let Some(method_name) = effect_cleanup_subscription_method_name(member) else {
                    continue;
                };
                if !SUBSCRIPTION_METHOD_NAMES.contains(&method_name) {
                    continue;
                }
                let has_static_registration_member =
                    matches!(member, MemberExpression::StaticMemberExpression(_));
                let (capture_key, is_once, local_abort_controller, has_external_signal) =
                    effect_cleanup_listener_options(call.arguments.get(2), ctx);
                if method_name == "addEventListener" && (is_once || has_external_signal) {
                    continue;
                }
                usages.push(ResourceUsage {
                    kind: ResourceKind::Subscribe,
                    node_id: candidate.id(),
                    span: call.span,
                    resource_name: method_name.to_string(),
                    handle_key: effect_cleanup_stored_result_key(candidate, ctx).or_else(|| {
                        effect_cleanup_fluent_chain_stored_result_key(candidate.id(), ctx)
                    }),
                    receiver_key: has_static_registration_member
                        .then(|| effect_cleanup_resource_identity_key(member.object(), ctx))
                        .flatten(),
                    registration_method: has_static_registration_member
                        .then(|| method_name.to_string()),
                    event_key: has_static_registration_member
                        .then(|| effect_cleanup_registration_event_key(call, &method_name, ctx))
                        .flatten(),
                    handler_key: has_static_registration_member
                        .then(|| effect_cleanup_registration_handler_key(call, &method_name, ctx))
                        .flatten(),
                    capture_key,
                    local_abort_controller,
                    channel_client_key: effect_cleanup_channel_client_key(member.object(), ctx),
                    collection_key: effect_cleanup_resource_collection_key(candidate, ctx),
                });
            }
            _ => {}
        }
    }
    usages.sort_by_key(|usage| (usage.span.start, std::cmp::Reverse(usage.span.end)));
    usages
}

fn effect_cleanup_timer_name<'a>(call: &'a CallExpression<'a>) -> Option<&'a str> {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return None;
    };
    matches!(identifier.name.as_str(), "setInterval" | "setTimeout")
        .then_some(identifier.name.as_str())
}

fn effect_cleanup_timer_has_global_callee(usage: &ResourceUsage, ctx: &LintContext<'_>) -> bool {
    let AstKind::CallExpression(call) = ctx.nodes().get_node(usage.node_id).kind() else {
        return false;
    };
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_none()
}

fn effect_cleanup_is_deferred_teardown_timer<'a>(
    call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(callback) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    let Some(delay) = call.arguments.get(1).and_then(Argument::as_expression) else {
        return false;
    };
    if !matches!(delay.get_inner_expression(), Expression::NumericLiteral(literal) if literal.value == 0.0)
    {
        return false;
    }
    let Some(callback_id) =
        effect_cleanup_exact_local_function_id(callback, ctx, &mut FxHashSet::default())
    else {
        return false;
    };
    let allowed_methods = [
        "abort",
        "cancel",
        "close",
        "destroy",
        "disconnect",
        "dispose",
        "forEach",
        "log",
        "remove",
        "terminate",
        "warn",
    ];
    let mut found_teardown = false;
    for candidate in ctx.nodes().iter() {
        if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(callback_id) {
            continue;
        }
        let AstKind::CallExpression(callback_call) = candidate.kind() else {
            continue;
        };
        let Some(name) = effect_cleanup_callee_name(callback_call) else {
            return false;
        };
        if !allowed_methods.contains(&name) {
            return false;
        }
        if !matches!(name, "forEach" | "log" | "warn") {
            found_teardown = true;
        }
    }
    found_teardown
}

fn effect_cleanup_is_short_inert_ref_timer<'a>(
    call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(callback) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    let callback_id = match callback.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => function.node_id.get(),
        Expression::FunctionExpression(function) => function.node_id.get(),
        _ => return false,
    };
    let Some(delay) = call.arguments.get(1).and_then(Argument::as_expression) else {
        return false;
    };
    if !matches!(delay.get_inner_expression(), Expression::NumericLiteral(literal)
        if (0.0..=INERT_REF_ONE_SHOT_TIMER_MAX_DELAY_MS).contains(&literal.value))
    {
        return false;
    }
    let mut did_write_ref = false;
    for candidate in ctx.nodes().iter() {
        if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(callback_id) {
            continue;
        }
        match candidate.kind() {
            AstKind::CallExpression(_) | AstKind::UpdateExpression(_) => return false,
            AstKind::AssignmentExpression(assignment) => {
                let Some(member) = assignment
                    .left
                    .as_simple_assignment_target()
                    .and_then(|target| target.as_member_expression())
                else {
                    return false;
                };
                if !effect_cleanup_has_react_ref_current_receiver(
                    member,
                    ctx,
                    &mut FxHashSet::default(),
                ) {
                    return false;
                }
                did_write_ref = true;
            }
            _ => {}
        }
    }
    did_write_ref
}

fn effect_cleanup_has_react_ref_current_receiver<'a>(
    member: &MemberExpression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if effect_cleanup_resolved_member_name(member, ctx).as_deref() == Some("current")
        && effect_cleanup_expression_is_react_ref(member.object(), ctx)
    {
        return true;
    }
    effect_cleanup_expression_has_react_ref_current_receiver(
        member.object(),
        ctx,
        visited_symbol_ids,
    )
}

fn effect_cleanup_expression_has_react_ref_current_receiver<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        return effect_cleanup_has_react_ref_current_receiver(member, ctx, visited_symbol_ids);
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited_symbol_ids.insert(symbol_id) || effect_cleanup_symbol_has_write(symbol_id, ctx) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable) if variable.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    declarator.init.as_ref().is_some_and(|initializer| {
        effect_cleanup_expression_has_react_ref_current_receiver(
            initializer,
            ctx,
            visited_symbol_ids,
        )
    })
}

fn effect_cleanup_timer_callback_matches(
    function_id: NodeId,
    usage: &ResourceUsage,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::CallExpression(call) = ctx.nodes().get_node(usage.node_id).kind() else {
        return false;
    };
    let Some(callback) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    if effect_cleanup_exact_local_function_id(callback, ctx, &mut FxHashSet::default())
        == Some(function_id)
    {
        return true;
    }
    let Expression::Identifier(identifier) = callback else {
        return false;
    };
    let Some(parameter_symbol) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let Some(owner_id) =
        effect_cleanup_nearest_function_id(ctx.symbol_declaration(parameter_symbol).id(), ctx)
    else {
        return false;
    };
    let parameters = match ctx.nodes().get_node(owner_id).kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return false,
    };
    let Some(parameter_index) = parameters.items.iter().position(|parameter| {
        matches!(&parameter.pattern, BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == parameter_symbol)
    }) else {
        return false;
    };
    let Some(owner_symbol) = effect_cleanup_retained_function_binding_symbol_id(owner_id, ctx)
    else {
        return false;
    };
    let mut matched = false;
    for reference in ctx.scoping().get_resolved_references(owner_symbol) {
        let Some(invocation) = effect_cleanup_direct_call_for_reference(reference.node_id(), ctx)
        else {
            return false;
        };
        let AstKind::CallExpression(invocation_call) = invocation.kind() else {
            return false;
        };
        let Some(argument) = invocation_call
            .arguments
            .get(parameter_index)
            .and_then(Argument::as_expression)
        else {
            return false;
        };
        matched |= effect_cleanup_exact_local_function_id(argument, ctx, &mut FxHashSet::default())
            == Some(function_id);
    }
    matched
}

fn effect_cleanup_direct_call_for_reference<'a, 'ctx>(
    reference_id: NodeId,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx AstNode<'a>> {
    let root_id = effect_cleanup_transparent_root_node_id(reference_id, ctx);
    let parent = ctx.nodes().parent_node(root_id);
    matches!(parent.kind(), AstKind::CallExpression(call)
        if call.callee.span() == ctx.nodes().get_node(root_id).span())
    .then_some(parent)
}

fn effect_cleanup_is_timer_callback_for_same_handle(
    function_id: NodeId,
    usage: &ResourceUsage,
    usages: &[ResourceUsage],
    ctx: &LintContext<'_>,
) -> bool {
    usage.handle_key.is_some()
        && usages.iter().any(|candidate| {
            candidate.kind == ResourceKind::Timer
                && candidate.handle_key == usage.handle_key
                && effect_cleanup_nearest_function_id(candidate.node_id, ctx) != Some(function_id)
                && effect_cleanup_timer_callback_matches(function_id, candidate, ctx)
        })
}

fn effect_cleanup_outermost_member_reference(mut node_id: NodeId, ctx: &LintContext<'_>) -> NodeId {
    node_id = effect_cleanup_transparent_root_node_id(node_id, ctx);
    loop {
        let parent = ctx.nodes().parent_node(node_id);
        let object = match parent.kind() {
            AstKind::StaticMemberExpression(member) => &member.object,
            AstKind::ComputedMemberExpression(member) => &member.object,
            _ => return node_id,
        };
        if object.span() != ctx.nodes().get_node(node_id).span() {
            return node_id;
        }
        node_id = effect_cleanup_transparent_root_node_id(parent.id(), ctx);
    }
}

fn effect_cleanup_nested_timer_storage_symbol(
    usage: &ResourceUsage,
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let root_id = effect_cleanup_transparent_root_node_id(usage.node_id, ctx);
    let AstKind::AssignmentExpression(assignment) = ctx.nodes().parent_node(root_id).kind() else {
        return None;
    };
    if assignment.operator.as_str() != "="
        || assignment.right.span() != ctx.nodes().get_node(root_id).span()
    {
        return None;
    }
    if let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left
    {
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        let declaration = ctx.symbol_declaration(symbol_id);
        return (effect_cleanup_nearest_function_id(declaration.id(), ctx) == Some(callback_id)
            && matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable)
                if matches!(variable.kind, oxc_ast::ast::VariableDeclarationKind::Let | oxc_ast::ast::VariableDeclarationKind::Var)))
            .then_some(symbol_id);
    }
    let member = assignment
        .left
        .as_simple_assignment_target()?
        .as_member_expression()?;
    let mut object = member.object().get_inner_expression();
    while let Some(member) = object.as_member_expression() {
        object = member.object().get_inner_expression();
    }
    let Expression::Identifier(identifier) = object else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if effect_cleanup_expression_is_react_ref(object, ctx) {
        return Some(symbol_id);
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    (effect_cleanup_nearest_function_id(declaration.id(), ctx) == Some(callback_id)
        && matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        && matches!(declarator.init.as_ref().map(Expression::get_inner_expression), Some(Expression::ObjectExpression(_))))
        .then_some(symbol_id)
}

fn effect_cleanup_has_safe_timer_handle_writes(
    usage: &ResourceUsage,
    usages: &[ResourceUsage],
    handle_symbol: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let usage_owner = effect_cleanup_nearest_function_id(usage.node_id, ctx);
    let usage_root_id = effect_cleanup_transparent_root_node_id(usage.node_id, ctx);
    let scalar_handle = matches!(ctx.nodes().parent_node(usage_root_id).kind(), AstKind::AssignmentExpression(assignment)
        if matches!(assignment.left, oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(_)));
    ctx.scoping().get_resolved_references(handle_symbol).all(|reference| {
        let root_id = effect_cleanup_outermost_member_reference(reference.node_id(), ctx);
        if effect_cleanup_reference_key(root_id, ctx) != usage.handle_key {
            return scalar_handle;
        }
        let assignment_node = ctx.nodes().parent_node(root_id);
        if matches!(assignment_node.kind(), AstKind::UpdateExpression(update) if update.argument.span() == ctx.nodes().get_node(root_id).span()) {
            return false;
        }
        let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
            return !reference.is_write();
        };
        if assignment.left.span() != ctx.nodes().get_node(root_id).span() {
            return true;
        }
        if assignment.operator.as_str() != "=" {
            return false;
        }
        if assignment.right.get_inner_expression().span() == usage.span {
            return true;
        }
        let Some(owner_id) = effect_cleanup_nearest_function_id(assignment_node.id(), ctx) else {
            return false;
        };
        let assigned_timer = usages.iter().find(|candidate| {
            candidate.kind == ResourceKind::Timer
                && candidate.handle_key == usage.handle_key
                && candidate.span == assignment.right.get_inner_expression().span()
        });
        if let Some(assigned_timer) = assigned_timer
            && (effect_cleanup_is_timer_callback_for_same_handle(owner_id, usage, usages, ctx)
                || usage_owner.is_some_and(|usage_owner| effect_cleanup_timer_callback_matches(usage_owner, assigned_timer, ctx)))
        {
            return true;
        }
        if !matches!(assignment.right.get_inner_expression(), Expression::NullLiteral(_))
            && !matches!(assignment.right.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "undefined" && ctx.is_reference_to_global_variable(identifier))
        {
            return false;
        }
        if effect_cleanup_is_timer_callback_for_same_handle(owner_id, usage, usages, ctx) {
            return true;
        }
        let release_nodes = ctx.nodes().iter().filter(|candidate| {
            if candidate.span().start >= assignment_node.span().start
                || effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(owner_id)
            {
                return false;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            effect_cleanup_release_call_matches(candidate.id(), call, usage, ctx, &FxHashMap::default())
                || effect_cleanup_exact_local_function_id(&call.callee, ctx, &mut FxHashSet::default())
                    .is_some_and(|helper| effect_cleanup_function_releases_usage(helper, usage, ctx, &mut FxHashSet::default()))
        }).collect::<Vec<_>>();
        effect_cleanup_nodes_cover_every_path_before_node(
            assignment_node, &release_nodes, ctx.nodes().get_node(owner_id), ctx,
        )
    })
}

fn effect_cleanup_mapped_resource_collection_symbol<'a>(
    resource_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let callback_id = effect_cleanup_nearest_function_id(resource_node.id(), ctx)?;
    let callback = ctx.nodes().get_node(callback_id);
    if effect_cleanup_function_is_async(callback_id, ctx)
        || effect_cleanup_function_is_generator(callback_id, ctx)
    {
        return None;
    }
    let mapping_node = effect_cleanup_synchronous_iterator_call_for_callback(callback_id, ctx)?;
    let AstKind::CallExpression(mapping) = mapping_node.kind() else {
        return None;
    };
    let Expression::StaticMemberExpression(member) = mapping.callee.get_inner_expression() else {
        return None;
    };
    if member.property.name != "map"
        && !(member.property.name == "from"
            && matches!(&member.object, Expression::Identifier(identifier) if identifier.name == "Array"))
    {
        return None;
    }
    let resource_root = ctx
        .nodes()
        .get_node(effect_cleanup_transparent_root_node_id(
            resource_node.id(),
            ctx,
        ));
    let body = match callback.kind() {
        AstKind::ArrowFunctionExpression(function) => {
            if let Some(expression) = function.get_expression() {
                if expression.span() != resource_root.span() {
                    return None;
                }
                return effect_cleanup_stored_result_symbol_id(mapping_node, ctx);
            }
            function.body.as_function_body()?
        }
        AstKind::Function(function) => function.body.as_deref()?,
        _ => return None,
    };
    let declaration = ctx.nodes().parent_node(resource_root.id());
    let resource_symbol = effect_cleanup_stored_result_symbol_id(resource_node, ctx)?;
    let declaration_statement = ctx.nodes().parent_node(declaration.id());
    if !matches!(declaration_statement.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        || ctx.nodes().parent_node(declaration_statement.id()).span() != body.span
    {
        return None;
    }
    let returns = ctx
        .nodes()
        .iter()
        .filter(|node| {
            matches!(node.kind(), AstKind::ReturnStatement(_))
                && effect_cleanup_nearest_function_id(node.id(), ctx) == Some(callback_id)
        })
        .collect::<Vec<_>>();
    if returns.len() != 1
        || body.statements.last()?.span() != returns[0].span()
        || !matches!(returns[0].kind(), AstKind::ReturnStatement(statement)
            if matches!(statement.argument.as_ref().map(Expression::get_inner_expression), Some(Expression::Identifier(identifier))
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(resource_symbol)))
        || !do_nodes_cover_every_path_after_node(resource_node, &returns, callback, ctx)
    {
        return None;
    }
    effect_cleanup_stored_result_symbol_id(mapping_node, ctx)
}

fn effect_cleanup_direct_timer_collection_symbol(
    usage: &ResourceUsage,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let root_id = effect_cleanup_transparent_root_node_id(usage.node_id, ctx);
    let AstKind::CallExpression(push_call) = ctx.nodes().parent_node(root_id).kind() else {
        return None;
    };
    if !push_call
        .arguments
        .iter()
        .any(|argument| argument.span() == ctx.nodes().get_node(root_id).span())
    {
        return None;
    }
    let Expression::StaticMemberExpression(member) = push_call.callee.get_inner_expression() else {
        return None;
    };
    let Expression::Identifier(identifier) = &member.object else {
        return None;
    };
    if member.property.name != "push" {
        return None;
    }
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let declaration_parent = ctx.nodes().parent_node(declaration.id());
    if matches!(
        ctx.nodes().parent_node(declaration_parent.id()).kind(),
        AstKind::ExportNamedDeclaration(_) | AstKind::ExportDefaultDeclaration(_)
    ) {
        return None;
    }
    matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
        if declarator.id.get_binding_identifier().is_some_and(|binding| binding.symbol_id() == symbol_id)
            && matches!(declarator.init.as_ref().map(Expression::get_inner_expression), Some(Expression::ArrayExpression(array)) if array.elements.is_empty())
            && matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const()))
        .then_some(symbol_id)
}

fn effect_cleanup_node_mutates_timer_collection<'a>(
    node: &AstNode<'a>,
    collection_key: &str,
    return_escapes: bool,
    ctx: &LintContext<'a>,
    visited_functions: &mut FxHashSet<NodeId>,
) -> bool {
    let expression_matches = |expression: &Expression<'_>| {
        effect_cleanup_expression_key(expression, ctx, &mut FxHashSet::default()).as_deref()
            == Some(collection_key)
    };
    let arguments = match node.kind() {
        AstKind::ReturnStatement(statement) => {
            return return_escapes && statement.argument.as_ref().is_some_and(expression_matches);
        }
        AstKind::AssignmentExpression(assignment) => {
            let target_key = effect_cleanup_assignment_target_key(&assignment.left, ctx);
            return target_key.as_deref() == Some(collection_key)
                || target_key.as_deref() == Some(format!("{collection_key}.length").as_str())
                || expression_matches(&assignment.right)
                    && target_key.as_deref() != Some(collection_key)
                || matches!(&assignment.left, oxc_ast::ast::AssignmentTarget::ComputedMemberExpression(member) if expression_matches(&member.object));
        }
        AstKind::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::Delete =>
        {
            return unary
                .argument
                .get_inner_expression()
                .as_member_expression()
                .is_some_and(|member| expression_matches(member.object()));
        }
        AstKind::UpdateExpression(update) => {
            return matches!(&update.argument, oxc_ast::ast::SimpleAssignmentTarget::StaticMemberExpression(member)
                    if member.property.name == "length" && expression_matches(&member.object));
        }
        AstKind::NewExpression(construction) => {
            return construction
                .arguments
                .iter()
                .filter_map(Argument::as_expression)
                .any(expression_matches);
        }
        AstKind::CallExpression(call) => &call.arguments,
        _ => return false,
    };
    let AstKind::CallExpression(call) = node.kind() else {
        return false;
    };
    let member = call.callee.get_inner_expression().as_member_expression();
    let is_array_copy = matches!(call.callee.get_inner_expression(), Expression::StaticMemberExpression(member)
        if member.property.name == "from" && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "Array" && ctx.is_reference_to_global_variable(identifier)));
    if arguments
        .iter()
        .filter_map(Argument::as_expression)
        .any(expression_matches)
        && !is_array_copy
    {
        return true;
    }
    if let Some(member) = member
        && !member.is_computed()
        && expression_matches(member.object())
        && matches!(
            member.static_property_name().as_deref(),
            Some("pop" | "shift" | "splice" | "fill" | "copyWithin" | "clear" | "delete" | "set")
        )
    {
        return true;
    }
    let mut executed_functions = Vec::new();
    if let Some(function_id) =
        effect_cleanup_exact_local_function_id(&call.callee, ctx, &mut FxHashSet::default())
    {
        executed_functions.push(function_id);
    }
    if let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression() {
        let argument_index = if member.property.name == "from"
            && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Array")
        {
            Some(1)
        } else if SYNCHRONOUS_ITERATOR_CALLBACK_METHOD_NAMES
            .contains(&member.property.name.as_str())
        {
            Some(0)
        } else {
            None
        };
        if let Some(function_id) = argument_index
            .and_then(|index| call.arguments.get(index))
            .and_then(Argument::as_expression)
            .and_then(|callback| {
                effect_cleanup_exact_local_function_id(callback, ctx, &mut FxHashSet::default())
            })
        {
            executed_functions.push(function_id);
        }
    }
    executed_functions.into_iter().any(|function_id| {
        !effect_cleanup_function_is_generator(function_id, ctx)
            && visited_functions.insert(function_id)
            && ctx.nodes().iter().any(|child| {
                effect_cleanup_nearest_function_id(child.id(), ctx) == Some(function_id)
                    && effect_cleanup_node_mutates_timer_collection(
                        child,
                        collection_key,
                        false,
                        ctx,
                        visited_functions,
                    )
            })
    })
}

fn effect_cleanup_is_direct_timer_collection_cleanup<'a>(
    release_node: &AstNode<'a>,
    usage: &ResourceUsage,
    ctx: &LintContext<'a>,
) -> bool {
    if usage.kind != ResourceKind::Timer {
        return false;
    }
    let Some(collection_symbol) = effect_cleanup_direct_timer_collection_symbol(usage, ctx)
        .or_else(|| {
            effect_cleanup_mapped_resource_collection_symbol(
                ctx.nodes().get_node(usage.node_id),
                ctx,
            )
        })
    else {
        return false;
    };
    let AstKind::CallExpression(call) = release_node.kind() else {
        return false;
    };
    let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression() else {
        return false;
    };
    let expected = if usage.resource_name == "setInterval" {
        "clearInterval"
    } else {
        "clearTimeout"
    };
    let collection_key = format!("symbol:{collection_symbol:?}");
    if member.property.name != "forEach"
        || effect_cleanup_expression_key(&member.object, ctx, &mut FxHashSet::default()).as_ref()
            != Some(&collection_key)
    {
        return false;
    }
    let Some(cleanup_callback) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    if effect_cleanup_mapped_resource_collection_symbol(ctx.nodes().get_node(usage.node_id), ctx)
        .is_some()
        && let Some(callback_id) =
            effect_cleanup_exact_local_function_id(cleanup_callback, ctx, &mut FxHashSet::default())
        && effect_cleanup_synchronous_iterator_call_for_callback(callback_id, ctx)
            .is_some_and(|invocation| invocation.id() == release_node.id())
    {
        return ctx.nodes().iter().any(|candidate| {
            if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(callback_id) {
                return false;
            }
            let AstKind::CallExpression(release) = candidate.kind() else {
                return false;
            };
            matches!(release.callee.get_inner_expression(), Expression::Identifier(identifier)
                        if identifier.name == expected)
                && release
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|argument| {
                        let Expression::Identifier(identifier) = argument.get_inner_expression()
                        else {
                            return false;
                        };
                        ctx.scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                            .is_some_and(|symbol_id| {
                                let declaration = ctx.symbol_declaration(symbol_id);
                                matches!(declaration.kind(), AstKind::FormalParameter(_))
                                    && effect_cleanup_nearest_function_id(declaration.id(), ctx)
                                        == Some(callback_id)
                            })
                    })
        });
    }
    if !matches!(cleanup_callback, Expression::Identifier(identifier)
        if identifier.name == expected && ctx.is_reference_to_global_variable(identifier))
    {
        return false;
    }
    let owner_functions = |node_id| {
        ctx.nodes()
            .ancestors(node_id)
            .filter_map(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
                .then_some(ancestor.id())
            })
            .collect::<FxHashSet<_>>()
    };
    let setup_owners = owner_functions(usage.node_id);
    let cleanup_owners = owner_functions(release_node.id());
    !ctx.nodes().iter().any(|node| {
        effect_cleanup_nearest_function_id(node.id(), ctx).is_some_and(|owner_id| {
            (setup_owners.contains(&owner_id) && node.span().start > usage.span.start
                || cleanup_owners.contains(&owner_id)
                    && node.span().start < release_node.span().start)
                && effect_cleanup_node_mutates_timer_collection(
                    node,
                    &collection_key,
                    true,
                    ctx,
                    &mut FxHashSet::default(),
                )
        })
    })
}

fn effect_cleanup_has_owned_nested_timer_cleanup(
    usage: &ResourceUsage,
    usages: &[ResourceUsage],
    callback_id: NodeId,
    execution_function_ids: &FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(owner_id) = effect_cleanup_nearest_function_id(usage.node_id, ctx) else {
        return false;
    };
    if owner_id == callback_id
        || effect_cleanup_function_is_async(owner_id, ctx)
        || effect_cleanup_function_is_generator(owner_id, ctx)
    {
        return false;
    }
    let handle_symbol = effect_cleanup_nested_timer_storage_symbol(usage, callback_id, ctx);
    let owned_collection =
        effect_cleanup_direct_timer_collection_symbol(usage, ctx).is_some_and(|symbol_id| {
            effect_cleanup_nearest_function_id(ctx.symbol_declaration(symbol_id).id(), ctx)
                == Some(callback_id)
        });
    if handle_symbol.is_none() && !owned_collection
        || handle_symbol.is_some_and(|symbol_id| {
            effect_cleanup_usage_is_inside_loop(usage.node_id, owner_id, ctx)
                || !effect_cleanup_has_safe_timer_handle_writes(usage, usages, symbol_id, ctx)
        })
    {
        return false;
    }
    let returns = effect_cleanup_return_expressions(callback_id, ctx)
        .into_iter()
        .filter(|expression| {
            expression.span().start >= usage.span.start
                && effect_cleanup_return_expression_releases_usage(
                    expression,
                    usage,
                    execution_function_ids,
                    ctx,
                )
        })
        .collect::<Vec<_>>();
    if returns.is_empty() {
        return false;
    }
    if effect_cleanup_is_timer_callback_for_same_handle(owner_id, usage, usages, ctx) {
        return true;
    }
    let Some(owner_symbol) = effect_cleanup_retained_function_binding_symbol_id(owner_id, ctx)
    else {
        return false;
    };
    let invocations = ctx
        .scoping()
        .get_resolved_references(owner_symbol)
        .map(|reference| effect_cleanup_direct_call_for_reference(reference.node_id(), ctx))
        .collect::<Option<Vec<_>>>();
    let Some(invocations) = invocations.filter(|invocations| !invocations.is_empty()) else {
        return false;
    };
    if handle_symbol.is_some()
        && invocations.len() > 1
        && !effect_cleanup_releases_previous_handle(usage, ctx)
    {
        let mut direct_invocations = 0;
        for (index, invocation) in invocations.iter().enumerate() {
            let Some(invocation_owner) = effect_cleanup_nearest_function_id(invocation.id(), ctx)
            else {
                return false;
            };
            if invocation_owner == callback_id {
                direct_invocations += 1;
            } else if !effect_cleanup_is_timer_callback_for_same_handle(
                invocation_owner,
                usage,
                std::slice::from_ref(usage),
                ctx,
            ) {
                return false;
            }
            let function_node = ctx.nodes().get_node(invocation_owner);
            if invocations.iter().skip(index + 1).any(|later| {
                effect_cleanup_nearest_function_id(later.id(), ctx) == Some(invocation_owner)
                    && (can_node_reach_later_node_within_function(
                        invocation,
                        later,
                        function_node,
                        ctx,
                    ) || can_node_reach_later_node_within_function(
                        later,
                        invocation,
                        function_node,
                        ctx,
                    ))
            }) {
                return false;
            }
        }
        if direct_invocations > 1 {
            return false;
        }
    }
    invocations.iter().all(|invocation| {
        let Some(invocation_owner) = effect_cleanup_nearest_function_id(invocation.id(), ctx)
        else {
            return false;
        };
        if invocation_owner == owner_id
            || effect_cleanup_function_is_generator(invocation_owner, ctx)
        {
            return false;
        }
        if effect_cleanup_function_is_async(invocation_owner, ctx) {
            return effect_cleanup_async_helper_has_lifecycle_guard(
                invocation,
                invocation_owner,
                callback_id,
                execution_function_ids,
                &returns,
                ctx,
            );
        }
        effect_cleanup_is_timer_callback_for_same_handle(invocation_owner, usage, usages, ctx)
            || invocation_owner == callback_id
                && !effect_cleanup_usage_is_inside_loop(invocation.id(), callback_id, ctx)
    })
}

fn effect_cleanup_literal_boolean(expression: &Expression<'_>) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        _ => None,
    }
}

fn effect_cleanup_condition_blocks_guard(
    expression: &Expression<'_>,
    blocked_value: bool,
    guard_key: &str,
    guard_value: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
        {
            effect_cleanup_condition_blocks_guard(
                &unary.argument,
                !blocked_value,
                guard_key,
                guard_value,
                ctx,
            )
        }
        Expression::LogicalExpression(logical) => {
            ((logical.operator.as_str() == "||" && blocked_value)
                || (logical.operator.as_str() == "&&" && !blocked_value))
                && (effect_cleanup_condition_blocks_guard(
                    &logical.left,
                    blocked_value,
                    guard_key,
                    guard_value,
                    ctx,
                ) || effect_cleanup_condition_blocks_guard(
                    &logical.right,
                    blocked_value,
                    guard_key,
                    guard_value,
                    ctx,
                ))
        }
        Expression::BinaryExpression(binary)
            if matches!(binary.operator.as_str(), "==" | "===" | "!=" | "!==") =>
        {
            let left = effect_cleanup_literal_boolean(&binary.left);
            let Some(boolean_value) =
                left.or_else(|| effect_cleanup_literal_boolean(&binary.right))
            else {
                return false;
            };
            let compared = if left.is_some() {
                &binary.right
            } else {
                &binary.left
            };
            let is_equality = matches!(binary.operator.as_str(), "==" | "===");
            effect_cleanup_expression_key(compared, ctx, &mut FxHashSet::default()).as_deref()
                == Some(guard_key)
                && guard_value
                    == if is_equality == blocked_value {
                        boolean_value
                    } else {
                        !boolean_value
                    }
        }
        _ => {
            effect_cleanup_expression_key(expression, ctx, &mut FxHashSet::default()).as_deref()
                == Some(guard_key)
                && blocked_value == guard_value
        }
    }
}

fn effect_cleanup_reference_key(node_id: NodeId, ctx: &LintContext<'_>) -> Option<String> {
    let node = ctx.nodes().get_node(node_id);
    match node.kind() {
        AstKind::IdentifierReference(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .map(|symbol_id| format!("symbol:{symbol_id:?}")),
        AstKind::StaticMemberExpression(member) => {
            effect_cleanup_expression_key(&member.object, ctx, &mut FxHashSet::default())
                .map(|object| format!("{object}.{}", member.property.name))
        }
        AstKind::ParenthesizedExpression(wrapper) => {
            effect_cleanup_expression_key(&wrapper.expression, ctx, &mut FxHashSet::default())
        }
        AstKind::TSAsExpression(wrapper) => {
            effect_cleanup_expression_key(&wrapper.expression, ctx, &mut FxHashSet::default())
        }
        AstKind::TSSatisfiesExpression(wrapper) => {
            effect_cleanup_expression_key(&wrapper.expression, ctx, &mut FxHashSet::default())
        }
        AstKind::TSTypeAssertion(wrapper) => {
            effect_cleanup_expression_key(&wrapper.expression, ctx, &mut FxHashSet::default())
        }
        AstKind::TSNonNullExpression(wrapper) => {
            effect_cleanup_expression_key(&wrapper.expression, ctx, &mut FxHashSet::default())
        }
        _ => None,
    }
}

fn effect_cleanup_async_helper_has_lifecycle_guard<'a>(
    invocation: &AstNode<'a>,
    owner_id: NodeId,
    callback_id: NodeId,
    execution_function_ids: &FxHashSet<NodeId>,
    cleanup_returns: &[&Expression<'a>],
    ctx: &LintContext<'a>,
) -> bool {
    if !execution_function_ids.contains(&owner_id)
        || effect_cleanup_function_is_generator(owner_id, ctx)
    {
        return false;
    }
    let owner_root_id = effect_cleanup_transparent_root_node_id(owner_id, ctx);
    let owner_parent = ctx.nodes().parent_node(owner_root_id);
    let direct_invocation = if matches!(owner_parent.kind(), AstKind::CallExpression(call)
        if call.callee.span() == ctx.nodes().get_node(owner_root_id).span())
    {
        Some(owner_parent.id())
    } else {
        effect_cleanup_single_direct_invocation(owner_id, callback_id, ctx)
    };
    let Some(direct_invocation) = direct_invocation else {
        return false;
    };
    if effect_cleanup_nearest_function_id(direct_invocation, ctx) != Some(callback_id)
        || effect_cleanup_usage_is_inside_loop(direct_invocation, callback_id, ctx)
    {
        return false;
    }
    let cleanup_functions = cleanup_returns
        .iter()
        .filter_map(|expression| {
            effect_cleanup_exact_local_function_id(expression, ctx, &mut FxHashSet::default())
        })
        .collect::<Vec<_>>();
    if cleanup_functions.is_empty()
        || cleanup_functions.len() != cleanup_returns.len()
        || cleanup_functions.iter().any(|function_id| {
            effect_cleanup_function_is_async(*function_id, ctx)
                || effect_cleanup_function_is_generator(*function_id, ctx)
        })
    {
        return false;
    }
    for declaration_node in ctx.nodes().iter() {
        if effect_cleanup_nearest_function_id(declaration_node.id(), ctx) != Some(callback_id) {
            continue;
        }
        let AstKind::VariableDeclarator(declarator) = declaration_node.kind() else {
            continue;
        };
        let Some(binding) = declarator.id.get_binding_identifier() else {
            continue;
        };
        let AstKind::VariableDeclaration(variable) =
            ctx.nodes().parent_node(declaration_node.id()).kind()
        else {
            continue;
        };
        let property = if variable.kind.is_const() {
            let Some(Expression::ObjectExpression(object)) = declarator
                .init
                .as_ref()
                .map(Expression::get_inner_expression)
            else {
                continue;
            };
            let [ObjectPropertyKind::ObjectProperty(property)] = object.properties.as_slice()
            else {
                continue;
            };
            Some(property)
        } else if matches!(
            variable.kind,
            oxc_ast::ast::VariableDeclarationKind::Let | oxc_ast::ast::VariableDeclarationKind::Var
        ) {
            None
        } else {
            continue;
        };
        let property_name = property.and_then(|property| property.key.static_name());
        if property.is_some() && property_name.is_none() {
            continue;
        }
        let symbol_id = binding.symbol_id();
        let guard_key = if let Some(property_name) = &property_name {
            format!("symbol:{symbol_id:?}.{property_name}")
        } else {
            format!("symbol:{symbol_id:?}")
        };
        for live_value in [true, false] {
            let dead_value = !live_value;
            if property.is_some_and(|property| {
                effect_cleanup_literal_boolean(&property.value) != Some(live_value)
            }) {
                continue;
            }
            let only_cleanup_writes = ctx.scoping().get_resolved_references(symbol_id).all(|reference| {
                let root_id = effect_cleanup_outermost_member_reference(reference.node_id(), ctx);
                if property.is_some() && effect_cleanup_reference_key(root_id, ctx).as_ref() != Some(&guard_key) {
                    return false;
                }
                let root = ctx.nodes().get_node(root_id);
                let parent = ctx.nodes().parent_node(root_id);
                if matches!(parent.kind(), AstKind::UpdateExpression(update) if update.argument.span() == root.span()) {
                    return false;
                }
                let AstKind::AssignmentExpression(assignment) = parent.kind() else {
                    return !reference.is_write();
                };
                if assignment.left.span() != root.span() {
                    return true;
                }
                assignment.operator.as_str() == "="
                    && effect_cleanup_literal_boolean(&assignment.right) == Some(dead_value)
                    && effect_cleanup_nearest_function_id(parent.id(), ctx)
                        .is_some_and(|function_id| cleanup_functions.contains(&function_id))
            });
            if !only_cleanup_writes
                || !cleanup_functions.iter().all(|cleanup_id| {
                    ctx.nodes().iter().any(|candidate| {
                        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                            return false;
                        };
                        assignment.operator.as_str() == "="
                            && effect_cleanup_assignment_target_key(&assignment.left, ctx).as_ref()
                                == Some(&guard_key)
                            && effect_cleanup_literal_boolean(&assignment.right) == Some(dead_value)
                            && effect_cleanup_nearest_function_id(candidate.id(), ctx)
                                == Some(*cleanup_id)
                            && effect_cleanup_node_is_unconditional_from(
                                candidate,
                                *cleanup_id,
                                ctx,
                            )
                    })
                })
            {
                continue;
            }
            let guard_nodes = ctx.nodes().iter().filter(|candidate| {
                if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(owner_id) {
                    return false;
                }
                let AstKind::IfStatement(statement) = candidate.kind() else {
                    return false;
                };
                if property.is_some() && !ctx.nodes().iter().any(|guard_member| {
                    statement.test.span().contains_inclusive(guard_member.span())
                        && matches!(guard_member.kind(), AstKind::StaticMemberExpression(member)
                            if matches!(member.object.get_inner_expression(), Expression::Identifier(_)))
                        && effect_cleanup_reference_key(guard_member.id(), ctx).as_ref() == Some(&guard_key)
                }) {
                    return false;
                }
                if statement.consequent.span().contains_inclusive(invocation.span()) {
                    return effect_cleanup_condition_blocks_guard(&statement.test, false, &guard_key, dead_value, ctx);
                }
                let Some(consequent) = ctx.nodes().iter().find(|node| {
                    node.span() == statement.consequent.span()
                        && ctx.nodes().parent_node(node.id()).id() == candidate.id()
                }) else { return false; };
                statement.alternate.is_none()
                    && !can_node_reach_later_node_within_function(consequent, invocation, ctx.nodes().get_node(owner_id), ctx)
                    && effect_cleanup_nodes_cover_every_path_before_node(invocation, &[candidate], ctx.nodes().get_node(owner_id), ctx)
                    && effect_cleanup_condition_blocks_guard(&statement.test, true, &guard_key, dead_value, ctx)
            });
            for guard_node in guard_nodes {
                let has_interruption = ctx.nodes().iter().any(|candidate| {
                if candidate.span().start <= guard_node.span().start
                    || candidate.span().start >= invocation.span().start
                    || effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(owner_id)
                {
                    return false;
                }
                let is_interruption = match candidate.kind() {
                    AstKind::AwaitExpression(_) | AstKind::YieldExpression(_) => true,
                    AstKind::CallExpression(call) => !super::no_collapse_request_error_to_empty_state::collapse_is_proven_non_throwing_call(call, ctx),
                    _ => false,
                };
                is_interruption && (
                    can_node_reach_later_node_within_function(candidate, invocation, ctx.nodes().get_node(owner_id), ctx)
                    || ctx.nodes().ancestors(candidate.id()).take_while(|ancestor| ancestor.id() != owner_id).any(|ancestor| {
                        matches!(ancestor.kind(), AstKind::TryStatement(statement)
                            if statement.block.span.contains_inclusive(candidate.span())
                                && statement.handler.as_ref().is_some_and(|handler| can_node_reach_later_node_within_function(
                                    ctx.nodes().get_node(handler.body.node_id.get()), invocation, ctx.nodes().get_node(owner_id), ctx)))
                    })
                )
            });
                if !has_interruption {
                    return true;
                }
            }
        }
    }
    false
}

fn effect_cleanup_has_competing_deferred_allocations(
    usage: &ResourceUsage,
    usages: &[ResourceUsage],
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    usage.kind == ResourceKind::Timer
        && usage.handle_key.is_some()
        && effect_cleanup_nearest_function_id(usage.node_id, ctx) != Some(callback_id)
        && usages
            .iter()
            .filter(|candidate| {
                candidate.kind == ResourceKind::Timer
                    && candidate.handle_key == usage.handle_key
                    && effect_cleanup_nearest_function_id(candidate.node_id, ctx)
                        != Some(callback_id)
            })
            .nth(1)
            .is_some()
}

fn effect_cleanup_is_directly_started_self_rescheduling_timer(
    usage: &ResourceUsage,
    usages: &[ResourceUsage],
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if usage.resource_name != "setTimeout" || usage.handle_key.is_none() {
        return false;
    }
    let Some(owner_id) = effect_cleanup_nearest_function_id(usage.node_id, ctx) else {
        return false;
    };
    if owner_id == callback_id
        || effect_cleanup_function_is_async(owner_id, ctx)
        || effect_cleanup_function_is_generator(owner_id, ctx)
        || effect_cleanup_usage_is_inside_loop(usage.node_id, owner_id, ctx)
    {
        return false;
    }
    let AstKind::CallExpression(timer_call) = ctx.nodes().get_node(usage.node_id).kind() else {
        return false;
    };
    if timer_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .and_then(|callback| {
            effect_cleanup_exact_local_function_id(callback, ctx, &mut FxHashSet::default())
        })
        != Some(owner_id)
    {
        return false;
    }
    let self_scheduling_usages = usages
        .iter()
        .filter(|candidate| {
            candidate.resource_name == "setTimeout"
                && effect_cleanup_nearest_function_id(candidate.node_id, ctx) == Some(owner_id)
                && matches!(ctx.nodes().get_node(candidate.node_id).kind(), AstKind::CallExpression(call)
                    if call.arguments.first().and_then(Argument::as_expression).and_then(|callback| {
                        effect_cleanup_exact_local_function_id(callback, ctx, &mut FxHashSet::default())
                    }) == Some(owner_id))
        })
        .collect::<Vec<_>>();
    if self_scheduling_usages.len() != 1 || self_scheduling_usages[0].node_id != usage.node_id {
        return false;
    }
    let Some(handle_symbol_id) = effect_cleanup_assigned_handle_symbol_id(usage.node_id, ctx)
    else {
        return false;
    };
    let handle_declaration = ctx.symbol_declaration(handle_symbol_id);
    if effect_cleanup_nearest_function_id(handle_declaration.id(), ctx) != Some(callback_id)
        || !matches!(ctx.nodes().parent_node(handle_declaration.id()).kind(),
            AstKind::VariableDeclaration(declaration)
                if matches!(declaration.kind,
                    oxc_ast::ast::VariableDeclarationKind::Let
                        | oxc_ast::ast::VariableDeclarationKind::Var))
    {
        return false;
    }
    let mut handle_write_count = 0;
    for reference in ctx.scoping().get_resolved_references(handle_symbol_id) {
        if !reference.is_write() {
            continue;
        }
        let reference_root_id = effect_cleanup_transparent_root_node_id(reference.node_id(), ctx);
        let AstKind::AssignmentExpression(assignment) =
            ctx.nodes().parent_node(reference_root_id).kind()
        else {
            return false;
        };
        if assignment.operator.as_str() != "="
            || assignment.right.span() != ctx.nodes().get_node(usage.node_id).span()
        {
            return false;
        }
        handle_write_count += 1;
    }
    if handle_write_count != 1 {
        return false;
    }
    let Some(owner_symbol_id) = effect_cleanup_retained_function_binding_symbol_id(owner_id, ctx)
    else {
        return false;
    };
    let mut self_reference_count = 0;
    let mut initial_invocation_count = 0;
    for reference in ctx.scoping().get_resolved_references(owner_symbol_id) {
        let reference_root_id = effect_cleanup_transparent_root_node_id(reference.node_id(), ctx);
        let reference_root = ctx.nodes().get_node(reference_root_id);
        let parent = ctx.nodes().parent_node(reference_root_id);
        let AstKind::CallExpression(call) = parent.kind() else {
            return false;
        };
        if parent.id() == usage.node_id
            && call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|argument| argument.span() == reference_root.span())
        {
            self_reference_count += 1;
            continue;
        }
        if call.callee.span() == reference_root.span()
            && effect_cleanup_nearest_function_id(parent.id(), ctx) == Some(callback_id)
            && effect_cleanup_node_is_reachable(parent, callback_id, ctx)
        {
            initial_invocation_count += 1;
            continue;
        }
        return false;
    }
    self_reference_count == 1 && initial_invocation_count == 1
}

fn effect_cleanup_assigned_handle_symbol_id(
    usage_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let usage_root_id = effect_cleanup_transparent_root_node_id(usage_node_id, ctx);
    let usage_root = ctx.nodes().get_node(usage_root_id);
    let AstKind::AssignmentExpression(assignment) = ctx.nodes().parent_node(usage_root_id).kind()
    else {
        return None;
    };
    if assignment.operator.as_str() != "=" || assignment.right.span() != usage_root.span() {
        return None;
    }
    let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left
    else {
        return None;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn effect_cleanup_deferred_timer_has_lifecycle_guard(
    usage: &ResourceUsage,
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if usage.kind != ResourceKind::Timer {
        return false;
    }
    let Some(owner_id) = effect_cleanup_nearest_function_id(usage.node_id, ctx) else {
        return false;
    };
    if owner_id == callback_id || effect_cleanup_usage_is_inside_loop(usage.node_id, owner_id, ctx)
    {
        return false;
    }
    let usage_span = ctx.nodes().get_node(usage.node_id).span();
    let cleanup_function_ids = effect_cleanup_returned_cleanup_function_ids(callback_id, ctx);
    for candidate in ctx.nodes().iter() {
        let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
            continue;
        };
        if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(callback_id) {
            continue;
        }
        let Some(binding) = declarator.id.get_binding_identifier() else {
            continue;
        };
        let Some(live_value) = declarator
            .init
            .as_ref()
            .and_then(effect_cleanup_static_boolean)
        else {
            continue;
        };
        let symbol_id = binding.symbol_id();
        if effect_cleanup_guard_symbol_is_reactivated(symbol_id, live_value, candidate.span(), ctx)
        {
            continue;
        }
        let dead_value = !live_value;
        if !cleanup_function_ids.iter().any(|cleanup_function_id| {
            effect_cleanup_function_sets_guard(*cleanup_function_id, symbol_id, dead_value, ctx)
        }) {
            continue;
        }
        let guard_end = effect_cleanup_find_lifecycle_guard_end(
            usage.node_id,
            owner_id,
            symbol_id,
            live_value,
            dead_value,
            ctx,
        );
        let Some(guard_end) = guard_end else {
            continue;
        };
        if effect_cleanup_guard_can_be_invalidated_before_usage(
            guard_end,
            usage_span.start,
            owner_id,
            symbol_id,
            usage.node_id,
            ctx,
        ) {
            continue;
        }
        return true;
    }
    false
}

fn effect_cleanup_usage_is_inside_loop(
    node_id: NodeId,
    owner_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().ancestors(node_id).any(|ancestor| {
        ancestor.id() != owner_id
            && matches!(
                ancestor.kind(),
                AstKind::ForStatement(_)
                    | AstKind::ForInStatement(_)
                    | AstKind::ForOfStatement(_)
                    | AstKind::WhileStatement(_)
                    | AstKind::DoWhileStatement(_)
            )
    })
}

fn effect_cleanup_guard_symbol_is_reactivated(
    symbol_id: SymbolId,
    live_value: bool,
    declaration_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .any(|reference| {
            let node = ctx.nodes().get_node(reference.node_id());
            if declaration_span.contains_inclusive(node.span()) {
                return false;
            }
            let parent = ctx.nodes().parent_node(reference.node_id());
            matches!(parent.kind(), AstKind::AssignmentExpression(assignment)
                if effect_cleanup_static_boolean(&assignment.right) == Some(live_value))
        })
}

fn effect_cleanup_function_sets_guard(
    function_id: NodeId,
    symbol_id: SymbolId,
    value: bool,
    ctx: &LintContext<'_>,
) -> bool {
    if effect_cleanup_function_is_async(function_id, ctx) {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .any(|reference| {
            let node = ctx.nodes().get_node(reference.node_id());
            if effect_cleanup_nearest_function_id(node.id(), ctx) != Some(function_id) {
                return false;
            }
            let parent = ctx.nodes().parent_node(node.id());
            matches!(parent.kind(), AstKind::AssignmentExpression(assignment)
                if effect_cleanup_static_boolean(&assignment.right) == Some(value)
                    && effect_cleanup_node_is_unconditional_from(parent, function_id, ctx)
                    && !effect_cleanup_has_earlier_await(function_id, parent.span().start, ctx))
        })
}

fn effect_cleanup_find_lifecycle_guard_end(
    usage_node_id: NodeId,
    owner_id: NodeId,
    symbol_id: SymbolId,
    live_value: bool,
    dead_value: bool,
    ctx: &LintContext<'_>,
) -> Option<u32> {
    let usage_span = ctx.nodes().get_node(usage_node_id).span();
    for ancestor in ctx.nodes().ancestors(usage_node_id) {
        if ancestor.id() == owner_id {
            break;
        }
        let AstKind::IfStatement(statement) = ancestor.kind() else {
            continue;
        };
        if statement.consequent.span().contains_inclusive(usage_span)
            && effect_cleanup_condition_value(&statement.test, symbol_id, live_value, ctx)
                == Some(true)
            && effect_cleanup_condition_value(&statement.test, symbol_id, dead_value, ctx)
                == Some(false)
        {
            return Some(statement.test.span().end);
        }
        if statement
            .alternate
            .as_ref()
            .is_some_and(|alternate| alternate.span().contains_inclusive(usage_span))
            && effect_cleanup_condition_value(&statement.test, symbol_id, live_value, ctx)
                == Some(false)
            && effect_cleanup_condition_value(&statement.test, symbol_id, dead_value, ctx)
                == Some(true)
        {
            return Some(statement.test.span().end);
        }
    }
    ctx.nodes()
        .iter()
        .filter(|candidate| {
            candidate.span().end <= usage_span.start
                && effect_cleanup_nearest_function_id(candidate.id(), ctx) == Some(owner_id)
        })
        .filter_map(|candidate| {
            let AstKind::IfStatement(statement) = candidate.kind() else {
                return None;
            };
            (statement.alternate.is_none()
                && effect_cleanup_statement_is_early_exit(&statement.consequent)
                && effect_cleanup_condition_value(&statement.test, symbol_id, dead_value, ctx)
                    == Some(true))
            .then_some(statement.span.end)
        })
        .max()
}

fn effect_cleanup_condition_value(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    symbol_value: bool,
    ctx: &LintContext<'_>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => (ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            == Some(symbol_id))
        .then_some(symbol_value),
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
        {
            effect_cleanup_condition_value(&unary.argument, symbol_id, symbol_value, ctx)
                .map(|value| !value)
        }
        Expression::LogicalExpression(logical) => {
            let left = effect_cleanup_condition_value(&logical.left, symbol_id, symbol_value, ctx);
            let right =
                effect_cleanup_condition_value(&logical.right, symbol_id, symbol_value, ctx);
            match logical.operator.as_str() {
                "&&" if left == Some(false) || right == Some(false) => Some(false),
                "&&" if left == Some(true) && right == Some(true) => Some(true),
                "||" if left == Some(true) || right == Some(true) => Some(true),
                "||" if left == Some(false) && right == Some(false) => Some(false),
                _ => None,
            }
        }
        _ => None,
    }
}

fn effect_cleanup_statement_is_early_exit(statement: &oxc_ast::ast::Statement<'_>) -> bool {
    match statement {
        oxc_ast::ast::Statement::ReturnStatement(_)
        | oxc_ast::ast::Statement::ThrowStatement(_) => true,
        oxc_ast::ast::Statement::BlockStatement(block) => {
            block.body.len() == 1 && effect_cleanup_statement_is_early_exit(&block.body[0])
        }
        _ => false,
    }
}

fn effect_cleanup_guard_can_be_invalidated_before_usage(
    guard_end: u32,
    usage_start: u32,
    owner_id: NodeId,
    symbol_id: SymbolId,
    usage_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if candidate.span().start < guard_end
            || candidate.span().start >= usage_start
            || effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(owner_id)
        {
            return false;
        }
        match candidate.kind() {
            AstKind::AwaitExpression(_) => true,
            AstKind::AssignmentExpression(assignment) => {
                ctx.nodes().iter().any(|identifier_node| {
                    assignment
                        .left
                        .span()
                        .contains_inclusive(identifier_node.span())
                        && matches!(identifier_node.kind(), AstKind::IdentifierReference(identifier)
                            if ctx.scoping().get_reference(identifier.reference_id()).symbol_id()
                                == Some(symbol_id))
                })
            }
            AstKind::CallExpression(_) => candidate.id() != usage_node_id,
            _ => false,
        }
    })
}

fn effect_cleanup_returned_cleanup_function_ids(
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<NodeId> {
    effect_cleanup_return_expressions(callback_id, ctx)
        .into_iter()
        .filter_map(|expression| {
            effect_cleanup_exact_local_function_id(expression, ctx, &mut FxHashSet::default())
        })
        .collect()
}

fn effect_cleanup_registration_event_key(
    call: &CallExpression<'_>,
    method_name: &str,
    ctx: &LintContext<'_>,
) -> Option<String> {
    if method_name == "addListener" && call.arguments.len() == 1 {
        return None;
    }
    call.arguments
        .first()
        .and_then(Argument::as_expression)
        .and_then(|expression| effect_cleanup_resource_identity_key(expression, ctx))
}

fn effect_cleanup_registration_handler_key(
    call: &CallExpression<'_>,
    method_name: &str,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let argument_index = if method_name == "addListener" && call.arguments.len() == 1 {
        0
    } else {
        1
    };
    call.arguments
        .get(argument_index)
        .and_then(Argument::as_expression)
        .and_then(|expression| effect_cleanup_resource_identity_key(expression, ctx))
}

fn effect_cleanup_listener_options<'a>(
    argument: Option<&'a Argument<'a>>,
    ctx: &LintContext<'a>,
) -> (Option<String>, bool, Option<String>, bool) {
    let Some(provided_expression) = argument.and_then(Argument::as_expression) else {
        return (Some("capture:false".to_string()), false, None, false);
    };
    let Some(expression) = effect_cleanup_read_only_listener_options(provided_expression, ctx)
    else {
        return (
            effect_cleanup_stable_listener_options_identity_key(provided_expression, ctx),
            false,
            None,
            false,
        );
    };
    let expression = expression.get_inner_expression();
    if let Expression::BooleanLiteral(literal) = expression {
        return (
            Some(format!("capture:{}", literal.value)),
            false,
            None,
            false,
        );
    }
    let Expression::ObjectExpression(object) = expression else {
        return (
            effect_cleanup_expression_key(expression, ctx, &mut FxHashSet::default())
                .map(|key| format!("options:{key}")),
            false,
            None,
            false,
        );
    };
    let mut capture_key = Some("capture:false".to_string());
    let mut is_once = false;
    let mut local_abort_controller = None;
    let mut has_external_signal = false;
    for candidate in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = candidate else {
            capture_key = None;
            continue;
        };
        if property.computed {
            capture_key = None;
            continue;
        }
        let Some(name) = property.key.static_name().map(|name| name.to_string()) else {
            capture_key = None;
            continue;
        };
        match name.as_str() {
            "capture" => {
                capture_key = match property.value.get_inner_expression() {
                    Expression::BooleanLiteral(literal) => {
                        Some(format!("capture:{}", literal.value))
                    }
                    expression => {
                        effect_cleanup_expression_key(expression, ctx, &mut FxHashSet::default())
                            .map(|key| format!("capture-value:{key}"))
                    }
                };
            }
            "once" => {
                is_once = matches!(
                    property.value.get_inner_expression(),
                    Expression::BooleanLiteral(literal) if literal.value
                );
            }
            "signal" => {
                local_abort_controller = effect_cleanup_signal_controller_key(&property.value, ctx);
                has_external_signal = local_abort_controller.is_none();
            }
            "__proto__" if !property.computed => capture_key = None,
            _ => {}
        }
    }
    (
        capture_key,
        is_once,
        local_abort_controller,
        has_external_signal,
    )
}

fn effect_cleanup_stable_listener_options_identity_key(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if effect_cleanup_symbol_has_write(symbol_id, ctx) {
        return None;
    }
    Some(format!("options-identity:symbol:{symbol_id:?}"))
}

fn effect_cleanup_read_only_listener_options<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return Some(expression);
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return effect_cleanup_resolve_const_expression(expression, ctx);
    };
    let initializer = declarator.init.as_ref()?.get_inner_expression();
    if matches!(
        initializer,
        Expression::Identifier(_)
            | Expression::StaticMemberExpression(_)
            | Expression::ComputedMemberExpression(_)
            | Expression::PrivateFieldExpression(_)
    ) {
        return None;
    }
    if !matches!(initializer, Expression::ObjectExpression(_)) {
        return effect_cleanup_resolve_const_expression(expression, ctx);
    }
    let variable_declaration = ctx.nodes().parent_node(declaration.id());
    if !matches!(variable_declaration.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        || effect_cleanup_symbol_has_write(symbol_id, ctx)
    {
        return None;
    }
    let has_only_listener_option_uses =
        ctx.scoping()
            .get_resolved_references(symbol_id)
            .all(|reference| {
                if reference.is_write() {
                    return false;
                }
                let reference_root_id =
                    effect_cleanup_transparent_root_node_id(reference.node_id(), ctx);
                let reference_root = ctx.nodes().get_node(reference_root_id);
                let parent = ctx.nodes().parent_node(reference_root_id);
                let AstKind::CallExpression(call) = parent.kind() else {
                    return false;
                };
                if call
                    .arguments
                    .get(2)
                    .and_then(Argument::as_expression)
                    .is_none_or(|argument| argument.span() != reference_root.span())
                {
                    return false;
                }
                call.callee
                    .get_inner_expression()
                    .as_member_expression()
                    .and_then(MemberExpression::static_property_name)
                    .is_some_and(|method_name| {
                        matches!(method_name, "addEventListener" | "removeEventListener")
                    })
            });
    has_only_listener_option_uses.then_some(declarator.init.as_ref()?)
}

fn effect_cleanup_signal_controller_key<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    effect_cleanup_local_abort_controller_key(expression, ctx, &mut FxHashSet::default())
}

fn effect_cleanup_abort_signal_controller_key(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Expression::StaticMemberExpression(member) = expression
        && member.property.name == "signal"
    {
        return effect_cleanup_expression_key(&member.object, ctx, &mut FxHashSet::default());
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return None;
    };
    let initializer = declarator.init.as_ref()?.get_inner_expression();
    if let Expression::StaticMemberExpression(member) = initializer
        && member.property.name == "signal"
    {
        return effect_cleanup_expression_key(&member.object, ctx, &mut FxHashSet::default());
    }
    matches!(&declarator.id, BindingPattern::ObjectPattern(pattern)
        if pattern.properties.iter().any(|property| property.key.static_name().as_deref() == Some("signal")
            && matches!(&property.value, BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id)))
        .then(|| effect_cleanup_expression_key(initializer, ctx, &mut FxHashSet::default()))
        .flatten()
}

fn effect_cleanup_listener_abort_controller_key(
    usage: &ResourceUsage,
    ctx: &LintContext<'_>,
) -> Option<String> {
    if let Some(controller_key) = &usage.local_abort_controller {
        return Some(controller_key.clone());
    }
    if usage.registration_method.as_deref() != Some("addEventListener") {
        return None;
    }
    let owner_id = effect_cleanup_nearest_function_id(usage.node_id, ctx)?;
    for candidate in ctx.nodes().iter() {
        if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(owner_id) {
            continue;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            continue;
        };
        if effect_cleanup_callee_name(call) != Some("addEventListener")
            || !matches!(call.arguments.first().and_then(Argument::as_expression)
                .map(Expression::get_inner_expression), Some(Expression::StringLiteral(event)) if event.value == "abort")
        {
            continue;
        }
        let Some(controller_key) = effect_cleanup_abort_signal_controller_key(member.object(), ctx)
        else {
            continue;
        };
        let Some(handler_id) = call
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
            .and_then(|handler| {
                effect_cleanup_exact_local_function_id(handler, ctx, &mut FxHashSet::default())
            })
        else {
            continue;
        };
        if effect_cleanup_function_is_async(handler_id, ctx)
            || effect_cleanup_function_is_generator(handler_id, ctx)
        {
            continue;
        }
        let removals = ctx
            .nodes()
            .iter()
            .filter(|removal| {
                if effect_cleanup_nearest_function_id(removal.id(), ctx) != Some(handler_id) {
                    return false;
                }
                let AstKind::CallExpression(removal_call) = removal.kind() else {
                    return false;
                };
                effect_cleanup_callee_name(removal_call) == Some("removeEventListener")
                    && effect_cleanup_release_call_matches(
                        removal.id(),
                        removal_call,
                        usage,
                        ctx,
                        &FxHashMap::default(),
                    )
            })
            .collect::<Vec<_>>();
        let handler = ctx.nodes().get_node(handler_id);
        if do_nodes_cover_every_path_after_node(handler, &removals, handler, ctx) {
            return Some(controller_key);
        }
    }
    let AstKind::CallExpression(registration) = ctx.nodes().get_node(usage.node_id).kind() else {
        return None;
    };
    if !matches!(registration.arguments.first().and_then(Argument::as_expression)
        .map(Expression::get_inner_expression), Some(Expression::StringLiteral(event)) if event.value == "abort")
    {
        return None;
    }
    effect_cleanup_abort_signal_controller_key(
        registration
            .callee
            .get_inner_expression()
            .as_member_expression()?
            .object(),
        ctx,
    )
}

fn effect_cleanup_local_abort_controller_key(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::NewExpression(construction)
            if matches!(construction.callee.get_inner_expression(), Expression::Identifier(callee)
                if callee.name == "AbortController") =>
        {
            Some(format!(
                "abort-controller:{}:{}",
                construction.span.start, construction.span.end
            ))
        }
        expression if expression.as_member_expression().is_some() => {
            effect_cleanup_local_abort_controller_key(
                expression.as_member_expression()?.object(),
                ctx,
                visited_symbol_ids,
            )
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let initializer = declarator.init.as_ref()?;
            if matches!(initializer.get_inner_expression(), Expression::NewExpression(construction)
                if matches!(construction.callee.get_inner_expression(), Expression::Identifier(callee)
                    if callee.name == "AbortController"))
            {
                return effect_cleanup_expression_key(expression, ctx, &mut FxHashSet::default());
            }
            effect_cleanup_local_abort_controller_key(initializer, ctx, visited_symbol_ids)
        }
        _ => None,
    }
}

fn effect_cleanup_stored_result_key(
    resource_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let mut root = resource_node;
    loop {
        let parent = ctx.nodes().parent_node(root.id());
        let is_transparent = matches!(
            parent.kind(),
            AstKind::ParenthesizedExpression(_)
                | AstKind::TSAsExpression(_)
                | AstKind::TSSatisfiesExpression(_)
                | AstKind::TSNonNullExpression(_)
                | AstKind::TSTypeAssertion(_)
                | AstKind::ChainExpression(_)
        );
        if !is_transparent {
            break;
        }
        root = parent;
    }
    let parent = ctx.nodes().parent_node(root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == root.span()) =>
        {
            declarator
                .id
                .get_binding_identifier()
                .map(|binding| format!("symbol:{:?}", binding.symbol_id()))
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.operator.as_str() == "=" && assignment.right.span() == root.span() =>
        {
            effect_cleanup_assignment_target_key(&assignment.left, ctx)
        }
        _ => None,
    }
}

fn effect_cleanup_fluent_chain_stored_result_key(
    resource_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let mut root_id = effect_cleanup_transparent_root_node_id(resource_node_id, ctx);
    loop {
        let parent = ctx.nodes().parent_node(root_id);
        let root_span = ctx.nodes().get_node(root_id).span();
        if parent
            .kind()
            .as_member_expression_kind()
            .is_some_and(|member| member.object().span().contains_inclusive(root_span))
        {
            root_id = effect_cleanup_transparent_root_node_id(parent.id(), ctx);
            continue;
        }
        if let AstKind::CallExpression(parent_call) = parent.kind()
            && parent_call.callee.span().contains_inclusive(root_span)
        {
            root_id = effect_cleanup_transparent_root_node_id(parent.id(), ctx);
            continue;
        }
        return effect_cleanup_stored_result_key(ctx.nodes().get_node(root_id), ctx);
    }
}

fn effect_cleanup_channel_client_key<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let expression = effect_cleanup_resolve_const_expression(expression, ctx).unwrap_or(expression);
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return None;
    };
    let member = call.callee.get_inner_expression().as_member_expression()?;
    let method_name = effect_cleanup_resolved_member_name(member, ctx)?;
    if method_name == "channel" {
        return effect_cleanup_expression_key(member.object(), ctx, &mut FxHashSet::default());
    }
    effect_cleanup_channel_client_key(member.object(), ctx)
}

fn effect_cleanup_resource_collection_key(
    resource_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    effect_cleanup_enclosing_push_collection_key(resource_node.id(), ctx).or_else(|| {
        let symbol_id = effect_cleanup_stored_result_symbol_id(resource_node, ctx)?;
        ctx.scoping()
            .get_resolved_references(symbol_id)
            .find_map(|reference| {
                effect_cleanup_enclosing_push_collection_key(reference.node_id(), ctx)
            })
    })
}

fn effect_cleanup_stored_result_symbol_id(
    resource_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let mut root = resource_node;
    loop {
        let parent = ctx.nodes().parent_node(root.id());
        if !matches!(
            parent.kind(),
            AstKind::ParenthesizedExpression(_)
                | AstKind::TSAsExpression(_)
                | AstKind::TSSatisfiesExpression(_)
                | AstKind::TSNonNullExpression(_)
                | AstKind::TSTypeAssertion(_)
                | AstKind::ChainExpression(_)
        ) {
            break;
        }
        root = parent;
    }
    let AstKind::VariableDeclarator(declarator) = ctx.nodes().parent_node(root.id()).kind() else {
        return None;
    };
    declarator
        .init
        .as_ref()
        .is_some_and(|initializer| initializer.span() == root.span())
        .then(|| {
            declarator
                .id
                .get_binding_identifier()
                .map(|binding| binding.symbol_id())
        })
        .flatten()
}

fn effect_cleanup_enclosing_push_collection_key(
    node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let source_span = ctx.nodes().get_node(node_id).span();
    for ancestor in ctx.nodes().ancestors(node_id) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return None;
        }
        let AstKind::CallExpression(call) = ancestor.kind() else {
            continue;
        };
        if !call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|argument| argument.span().contains_inclusive(source_span))
        }) {
            continue;
        }
        let member = call.callee.get_inner_expression().as_member_expression()?;
        if effect_cleanup_resolved_member_name(member, ctx).as_deref() != Some("push") {
            return None;
        }
        return effect_cleanup_expression_key(member.object(), ctx, &mut FxHashSet::default());
    }
    None
}

fn effect_cleanup_assignment_target_key(
    target: &oxc_ast::ast::AssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match target {
        oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .map(|symbol_id| format!("symbol:{symbol_id:?}"))
            .or_else(|| Some(format!("global:{}", identifier.name))),
        oxc_ast::ast::AssignmentTarget::StaticMemberExpression(member) => {
            let object_key =
                effect_cleanup_expression_key(&member.object, ctx, &mut FxHashSet::default())?;
            Some(format!("{object_key}.{}", member.property.name))
        }
        oxc_ast::ast::AssignmentTarget::ComputedMemberExpression(member) => {
            let object_key =
                effect_cleanup_expression_key(&member.object, ctx, &mut FxHashSet::default())?;
            let property_key =
                effect_cleanup_expression_key(&member.expression, ctx, &mut FxHashSet::default())?;
            Some(format!("{object_key}[{property_key}]"))
        }
        _ => None,
    }
}

fn effect_cleanup_expression_key(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return Some(format!("global:{}", identifier.name));
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return Some(format!("symbol:{symbol_id:?}"));
            }
            if let AstKind::VariableDeclarator(declarator) =
                ctx.symbol_declaration(symbol_id).kind()
                && let Some(property_name) =
                    binding_property_name_for_symbol(&declarator.id, symbol_id)
                && let Some(object_key) = declarator.init.as_ref().and_then(|initializer| {
                    effect_cleanup_expression_key(initializer, ctx, visited_symbol_ids)
                })
            {
                return Some(format!("{object_key}.{property_name}"));
            }
            if !effect_cleanup_symbol_has_write(symbol_id, ctx)
                && let Some(initializer) = effect_cleanup_stable_initializer(symbol_id, ctx)
                && matches!(
                    initializer.get_inner_expression(),
                    Expression::Identifier(_)
                        | Expression::StaticMemberExpression(_)
                        | Expression::ComputedMemberExpression(_)
                )
                && let Some(key) =
                    effect_cleanup_expression_key(initializer, ctx, visited_symbol_ids)
            {
                return Some(key);
            }
            Some(format!("symbol:{symbol_id:?}"))
        }
        Expression::ThisExpression(_) => Some("this".to_string()),
        expression if expression.as_member_expression().is_some() => {
            let member = expression.as_member_expression()?;
            let property_name = effect_cleanup_resolved_member_name(member, ctx)?;
            let object_key =
                effect_cleanup_expression_key(member.object(), ctx, visited_symbol_ids)?;
            Some(format!("{object_key}.{property_name}"))
        }
        Expression::StringLiteral(literal) => Some(format!("string:{}", literal.value)),
        Expression::NumericLiteral(literal) => Some(format!("number:{}", literal.value)),
        Expression::BooleanLiteral(literal) => Some(format!("boolean:{}", literal.value)),
        Expression::ArrowFunctionExpression(function) => {
            Some(format!("function:{:?}", function.node_id.get()))
        }
        Expression::FunctionExpression(function) => {
            Some(format!("function:{:?}", function.node_id.get()))
        }
        _ => None,
    }
}

fn effect_cleanup_resource_identity_key(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    effect_cleanup_for_each_projection(expression, ctx)
        .map(|(collection_key, projection_key)| {
            format!("forEach:{collection_key}:{projection_key}")
        })
        .or_else(|| {
            effect_cleanup_for_of_receiver_projection(expression, ctx)
                .map(|collection_key| format!("forOf:{collection_key}:value"))
        })
        .or_else(|| effect_cleanup_expression_key(expression, ctx, &mut FxHashSet::default()))
}

fn effect_cleanup_for_of_receiver_projection(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let loop_id = effect_cleanup_for_of_iterator_statement_id(symbol_id, ctx)?;
    let AstKind::ForOfStatement(statement) = ctx.nodes().get_node(loop_id).kind() else {
        return None;
    };
    effect_cleanup_replayable_for_of_collection_key(&statement.right, ctx)
}

fn effect_cleanup_for_of_iterator_statement_id(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    if effect_cleanup_symbol_has_write(symbol_id, ctx) {
        return None;
    }
    let declarator = ctx.symbol_declaration(symbol_id);
    let declaration = ctx.nodes().parent_node(declarator.id());
    let loop_node = ctx.nodes().parent_node(declaration.id());
    let AstKind::ForOfStatement(statement) = loop_node.kind() else {
        return None;
    };
    let oxc_ast::ast::ForStatementLeft::VariableDeclaration(variable_declaration) = &statement.left
    else {
        return None;
    };
    if statement.r#await
        || variable_declaration.declarations.len() != 1
        || variable_declaration
            .declarations
            .first()
            .and_then(|declarator| declarator.id.get_binding_identifier())
            .is_none_or(|identifier| identifier.symbol_id() != symbol_id)
    {
        return None;
    }
    Some(loop_node.id())
}

fn effect_cleanup_replayable_for_of_collection_key(
    collection: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let Expression::Identifier(identifier) = collection.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declarator_node = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
        return None;
    };
    let variable_declaration = ctx.nodes().parent_node(declarator_node.id());
    if !matches!(variable_declaration.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
        || !matches!(
            declarator.init.as_ref()?.get_inner_expression(),
            Expression::ArrayExpression(_)
        )
    {
        return None;
    }
    let has_only_append_and_replay_references = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .all(|reference| {
            let root_id = effect_cleanup_transparent_root_node_id(reference.node_id(), ctx);
            let root = ctx.nodes().get_node(root_id);
            let parent = ctx.nodes().parent_node(root_id);
            if matches!(parent.kind(), AstKind::ForOfStatement(statement) if statement.right.span().contains_inclusive(root.span()))
            {
                return true;
            }
            let Some(member) = parent.kind().as_member_expression_kind() else {
                return false;
            };
            member.static_property_name().as_deref() == Some("push")
                && member.object().span().contains_inclusive(root.span())
                && matches!(ctx.nodes().parent_node(parent.id()).kind(), AstKind::CallExpression(call) if call.callee.span().contains_inclusive(parent.span()))
        });
    has_only_append_and_replay_references.then(|| format!("symbol:{symbol_id:?}"))
}

fn effect_cleanup_direct_exhaustive_for_of_release_anchor(
    release_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let AstKind::CallExpression(call) = release_node.kind() else {
        return None;
    };
    let receiver = call
        .callee
        .get_inner_expression()
        .as_member_expression()
        .map(MemberExpression::object)?;
    let Expression::Identifier(identifier) = receiver.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let for_of_id = effect_cleanup_for_of_iterator_statement_id(symbol_id, ctx)?;
    let for_of_node = ctx.nodes().get_node(for_of_id);
    let AstKind::ForOfStatement(for_of_statement) = for_of_node.kind() else {
        return None;
    };
    effect_cleanup_replayable_for_of_collection_key(&for_of_statement.right, ctx)?;
    let release_root_id = effect_cleanup_transparent_root_node_id(release_node.id(), ctx);
    let release_statement = ctx.nodes().parent_node(release_root_id);
    if !matches!(release_statement.kind(), AstKind::ExpressionStatement(_)) {
        return None;
    }
    let release_parent = ctx.nodes().parent_node(release_statement.id());
    let is_direct_body_statement = release_parent.id() == for_of_id
        || matches!(release_parent.kind(), AstKind::BlockStatement(_))
            && ctx.nodes().parent_node(release_parent.id()).id() == for_of_id;
    if !is_direct_body_statement {
        return None;
    }
    let has_terminating_exit = ctx.nodes().iter().any(|candidate| {
        if !for_of_statement
            .body
            .span()
            .contains_inclusive(candidate.span())
            || !matches!(
                candidate.kind(),
                AstKind::ReturnStatement(_)
                    | AstKind::ThrowStatement(_)
                    | AstKind::BreakStatement(_)
                    | AstKind::ContinueStatement(_)
            )
        {
            return false;
        }
        for ancestor in ctx.nodes().ancestors(candidate.id()) {
            if ancestor.id() == for_of_id {
                return true;
            }
            if matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) {
                return false;
            }
        }
        false
    });
    (!has_terminating_exit).then_some(for_of_id)
}

fn effect_cleanup_for_each_projection(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<(String, String)> {
    effect_cleanup_for_each_projection_inner(expression, ctx, &mut FxHashSet::default())
}

fn effect_cleanup_for_each_projection_inner(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<(String, String)> {
    let mut current_expression = expression.get_inner_expression();
    let mut member_names = Vec::new();
    while let Some(member) = current_expression.as_member_expression() {
        member_names.push(effect_cleanup_resolved_member_name(member, ctx)?);
        current_expression = member.object().get_inner_expression();
    }
    let Expression::Identifier(identifier) = current_expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited_symbol_ids.insert(symbol_id) || effect_cleanup_symbol_has_write(symbol_id, ctx) {
        return None;
    }
    if let Some(Expression::CallExpression(call)) =
        effect_cleanup_stable_initializer(symbol_id, ctx).map(Expression::get_inner_expression)
    {
        let callee_key =
            effect_cleanup_expression_key(&call.callee, ctx, &mut FxHashSet::default())?;
        let mut argument_identity_keys = Vec::new();
        let mut projected_collection_keys = FxHashSet::default();
        for argument in &call.arguments {
            let argument = argument.as_expression()?;
            if let Some((collection_key, projection_key)) = effect_cleanup_for_each_projection_inner(
                argument,
                ctx,
                &mut visited_symbol_ids.clone(),
            ) {
                projected_collection_keys.insert(collection_key);
                argument_identity_keys.push(format!("projection:{projection_key}"));
            } else {
                argument_identity_keys.push(effect_cleanup_expression_key(
                    argument,
                    ctx,
                    &mut FxHashSet::default(),
                )?);
            }
        }
        if projected_collection_keys.len() != 1 {
            return None;
        }
        member_names.reverse();
        let mut projection_key = format!("call:{callee_key}:{}", argument_identity_keys.join(":"));
        if !member_names.is_empty() {
            projection_key.push('.');
            projection_key.push_str(&member_names.join("."));
        }
        return projected_collection_keys
            .into_iter()
            .next()
            .map(|collection_key| (collection_key, projection_key));
    }
    let function_id = effect_cleanup_nearest_function_id(
        ctx.scoping()
            .get_reference(identifier.reference_id())
            .node_id(),
        ctx,
    )?;
    let first_parameter = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.params.items.first(),
        AstKind::ArrowFunctionExpression(function) => function.params.items.first(),
        _ => None,
    }?;
    if !first_parameter
        .pattern
        .get_binding_identifiers()
        .iter()
        .any(|binding| binding.symbol_id() == symbol_id)
    {
        return None;
    }
    let collection_key = effect_cleanup_for_each_callback_collection_key(function_id, ctx)?;
    member_names.reverse();
    let parameter_projection = first_parameter
        .pattern
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
        .then(|| "value".to_string())
        .or_else(|| binding_property_name_for_symbol(&first_parameter.pattern, symbol_id))?;
    let projection_key = std::iter::once(parameter_projection.as_str())
        .chain(member_names.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join(".");
    Some((collection_key, projection_key))
}

fn effect_cleanup_for_each_callback_collection_key(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let function_span = ctx.nodes().get_node(function_id).span();
    for ancestor in ctx.nodes().ancestors(function_id) {
        let AstKind::CallExpression(call) = ancestor.kind() else {
            continue;
        };
        if !call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|argument| argument.span().contains_inclusive(function_span))
        }) {
            continue;
        }
        let member = call.callee.get_inner_expression().as_member_expression()?;
        if effect_cleanup_resolved_member_name(member, ctx).as_deref() != Some("forEach") {
            return None;
        }
        let collection_key =
            effect_cleanup_expression_key(member.object(), ctx, &mut FxHashSet::default())?;
        return Some(collection_key);
    }
    None
}

fn effect_cleanup_stable_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(_))
        || effect_cleanup_symbol_has_write(symbol_id, ctx)
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    declarator.init.as_ref()
}

fn effect_cleanup_resolve_const_identifier<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if effect_cleanup_symbol_has_write(symbol_id, ctx) {
        return None;
    }
    effect_cleanup_stable_initializer(symbol_id, ctx)
}

fn effect_cleanup_resolve_const_expression<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return Some(expression);
    };
    effect_cleanup_resolve_const_identifier(identifier, ctx)
}

fn effect_cleanup_subscription_method_name<'a>(
    member: &'a MemberExpression<'a>,
) -> Option<&'a str> {
    match member {
        MemberExpression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        MemberExpression::ComputedMemberExpression(member) => {
            let Expression::Identifier(identifier) = member.expression.get_inner_expression()
            else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn effect_cleanup_resolved_member_name(
    member: &MemberExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    if let Some(name) = member.static_property_name() {
        return Some(name.to_string());
    }
    let MemberExpression::ComputedMemberExpression(computed) = member else {
        return None;
    };
    effect_cleanup_static_string(&computed.expression, ctx, &mut FxHashSet::default())
}

fn effect_cleanup_static_string(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            Some(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string(),
            )
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id) {
                return None;
            }
            effect_cleanup_static_string(
                effect_cleanup_stable_initializer(symbol_id, ctx)?,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn effect_cleanup_is_synchronously_released(
    usage: &ResourceUsage,
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut matching_release_nodes = Vec::new();
    for candidate in ctx.nodes().iter() {
        if candidate.span().start <= usage.span.start
            || effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(callback_id)
        {
            continue;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        if usage.kind == ResourceKind::Subscribe && usage.span.contains_inclusive(candidate.span())
        {
            continue;
        }
        if effect_cleanup_release_call_matches(
            candidate.id(),
            call,
            usage,
            ctx,
            &FxHashMap::default(),
        ) && !effect_cleanup_has_earlier_await(callback_id, candidate.span().start, ctx)
        {
            matching_release_nodes.push(candidate);
        }
    }
    do_nodes_cover_every_path_after_node(
        ctx.nodes().get_node(usage.node_id),
        &matching_release_nodes,
        ctx.nodes().get_node(callback_id),
        ctx,
    )
}

fn effect_cleanup_file_contains_release(usage: &ResourceUsage, ctx: &LintContext<'_>) -> bool {
    let usage_function_id = effect_cleanup_nearest_function_id(usage.node_id, ctx);
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        if !effect_cleanup_release_call_matches(
            candidate.id(),
            call,
            usage,
            ctx,
            &FxHashMap::default(),
        ) {
            return false;
        }
        if usage.kind == ResourceKind::Subscribe
            && usage.span.contains_inclusive(candidate.span())
            && !effect_cleanup_nearest_function_id(candidate.id(), ctx).is_some_and(|function_id| {
                effect_cleanup_is_self_releasing_handler(candidate, function_id, usage, ctx)
            })
        {
            return false;
        }
        let release_function_id = effect_cleanup_nearest_function_id(candidate.id(), ctx);
        release_function_id.is_none_or(|function_id| {
            effect_cleanup_node_is_reachable(candidate, function_id, ctx)
                && (Some(function_id) == usage_function_id
                    || effect_cleanup_is_potentially_reachable_function(function_id, ctx)
                    || effect_cleanup_is_self_releasing_handler(candidate, function_id, usage, ctx))
        })
    })
}

fn effect_cleanup_is_returned_effect_cleanup(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(effect_call) = candidate.kind() else {
            return false;
        };
        if !effect_cleanup_is_effect_hook_call(effect_call, ctx) {
            return false;
        }
        effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(|callback| {
                effect_cleanup_exact_local_function_id(callback, ctx, &mut FxHashSet::default())
            })
            .is_some_and(|callback_id| {
                effect_cleanup_returned_cleanup_function_ids(callback_id, ctx)
                    .contains(&function_id)
            })
    })
}

fn effect_cleanup_is_self_releasing_handler<'a>(
    release_node: &AstNode<'a>,
    function_id: NodeId,
    usage: &ResourceUsage,
    ctx: &LintContext<'a>,
) -> bool {
    if usage.kind != ResourceKind::Subscribe
        || usage.registration_method.as_deref() != Some("addEventListener")
        || usage.receiver_key.is_none()
        || usage.event_key.is_none()
        || effect_cleanup_function_is_async(function_id, ctx)
        || effect_cleanup_function_is_generator(function_id, ctx)
    {
        return false;
    }
    let release_function = ctx.nodes().get_node(function_id);
    if matches!(release_function.kind(), AstKind::ArrowFunctionExpression(function) if function.get_expression().is_some())
        || !do_nodes_cover_every_path_after_node(
            release_function,
            &[release_node],
            release_function,
            ctx,
        )
    {
        return false;
    }
    let Some(owner_id) = effect_cleanup_nearest_function_id(function_id, ctx) else {
        return false;
    };
    let owner_node = ctx.nodes().get_node(owner_id);
    let trigger_registrations = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(owner_id) {
                return false;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            member.static_property_name() == Some("addEventListener")
                && effect_cleanup_expression_key(member.object(), ctx, &mut FxHashSet::default())
                    == usage.receiver_key
                && call
                    .arguments
                    .get(1)
                    .and_then(Argument::as_expression)
                    .and_then(|handler| {
                        effect_cleanup_exact_local_function_id(
                            handler,
                            ctx,
                            &mut FxHashSet::default(),
                        )
                    })
                    == Some(function_id)
        })
        .collect::<Vec<_>>();
    if trigger_registrations
        .iter()
        .any(|registration| registration.id() == usage.node_id)
    {
        return true;
    }
    do_nodes_cover_every_path_after_node(
        ctx.nodes().get_node(usage.node_id),
        &trigger_registrations,
        owner_node,
        ctx,
    ) || effect_cleanup_nodes_cover_every_path_before_node(
        ctx.nodes().get_node(usage.node_id),
        &trigger_registrations,
        owner_node,
        ctx,
    )
}

fn effect_cleanup_nodes_cover_every_path_before_node<'a>(
    target_node: &AstNode<'a>,
    matching_nodes: &[&AstNode<'a>],
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let target_block = ctx.nodes().cfg_id(target_node.id());
    let matching_blocks = matching_nodes
        .iter()
        .copied()
        .filter(|candidate| {
            candidate.span().start < target_node.span().start
                && effect_cleanup_nearest_function_id(candidate.id(), ctx)
                    == Some(function_node.id())
        })
        .map(|candidate| ctx.nodes().cfg_id(candidate.id()))
        .collect::<FxHashSet<_>>();
    if matching_blocks.is_empty() {
        return false;
    }
    if matching_blocks.contains(&target_block) {
        return true;
    }
    let graph = ctx.cfg().graph();
    let mut visited_blocks = FxHashSet::default();
    let mut pending_blocks = vec![ctx.nodes().cfg_id(function_node.id())];
    while let Some(current_block) = pending_blocks.pop() {
        if !visited_blocks.insert(current_block) || matching_blocks.contains(&current_block) {
            continue;
        }
        if current_block == target_block {
            return false;
        }
        for edge in graph.edges_directed(current_block, oxc_cfg::graph::Direction::Outgoing) {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction
                    | oxc_cfg::EdgeType::Unreachable
                    | oxc_cfg::EdgeType::Error(oxc_cfg::ErrorEdgeKind::Implicit)
            ) {
                continue;
            }
            pending_blocks.push(oxc_cfg::graph::visit::EdgeRef::target(&edge));
        }
    }
    true
}

fn effect_cleanup_has_returned_release(
    usage: &ResourceUsage,
    callback_id: NodeId,
    execution_function_ids: &FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    if effect_cleanup_function_is_async(callback_id, ctx) {
        return false;
    }
    if effect_cleanup_has_returned_observer_disconnect_after_synchronous_iteration(
        callback_id,
        usage,
        ctx,
    ) {
        return true;
    }
    if effect_invokes_stored_disposer(
        callback_id,
        usage.node_id,
        ctx,
        |expression| {
            effect_cleanup_exact_local_function_id(expression, ctx, &mut FxHashSet::default())
        },
        |cleanup_function_id| {
            effect_cleanup_function_releases_usage(
                cleanup_function_id,
                usage,
                ctx,
                &mut FxHashSet::default(),
            )
        },
    ) {
        return true;
    }
    let mut path_anchor = ctx.nodes().get_node(usage.node_id);
    if usage.kind == ResourceKind::Socket
        && let Some(owner_id) = effect_cleanup_nearest_function_id(usage.node_id, ctx)
        && owner_id != callback_id
        && effect_cleanup_retained_function_binding_symbol_id(owner_id, ctx).is_some()
    {
        let Some(invocation_id) =
            effect_cleanup_single_direct_invocation(owner_id, callback_id, ctx)
        else {
            return false;
        };
        path_anchor = ctx.nodes().get_node(invocation_id);
    }
    let returned_expressions = effect_cleanup_return_expressions(callback_id, ctx);
    if returned_expressions.is_empty() {
        return false;
    }
    let mut matching_return_spans = Vec::new();
    for expression in returned_expressions {
        if expression.span().start < usage.span.start {
            continue;
        }
        if effect_cleanup_return_expression_releases_usage(
            expression,
            usage,
            execution_function_ids,
            ctx,
        ) {
            matching_return_spans.push(expression.span());
        }
    }
    if matching_return_spans.is_empty() {
        return false;
    }
    let callback_node = ctx.nodes().get_node(callback_id);
    if matches!(callback_node.kind(), AstKind::ArrowFunctionExpression(function) if function.get_expression().is_some())
    {
        return true;
    }
    let return_nodes = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            matches!(candidate.kind(), AstKind::ReturnStatement(statement) if statement.argument.as_ref().is_some_and(|argument| matching_return_spans.contains(&argument.span())))
        })
        .collect::<Vec<_>>();
    do_nodes_cover_every_path_after_node(path_anchor, &return_nodes, callback_node, ctx)
        || return_nodes.iter().any(|node| {
            effect_cleanup_node_is_unconditional_from(node, callback_id, ctx)
                || effect_cleanup_nodes_share_branch_path(
                    ctx.nodes().get_node(usage.node_id),
                    node,
                    callback_id,
                    ctx,
                )
        })
        || effect_cleanup_nodes_cover_if_branches(callback_id, &return_nodes, ctx)
}

fn effect_cleanup_single_direct_invocation(
    function_id: NodeId,
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let symbol_id = effect_cleanup_retained_function_binding_symbol_id(function_id, ctx)?;
    let mut references = ctx.scoping().get_resolved_references(symbol_id);
    let reference = references.next()?;
    if references.next().is_some() {
        return None;
    }
    let reference_root_id = effect_cleanup_transparent_root_node_id(reference.node_id(), ctx);
    let reference_root = ctx.nodes().get_node(reference_root_id);
    let invocation = ctx.nodes().parent_node(reference_root_id);
    let AstKind::CallExpression(call) = invocation.kind() else {
        return None;
    };
    (call.callee.span() == reference_root.span()
        && effect_cleanup_exact_local_function_id(&call.callee, ctx, &mut FxHashSet::default())
            == Some(function_id)
        && effect_cleanup_nearest_function_id(invocation.id(), ctx) == Some(callback_id)
        && effect_cleanup_node_is_reachable(invocation, callback_id, ctx))
    .then_some(invocation.id())
}

fn effect_cleanup_has_returned_observer_disconnect_after_synchronous_iteration(
    callback_id: NodeId,
    usage: &ResourceUsage,
    ctx: &LintContext<'_>,
) -> bool {
    if usage.kind != ResourceKind::Subscribe
        || usage.registration_method.as_deref() != Some("observe")
        || usage.receiver_key.is_none()
    {
        return false;
    }
    let Some(usage_function_id) = effect_cleanup_nearest_function_id(usage.node_id, ctx) else {
        return false;
    };
    let Some(iterator_call) =
        effect_cleanup_synchronous_iterator_call_for_callback(usage_function_id, ctx)
    else {
        return false;
    };
    let callback_node = ctx.nodes().get_node(callback_id);
    if effect_cleanup_nearest_function_id(iterator_call.id(), ctx) != Some(callback_id) {
        return false;
    }
    let matching_return_spans = effect_cleanup_return_expressions(callback_id, ctx)
        .into_iter()
        .filter(|expression| {
            let Some(cleanup_function_id) =
                effect_cleanup_exact_local_function_id(expression, ctx, &mut FxHashSet::default())
            else {
                return false;
            };
            let cleanup_function = ctx.nodes().get_node(cleanup_function_id);
            let disconnect_calls = ctx
                .nodes()
                .iter()
                .filter(|candidate| {
                    if effect_cleanup_nearest_function_id(candidate.id(), ctx)
                        != Some(cleanup_function_id)
                    {
                        return false;
                    }
                    let AstKind::CallExpression(call) = candidate.kind() else {
                        return false;
                    };
                    let Expression::StaticMemberExpression(member) =
                        call.callee.get_inner_expression()
                    else {
                        return false;
                    };
                    member.property.name == "disconnect"
                        && effect_cleanup_expression_key(
                            &member.object,
                            ctx,
                            &mut FxHashSet::default(),
                        ) == usage.receiver_key
                })
                .collect::<Vec<_>>();
            do_nodes_cover_every_path_after_node(
                cleanup_function,
                &disconnect_calls,
                cleanup_function,
                ctx,
            )
        })
        .map(Expression::span)
        .collect::<Vec<_>>();
    let matching_returns = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            effect_cleanup_nearest_function_id(candidate.id(), ctx) == Some(callback_id)
                && matches!(candidate.kind(), AstKind::ReturnStatement(statement)
                if statement.argument.as_ref().is_some_and(|argument| {
                    matching_return_spans.contains(&argument.span())
                }))
        })
        .collect::<Vec<_>>();
    do_nodes_cover_every_path_after_node(iterator_call, &matching_returns, callback_node, ctx)
}

fn effect_cleanup_synchronous_iterator_call_for_callback<'a, 'ctx>(
    function_id: NodeId,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx AstNode<'a>> {
    let function_node = ctx.nodes().get_node(function_id);
    let parent = ctx.nodes().parent_node(function_id);
    let AstKind::CallExpression(call) = parent.kind() else {
        return None;
    };
    let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression() else {
        return None;
    };
    let callback_index = if member.property.name == "from"
        && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "Array")
    {
        1
    } else if SYNCHRONOUS_ITERATOR_CALLBACK_METHOD_NAMES.contains(&member.property.name.as_str()) {
        0
    } else {
        return None;
    };
    call.arguments
        .get(callback_index)
        .and_then(Argument::as_expression)
        .is_some_and(|callback| callback.span() == function_node.span())
        .then_some(parent)
}

fn effect_cleanup_returned_release_covers_function_entry(
    usage: &ResourceUsage,
    function_id: NodeId,
    execution_function_ids: &FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    if effect_cleanup_function_is_async(function_id, ctx) {
        return false;
    }
    let matching_return_spans = effect_cleanup_return_expressions(function_id, ctx)
        .into_iter()
        .filter(|expression| {
            effect_cleanup_return_expression_releases_usage(
                expression,
                usage,
                execution_function_ids,
                ctx,
            )
        })
        .map(Expression::span)
        .collect::<Vec<_>>();
    let function_node = ctx.nodes().get_node(function_id);
    if matches!(function_node.kind(), AstKind::ArrowFunctionExpression(function) if function.get_expression().is_some())
    {
        return !matching_return_spans.is_empty();
    }
    let return_nodes = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            matches!(candidate.kind(), AstKind::ReturnStatement(statement)
            if statement.argument.as_ref().is_some_and(|argument| {
                matching_return_spans.contains(&argument.span())
            }))
        })
        .collect::<Vec<_>>();
    do_nodes_cover_every_path_after_node(function_node, &return_nodes, function_node, ctx)
}

fn effect_cleanup_return_expression_releases_usage<'a>(
    expression: &'a Expression<'a>,
    usage: &ResourceUsage,
    execution_function_ids: &FxHashSet<NodeId>,
    ctx: &LintContext<'a>,
) -> bool {
    if effect_cleanup_bound_release_matches(expression, usage, ctx) {
        return true;
    }
    if expression.span() == usage.span
        && usage.kind == ResourceKind::Subscribe
        && effect_cleanup_usage_returns_callable_disposer(usage, ctx)
    {
        return true;
    }
    if let Expression::Identifier(identifier) = expression.get_inner_expression()
        && let Some(returned_key) =
            effect_cleanup_expression_key(expression, ctx, &mut FxHashSet::default())
        && usage.handle_key.as_ref() == Some(&returned_key)
        && effect_cleanup_usage_returns_callable_disposer(usage, ctx)
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| !effect_cleanup_symbol_has_write(symbol_id, ctx))
    {
        return true;
    }
    if let Some(member) = expression.get_inner_expression().as_member_expression()
        && effect_cleanup_resolved_member_name(member, ctx)
            .is_some_and(|name| BOUND_RELEASE_METHOD_NAMES.contains(&name.as_str()))
        && usage.handle_key.as_ref()
            == effect_cleanup_expression_key(member.object(), ctx, &mut FxHashSet::default())
                .as_ref()
    {
        return true;
    }
    let Some(cleanup_function_id) =
        effect_cleanup_exact_local_function_id(expression, ctx, &mut FxHashSet::default())
    else {
        return false;
    };
    if execution_function_ids.contains(&cleanup_function_id) {
        return false;
    }
    effect_cleanup_function_releases_usage(
        cleanup_function_id,
        usage,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn effect_cleanup_bound_release_matches<'a>(
    expression: &'a Expression<'a>,
    usage: &ResourceUsage,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = effect_cleanup_resolve_const_expression(expression, ctx).unwrap_or(expression);
    let Expression::CallExpression(bind_call) = expression.get_inner_expression() else {
        return false;
    };
    let Some(bind_member) = bind_call
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if effect_cleanup_resolved_member_name(bind_member, ctx).as_deref() != Some("bind") {
        return false;
    }
    let Some(release_member) = bind_member
        .object()
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let Some(release_method) = effect_cleanup_resolved_member_name(release_member, ctx) else {
        return false;
    };
    let release_receiver_key =
        effect_cleanup_expression_key(release_member.object(), ctx, &mut FxHashSet::default());
    if release_receiver_key.is_none()
        || release_receiver_key.as_ref()
            != effect_cleanup_call_argument_key(bind_call, 0, ctx).as_ref()
        || usage.handle_key.as_ref() != release_receiver_key.as_ref()
    {
        return false;
    }
    match usage.kind {
        ResourceKind::Socket => matches!(
            release_method.as_str(),
            "close" | "cleanup" | "dispose" | "destroy" | "teardown"
        ),
        ResourceKind::Subscribe => {
            matches!(
                release_method.as_str(),
                "unsubscribe" | "unsub" | "close" | "unwatch" | "unlisten"
            ) || BOUND_RELEASE_METHOD_NAMES.contains(&release_method.as_str())
        }
        ResourceKind::Timer => false,
    }
}

fn effect_cleanup_usage_returns_callable_disposer(
    usage: &ResourceUsage,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(method_name) = usage.registration_method.as_deref() else {
        return false;
    };
    if matches!(method_name, "subscribe" | "sub") {
        return true;
    }
    let AstKind::CallExpression(call) = ctx.nodes().get_node(usage.node_id).kind() else {
        return false;
    };
    let receiver = call
        .callee
        .get_inner_expression()
        .as_member_expression()
        .map(MemberExpression::object);
    if method_name == "addEventListener"
        && receiver.is_some_and(|receiver| {
            effect_cleanup_imported_receiver_source(receiver, ctx).as_deref()
                == Some("@react-native-community/netinfo")
        })
    {
        return true;
    }
    if method_name == "addListener"
        && receiver.is_some_and(|receiver| {
            effect_cleanup_imported_receiver_source(receiver, ctx)
                .is_some_and(|source| source != "react-native")
        })
    {
        return true;
    }
    if method_name == "addListener"
        && call.arguments.len() >= 2
        && receiver.is_some_and(|receiver| {
            effect_cleanup_is_known_react_navigation_receiver(
                receiver,
                ctx,
                &mut FxHashSet::default(),
            )
        })
    {
        return true;
    }
    if method_name != "listen" {
        return false;
    }
    call.arguments.iter().any(|argument| {
        argument.as_expression().is_some_and(|expression| {
            matches!(
                expression.get_inner_expression(),
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            )
        })
    })
}

fn effect_cleanup_imported_receiver_source(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        return effect_cleanup_imported_receiver_source(member.object(), ctx);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    ctx.module_record()
        .import_entries
        .iter()
        .find(|entry| {
            ctx.scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
        })
        .map(|entry| entry.module_request.name().to_string())
}

fn effect_cleanup_is_known_react_navigation_receiver(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if identifier.name == "navigation" {
                return true;
            }
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            let Some(initializer) = effect_cleanup_stable_initializer(symbol_id, ctx) else {
                return false;
            };
            if let Expression::CallExpression(call) = initializer.get_inner_expression()
                && effect_cleanup_imported_receiver_source(&call.callee, ctx)
                    .is_some_and(|source| source.starts_with("@react-navigation/"))
                && matches!(call.callee.get_inner_expression(), Expression::Identifier(callee)
                    if effect_cleanup_imported_name(
                        ctx.scoping()
                            .get_reference(callee.reference_id())
                            .symbol_id()
                            .unwrap_or(symbol_id),
                        ctx,
                    ).as_deref() == Some("useNavigation"))
            {
                return true;
            }
            effect_cleanup_is_known_react_navigation_receiver(initializer, ctx, visited_symbol_ids)
        }
        Expression::CallExpression(call) => {
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            effect_cleanup_resolved_member_name(member, ctx).as_deref() == Some("getParent")
                && effect_cleanup_is_known_react_navigation_receiver(
                    member.object(),
                    ctx,
                    visited_symbol_ids,
                )
        }
        _ => false,
    }
}

fn effect_cleanup_function_releases_usage(
    cleanup_function_id: NodeId,
    usage: &ResourceUsage,
    ctx: &LintContext<'_>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    effect_cleanup_function_releases_usage_with_parameter_keys(
        cleanup_function_id,
        usage,
        ctx,
        visited_function_ids,
        &FxHashMap::default(),
    )
}

fn effect_cleanup_function_releases_usage_with_parameter_keys(
    cleanup_function_id: NodeId,
    usage: &ResourceUsage,
    ctx: &LintContext<'_>,
    visited_function_ids: &mut FxHashSet<NodeId>,
    parameter_keys: &FxHashMap<SymbolId, String>,
) -> bool {
    if !visited_function_ids.insert(cleanup_function_id) {
        return false;
    }
    let mut matching_release_nodes = Vec::new();
    for candidate in ctx.nodes().iter() {
        if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(cleanup_function_id) {
            continue;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        let is_collection_cleanup =
            effect_cleanup_is_direct_timer_collection_cleanup(candidate, usage, ctx);
        if is_collection_cleanup
            || effect_cleanup_release_call_matches(candidate.id(), call, usage, ctx, parameter_keys)
        {
            if is_collection_cleanup
                && effect_cleanup_mapped_resource_collection_symbol(
                    ctx.nodes().get_node(usage.node_id),
                    ctx,
                )
                .is_some()
            {
                return true;
            }
            if let Some(for_of_anchor_id) =
                effect_cleanup_direct_exhaustive_for_of_release_anchor(candidate, ctx)
            {
                matching_release_nodes.push(ctx.nodes().get_node(for_of_anchor_id));
                continue;
            }
            matching_release_nodes.push(
                effect_cleanup_live_handle_guard(
                    candidate,
                    cleanup_function_id,
                    usage,
                    parameter_keys,
                    ctx,
                )
                .or_else(|| {
                    effect_cleanup_correlated_usage_guard(
                        candidate,
                        cleanup_function_id,
                        usage,
                        ctx,
                    )
                })
                .unwrap_or(candidate),
            );
            continue;
        }
        if effect_cleanup_is_synchronous_iterator_call(call)
            && effect_cleanup_node_is_unconditional_from(candidate, cleanup_function_id, ctx)
            && !effect_cleanup_has_earlier_await(cleanup_function_id, candidate.span().start, ctx)
            && call.arguments.iter().any(|argument| {
                argument
                    .as_expression()
                    .and_then(|callback| {
                        effect_cleanup_exact_local_function_id(
                            callback,
                            ctx,
                            &mut FxHashSet::default(),
                        )
                    })
                    .is_some_and(|callback_id| {
                        !effect_cleanup_function_is_async(callback_id, ctx)
                            && !effect_cleanup_function_is_generator(callback_id, ctx)
                            && effect_cleanup_function_releases_usage_with_parameter_keys(
                                callback_id,
                                usage,
                                ctx,
                                &mut visited_function_ids.clone(),
                                parameter_keys,
                            )
                    })
            })
        {
            return true;
        }
        let Some(helper_function_id) =
            effect_cleanup_exact_local_function_id(&call.callee, ctx, &mut FxHashSet::default())
        else {
            continue;
        };
        if effect_cleanup_node_is_unconditional_from(candidate, cleanup_function_id, ctx)
            && !effect_cleanup_has_earlier_await(cleanup_function_id, candidate.span().start, ctx)
            && effect_cleanup_helper_parameter_keys(helper_function_id, call, parameter_keys, ctx)
                .is_some_and(|helper_parameter_keys| {
                    !effect_cleanup_function_is_async(helper_function_id, ctx)
                        && !effect_cleanup_function_is_generator(helper_function_id, ctx)
                        && effect_cleanup_function_releases_usage_with_parameter_keys(
                            helper_function_id,
                            usage,
                            ctx,
                            &mut visited_function_ids.clone(),
                            &helper_parameter_keys,
                        )
                })
        {
            return true;
        }
    }
    if usage.kind == ResourceKind::Subscribe && !matching_release_nodes.is_empty() {
        return true;
    }
    matching_release_nodes.iter().any(|node| {
        effect_cleanup_node_is_unconditional_from(node, cleanup_function_id, ctx)
            && !effect_cleanup_has_earlier_await(cleanup_function_id, node.span().start, ctx)
    }) || effect_cleanup_nodes_cover_if_branches(cleanup_function_id, &matching_release_nodes, ctx)
}

fn effect_cleanup_helper_parameter_keys(
    function_id: NodeId,
    call: &CallExpression<'_>,
    inherited_parameter_keys: &FxHashMap<SymbolId, String>,
    ctx: &LintContext<'_>,
) -> Option<FxHashMap<SymbolId, String>> {
    let parameters = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return None,
    };
    let mut parameter_keys = inherited_parameter_keys.clone();
    for (parameter_index, parameter) in parameters.items.iter().enumerate() {
        let (binding, default_value) = match &parameter.pattern {
            BindingPattern::BindingIdentifier(binding) => (binding, None),
            BindingPattern::AssignmentPattern(assignment) => {
                let BindingPattern::BindingIdentifier(binding) = &assignment.left else {
                    continue;
                };
                (binding, Some(&assignment.right))
            }
            _ => continue,
        };
        if effect_cleanup_symbol_has_write(binding.symbol_id(), ctx) {
            return None;
        }
        let argument_key = call
            .arguments
            .get(parameter_index)
            .and_then(Argument::as_expression)
            .and_then(|argument| {
                effect_cleanup_expression_key_with_parameter_keys(
                    argument,
                    ctx,
                    inherited_parameter_keys,
                )
            })
            .or_else(|| {
                default_value.and_then(|default_value| {
                    effect_cleanup_expression_key_with_parameter_keys(
                        default_value,
                        ctx,
                        inherited_parameter_keys,
                    )
                })
            });
        if let Some(argument_key) = argument_key {
            parameter_keys.insert(binding.symbol_id(), argument_key);
        }
    }
    Some(parameter_keys)
}

fn effect_cleanup_live_handle_guard<'a, 'ctx>(
    release_node: &'ctx AstNode<'a>,
    owner_function_id: NodeId,
    usage: &ResourceUsage,
    parameter_keys: &FxHashMap<SymbolId, String>,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx AstNode<'a>> {
    let mut guarded_resource_keys = usage
        .handle_key
        .iter()
        .chain(usage.receiver_key.iter())
        .map(String::as_str)
        .collect::<Vec<_>>();
    if usage.registration_method.as_deref() == Some("observe") {
        guarded_resource_keys.extend(usage.event_key.iter().map(String::as_str));
    }
    if guarded_resource_keys.is_empty() {
        return None;
    }
    let mut descendant_span = release_node.span();
    for ancestor in ctx.nodes().ancestors(release_node.id()) {
        if ancestor.id() == owner_function_id {
            return None;
        }
        match ancestor.kind() {
            AstKind::IfStatement(statement)
                if statement
                    .consequent
                    .span()
                    .contains_inclusive(descendant_span)
                    && guarded_resource_keys.iter().any(|resource_key| {
                        effect_cleanup_test_requires_live_handle(
                            &statement.test,
                            resource_key,
                            parameter_keys,
                            ctx,
                        )
                    }) =>
            {
                return Some(ancestor);
            }
            AstKind::LogicalExpression(expression)
                if expression.operator == oxc_syntax::operator::LogicalOperator::And
                    && expression.right.span().contains_inclusive(descendant_span)
                    && guarded_resource_keys.iter().any(|resource_key| {
                        effect_cleanup_test_requires_live_handle(
                            &expression.left,
                            resource_key,
                            parameter_keys,
                            ctx,
                        )
                    }) =>
            {
                return Some(ancestor);
            }
            _ => {}
        }
        descendant_span = ancestor.span();
    }
    None
}

fn effect_cleanup_correlated_usage_guard<'a, 'ctx>(
    release_node: &'ctx AstNode<'a>,
    cleanup_function_id: NodeId,
    usage: &ResourceUsage,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx AstNode<'a>> {
    let usage_function_id = effect_cleanup_nearest_function_id(usage.node_id, ctx)?;
    let usage_node = ctx.nodes().get_node(usage.node_id);
    let usage_guards = effect_cleanup_boolean_guard_path(usage_node, usage_function_id, ctx);
    if usage_guards.is_empty() {
        return None;
    }
    let mut descendant_span = release_node.span();
    for ancestor in ctx.nodes().ancestors(release_node.id()) {
        if ancestor.id() == cleanup_function_id {
            return None;
        }
        let AstKind::IfStatement(statement) = ancestor.kind() else {
            descendant_span = ancestor.span();
            continue;
        };
        let Some((symbol_id, test_truthiness)) =
            effect_cleanup_boolean_guard_symbol(&statement.test, ctx)
        else {
            descendant_span = ancestor.span();
            continue;
        };
        let required_truthiness = if statement
            .consequent
            .span()
            .contains_inclusive(descendant_span)
        {
            test_truthiness
        } else if statement
            .alternate
            .as_ref()
            .is_some_and(|alternate| alternate.span().contains_inclusive(descendant_span))
        {
            !test_truthiness
        } else {
            descendant_span = ancestor.span();
            continue;
        };
        if usage_guards.contains(&(symbol_id, required_truthiness)) {
            return Some(ancestor);
        }
        descendant_span = ancestor.span();
    }
    None
}

fn effect_cleanup_boolean_guard_path(
    node: &AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<(SymbolId, bool)> {
    let mut guards = FxHashSet::default();
    let mut descendant_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == function_id {
            break;
        }
        if let AstKind::IfStatement(statement) = ancestor.kind()
            && let Some((symbol_id, test_truthiness)) =
                effect_cleanup_boolean_guard_symbol(&statement.test, ctx)
        {
            if statement
                .consequent
                .span()
                .contains_inclusive(descendant_span)
            {
                guards.insert((symbol_id, test_truthiness));
            } else if statement
                .alternate
                .as_ref()
                .is_some_and(|alternate| alternate.span().contains_inclusive(descendant_span))
            {
                guards.insert((symbol_id, !test_truthiness));
            }
        }
        descendant_span = ancestor.span();
    }
    guards
}

fn effect_cleanup_boolean_guard_symbol(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<(SymbolId, bool)> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            (!effect_cleanup_symbol_has_write(symbol_id, ctx)).then_some((symbol_id, true))
        }
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
        {
            effect_cleanup_boolean_guard_symbol(&unary.argument, ctx)
                .map(|(symbol_id, truthiness)| (symbol_id, !truthiness))
        }
        _ => None,
    }
}

fn effect_cleanup_test_requires_live_handle(
    expression: &Expression<'_>,
    handle_key: &str,
    parameter_keys: &FxHashMap<SymbolId, String>,
    ctx: &LintContext<'_>,
) -> bool {
    if effect_cleanup_expression_key_with_parameter_keys(expression, ctx, parameter_keys).as_deref()
        == Some(handle_key)
    {
        return true;
    }
    match expression.get_inner_expression() {
        Expression::LogicalExpression(logical)
            if logical.operator == oxc_syntax::operator::LogicalOperator::And =>
        {
            effect_cleanup_test_requires_live_handle(&logical.left, handle_key, parameter_keys, ctx)
                || effect_cleanup_test_requires_live_handle(
                    &logical.right,
                    handle_key,
                    parameter_keys,
                    ctx,
                )
        }
        Expression::BinaryExpression(binary)
            if matches!(binary.operator.as_str(), "!=" | "!==") =>
        {
            effect_cleanup_is_nullish_expression(&binary.left, ctx)
                && effect_cleanup_expression_key_with_parameter_keys(
                    &binary.right,
                    ctx,
                    parameter_keys,
                )
                .as_deref()
                    == Some(handle_key)
                || effect_cleanup_is_nullish_expression(&binary.right, ctx)
                    && effect_cleanup_expression_key_with_parameter_keys(
                        &binary.left,
                        ctx,
                        parameter_keys,
                    )
                    .as_deref()
                        == Some(handle_key)
        }
        Expression::CallExpression(call)
            if matches!(call.callee.get_inner_expression(), Expression::Identifier(callee)
                if callee.name == "Boolean"
                    && ctx.scoping().get_reference(callee.reference_id()).symbol_id().is_none()) =>
        {
            call.arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|argument| {
                    effect_cleanup_test_requires_live_handle(
                        argument,
                        handle_key,
                        parameter_keys,
                        ctx,
                    )
                })
        }
        _ => false,
    }
}

fn effect_cleanup_is_nullish_expression(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) if identifier.name == "undefined" => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none(),
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::Void =>
        {
            true
        }
        _ => false,
    }
}

fn effect_cleanup_has_earlier_await(
    function_id: NodeId,
    before_offset: u32,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        candidate.span().start < before_offset
            && effect_cleanup_nearest_function_id(candidate.id(), ctx) == Some(function_id)
            && matches!(candidate.kind(), AstKind::AwaitExpression(_))
    })
}

fn effect_cleanup_release_call_matches<'a>(
    release_node_id: NodeId,
    call: &'a CallExpression<'a>,
    usage: &ResourceUsage,
    ctx: &LintContext<'a>,
    parameter_keys: &FxHashMap<SymbolId, String>,
) -> bool {
    if usage.kind == ResourceKind::Timer {
        let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
            return false;
        };
        let expected = match usage.registration_method.as_deref() {
            Some("setInterval") => "clearInterval",
            Some("setTimeout") => "clearTimeout",
            _ => return false,
        };
        if callee.name != expected {
            return false;
        }
        let Some(handle_key) = usage.handle_key.as_ref() else {
            return false;
        };
        return call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(|argument| {
                effect_cleanup_expression_key_with_parameter_keys(argument, ctx, parameter_keys)
            })
            .as_ref()
            == Some(handle_key);
    }
    if let Expression::Identifier(callee) = call.callee.get_inner_expression() {
        let callee_key =
            effect_cleanup_expression_key_with_parameter_keys(&call.callee, ctx, parameter_keys);
        if usage.kind == ResourceKind::Subscribe
            && effect_cleanup_usage_returns_callable_disposer(usage, ctx)
            && usage.collection_key.is_some()
            && usage.collection_key.as_ref()
                == effect_cleanup_iterator_parameter_collection_key(&call.callee, ctx).as_ref()
        {
            return true;
        }
        if call.arguments.is_empty()
            && usage.handle_key.is_some()
            && usage.handle_key.as_ref() == callee_key.as_ref()
            && usage.kind == ResourceKind::Subscribe
            && (!matches!(
                usage.registration_method.as_deref(),
                Some("addEventListener" | "addListener")
            ) || effect_cleanup_usage_returns_callable_disposer(usage, ctx))
        {
            return true;
        }
        if matches!(callee.name.as_str(), "unsubscribe" | "unsub")
            && usage.kind == ResourceKind::Subscribe
            && usage.handle_key.is_some()
            && usage.handle_key.as_ref()
                == effect_cleanup_call_argument_key_with_parameter_keys(
                    call,
                    0,
                    ctx,
                    parameter_keys,
                )
                .as_ref()
        {
            return true;
        }
        return false;
    }
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(release_method) = effect_cleanup_resolved_member_name(member, ctx) else {
        return false;
    };
    if effect_cleanup_is_react_ref_listener_replacement_release(release_node_id, call, usage, ctx)
        || effect_cleanup_is_react_ref_observer_replacement_release(
            release_node_id,
            call,
            usage,
            ctx,
        )
    {
        return true;
    }
    let receiver_key = if parameter_keys.is_empty() {
        effect_cleanup_resource_identity_key(member.object(), ctx)
    } else {
        effect_cleanup_expression_key_with_parameter_keys(member.object(), ctx, parameter_keys)
    };
    if let Some(channel_client_key) = usage.channel_client_key.as_ref()
        && receiver_key.as_ref() == Some(channel_client_key)
    {
        if release_method == "removeAllChannels" && call.arguments.is_empty() {
            return true;
        }
        if release_method == "removeChannel"
            && usage.handle_key.as_ref()
                == effect_cleanup_call_argument_key_with_parameter_keys(
                    call,
                    0,
                    ctx,
                    parameter_keys,
                )
                .as_ref()
        {
            return true;
        }
    }
    if usage.collection_key.is_some()
        && usage.collection_key.as_ref()
            == effect_cleanup_iterator_parameter_collection_key(member.object(), ctx).as_ref()
        && BOUND_RELEASE_METHOD_NAMES.contains(&release_method.as_str())
        && call.arguments.is_empty()
    {
        return true;
    }
    if usage.kind == ResourceKind::Socket {
        return matches!(
            release_method.as_str(),
            "close" | "cleanup" | "dispose" | "destroy" | "teardown"
        ) && usage.handle_key.as_ref() == receiver_key.as_ref();
    }
    if release_method == "abort"
        && effect_cleanup_listener_abort_controller_key(usage, ctx)
            .is_some_and(|controller| receiver_key.as_ref() == Some(&controller))
    {
        return true;
    }
    if usage.handle_key.is_some()
        && usage.handle_key.as_ref() == receiver_key.as_ref()
        && BOUND_RELEASE_METHOD_NAMES.contains(&release_method.as_str())
        && call.arguments.is_empty()
    {
        return true;
    }
    let Some(registration_method) = usage.registration_method.as_deref() else {
        return false;
    };
    if !effect_cleanup_methods_are_paired(registration_method, &release_method) {
        return false;
    }
    let Some(registration_receiver_key) = usage.receiver_key.as_ref() else {
        return false;
    };
    if receiver_key.as_ref() != Some(registration_receiver_key) {
        return false;
    }
    if matches!(registration_method, "observe") {
        if release_method == "disconnect"
            && let AstKind::CallExpression(registration_call) =
                ctx.nodes().get_node(usage.node_id).kind()
            && let Some(registration_collection_key) = registration_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .and_then(|target| effect_cleanup_for_each_projection(target, ctx))
                .map(|(collection_key, _)| collection_key)
            && effect_cleanup_nearest_function_id(release_node_id, ctx)
                .and_then(|function_id| {
                    effect_cleanup_for_each_callback_collection_key(function_id, ctx)
                })
                .as_ref()
                != Some(&registration_collection_key)
        {
            return false;
        }
        return release_method == "disconnect"
            || release_method == "unobserve"
                && effect_cleanup_call_argument_key_with_parameter_keys(
                    call,
                    0,
                    ctx,
                    parameter_keys,
                )
                .as_ref()
                    == usage.event_key.as_ref();
    }
    let release_event_key = if parameter_keys.is_empty() {
        call.arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(|argument| effect_cleanup_resource_identity_key(argument, ctx))
    } else {
        effect_cleanup_call_argument_key_with_parameter_keys(call, 0, ctx, parameter_keys)
    };
    if usage.event_key.is_some() && usage.event_key.as_ref() != release_event_key.as_ref() {
        return false;
    }
    if registration_method == "on" && release_method == "off" {
        if call.arguments.len() == 1 {
            return true;
        }
        if call.arguments.is_empty()
            && matches!(ctx.nodes().get_node(usage.node_id).kind(), AstKind::CallExpression(registration_call)
                if registration_call.arguments.is_empty())
        {
            return true;
        }
    }
    if registration_method == "on" && release_method == "on" {
        return call.arguments.get(1).is_some_and(|argument| {
            matches!(
                argument
                    .as_expression()
                    .map(|expression| expression.get_inner_expression()),
                Some(Expression::NullLiteral(_))
            )
        });
    }
    let handler_index = if registration_method == "addListener" && usage.event_key.is_none() {
        0
    } else {
        1
    };
    let release_handler_key = if parameter_keys.is_empty() {
        call.arguments
            .get(handler_index)
            .and_then(Argument::as_expression)
            .and_then(|argument| effect_cleanup_resource_identity_key(argument, ctx))
    } else {
        effect_cleanup_call_argument_key_with_parameter_keys(
            call,
            handler_index,
            ctx,
            parameter_keys,
        )
    };
    if usage.handler_key.is_none() || usage.handler_key.as_ref() != release_handler_key.as_ref() {
        return false;
    }
    if registration_method == "addEventListener" {
        let release_capture_key = effect_cleanup_listener_options(call.arguments.get(2), ctx).0;
        if usage.capture_key.is_none() || usage.capture_key != release_capture_key {
            return false;
        }
    }
    true
}

fn effect_cleanup_is_react_ref_listener_replacement_release<'a>(
    release_node_id: NodeId,
    release_call: &'a CallExpression<'a>,
    usage: &ResourceUsage,
    ctx: &LintContext<'a>,
) -> bool {
    if usage.kind != ResourceKind::Subscribe
        || usage.registration_method.as_deref() != Some("addEventListener")
    {
        return false;
    }
    let Some(owner_function_id) = effect_cleanup_nearest_function_id(usage.node_id, ctx) else {
        return false;
    };
    if effect_cleanup_nearest_function_id(release_node_id, ctx) != Some(owner_function_id)
        || !effect_cleanup_function_is_react_ref_callback(owner_function_id, ctx)
    {
        return false;
    }
    let Some(registration_receiver_key) = usage.receiver_key.as_ref() else {
        return false;
    };
    let parameters = match ctx.nodes().get_node(owner_function_id).kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return false,
    };
    let Some(parameter_key) = parameters
        .items
        .first()
        .and_then(|parameter| parameter.pattern.get_binding_identifier())
        .map(|parameter| format!("symbol:{:?}", parameter.symbol_id()))
    else {
        return false;
    };
    if registration_receiver_key != &parameter_key {
        return false;
    }
    let Some(release_member) = release_call
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if effect_cleanup_resolved_member_name(release_member, ctx).as_deref()
        != Some("removeEventListener")
    {
        return false;
    }
    let Some(release_receiver_key) =
        effect_cleanup_react_ref_current_receiver_key(release_member.object(), ctx)
    else {
        return false;
    };
    let release_event_key = release_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .and_then(|argument| effect_cleanup_resource_identity_key(argument, ctx));
    let release_handler_key = release_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
        .and_then(|argument| effect_cleanup_resource_identity_key(argument, ctx));
    if usage.event_key.is_none()
        || usage.event_key != release_event_key
        || usage.handler_key.is_none()
        || usage.handler_key != release_handler_key
        || usage.capture_key.is_none()
        || usage.capture_key
            != effect_cleanup_listener_options(release_call.arguments.get(2), ctx).0
    {
        return false;
    }
    let release_node = ctx.nodes().get_node(release_node_id);
    let release_anchor_id = effect_cleanup_react_ref_listener_release_anchor_id(
        release_node,
        owner_function_id,
        &release_receiver_key,
        ctx,
    );
    let release_anchor = ctx.nodes().get_node(release_anchor_id);
    let matching_assignments = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            if candidate.span().start <= release_node.span().start
                || effect_cleanup_nearest_function_id(candidate.id(), ctx)
                    != Some(owner_function_id)
            {
                return false;
            }
            let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                return false;
            };
            assignment.operator.as_str() == "="
                && effect_cleanup_assignment_target_key(&assignment.left, ctx).as_ref()
                    == Some(&release_receiver_key)
                && effect_cleanup_expression_key(&assignment.right, ctx, &mut FxHashSet::default())
                    .as_ref()
                    == Some(registration_receiver_key)
                && effect_cleanup_nodes_cover_every_path_before_node(
                    candidate,
                    &[release_anchor],
                    ctx.nodes().get_node(owner_function_id),
                    ctx,
                )
        })
        .collect::<Vec<_>>();
    effect_cleanup_nodes_cover_every_path_before_node(
        ctx.nodes().get_node(usage.node_id),
        &matching_assignments,
        ctx.nodes().get_node(owner_function_id),
        ctx,
    )
}

fn effect_cleanup_is_react_ref_observer_replacement_release<'a>(
    release_node_id: NodeId,
    release_call: &'a CallExpression<'a>,
    usage: &ResourceUsage,
    ctx: &LintContext<'a>,
) -> bool {
    if usage.kind != ResourceKind::Subscribe
        || usage.registration_method.as_deref() != Some("observe")
        || usage.receiver_key.is_none()
        || usage.event_key.is_none()
    {
        return false;
    }
    let Some(owner_function_id) = effect_cleanup_nearest_function_id(usage.node_id, ctx) else {
        return false;
    };
    if effect_cleanup_nearest_function_id(release_node_id, ctx) != Some(owner_function_id)
        || !effect_cleanup_function_is_react_ref_callback(owner_function_id, ctx)
    {
        return false;
    }
    let parameters = match ctx.nodes().get_node(owner_function_id).kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return false,
    };
    let Some(parameter_key) = parameters
        .items
        .first()
        .and_then(|parameter| parameter.pattern.get_binding_identifier())
        .map(|parameter| format!("symbol:{:?}", parameter.symbol_id()))
    else {
        return false;
    };
    if usage.event_key.as_ref() != Some(&parameter_key) {
        return false;
    }
    let Some(release_member) = release_call
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if !matches!(release_member, MemberExpression::StaticMemberExpression(member)
        if member.property.name == "disconnect")
    {
        return false;
    }
    let Some(release_receiver_key) =
        effect_cleanup_react_ref_current_receiver_key(release_member.object(), ctx)
    else {
        return false;
    };
    let owner_function = ctx.nodes().get_node(owner_function_id);
    let release_node = ctx.nodes().get_node(release_node_id);
    if !do_nodes_cover_every_path_after_node(owner_function, &[release_node], owner_function, ctx) {
        return false;
    }
    let matching_assignments = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(owner_function_id) {
                return false;
            }
            let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                return false;
            };
            assignment.operator.as_str() == "="
                && effect_cleanup_assignment_target_key(&assignment.left, ctx).as_ref()
                    == Some(&release_receiver_key)
                && effect_cleanup_expression_key(&assignment.right, ctx, &mut FxHashSet::default())
                    == usage.receiver_key
        })
        .collect::<Vec<_>>();
    do_nodes_cover_every_path_after_node(
        ctx.nodes().get_node(usage.node_id),
        &matching_assignments,
        owner_function,
        ctx,
    )
}

fn effect_cleanup_react_ref_current_receiver_key<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let expression = effect_cleanup_resolve_const_expression(expression, ctx)?;
    let member = expression.get_inner_expression().as_member_expression()?;
    if effect_cleanup_resolved_member_name(member, ctx).as_deref() != Some("current")
        || !effect_cleanup_expression_is_react_ref(member.object(), ctx)
    {
        return None;
    }
    effect_cleanup_expression_key(expression, ctx, &mut FxHashSet::default())
}

fn effect_cleanup_react_ref_listener_release_anchor_id(
    release_node: &AstNode<'_>,
    owner_function_id: NodeId,
    release_receiver_key: &str,
    ctx: &LintContext<'_>,
) -> NodeId {
    let mut descendant_span = release_node.span();
    for ancestor in ctx.nodes().ancestors(release_node.id()) {
        if ancestor.id() == owner_function_id {
            break;
        }
        if let AstKind::IfStatement(statement) = ancestor.kind()
            && statement.alternate.is_none()
            && statement
                .consequent
                .span()
                .contains_inclusive(descendant_span)
            && effect_cleanup_test_requires_live_handle(
                &statement.test,
                release_receiver_key,
                &FxHashMap::default(),
                ctx,
            )
        {
            return ancestor.id();
        }
        descendant_span = ancestor.span();
    }
    release_node.id()
}

fn effect_cleanup_iterator_parameter_collection_key(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let parameter_symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let function_id = effect_cleanup_nearest_function_id(
        ctx.scoping()
            .get_reference(identifier.reference_id())
            .node_id(),
        ctx,
    )?;
    let first_parameter_symbol_id = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function
            .params
            .items
            .first()
            .and_then(|parameter| parameter.pattern.get_binding_identifier())
            .map(|binding| binding.symbol_id()),
        AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .first()
            .and_then(|parameter| parameter.pattern.get_binding_identifier())
            .map(|binding| binding.symbol_id()),
        _ => None,
    }?;
    if first_parameter_symbol_id != parameter_symbol_id {
        return None;
    }
    let function_span = ctx.nodes().get_node(function_id).span();
    for ancestor in ctx.nodes().ancestors(function_id) {
        let AstKind::CallExpression(call) = ancestor.kind() else {
            continue;
        };
        if !call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|argument| argument.span().contains_inclusive(function_span))
        }) {
            continue;
        }
        let member = call.callee.get_inner_expression().as_member_expression()?;
        if effect_cleanup_resolved_member_name(member, ctx).as_deref() != Some("forEach") {
            return None;
        }
        return effect_cleanup_expression_key(member.object(), ctx, &mut FxHashSet::default());
    }
    None
}

fn effect_cleanup_methods_are_paired(registration: &str, release: &str) -> bool {
    if matches!(release, "cleanup" | "dispose" | "destroy" | "teardown") {
        return true;
    }
    match registration {
        "addEventListener" => release == "removeEventListener",
        "addListener" => matches!(release, "removeListener" | "off"),
        "on" => matches!(release, "off" | "removeListener"),
        "watch" => matches!(release, "unwatch" | "close"),
        "listen" => matches!(release, "unlisten" | "close"),
        "sub" => matches!(release, "unsub" | "unsubscribe"),
        "subscribe" => matches!(release, "unsubscribe" | "unsub"),
        "observe" => matches!(release, "unobserve" | "disconnect"),
        _ => false,
    }
}

fn effect_cleanup_call_argument_key(
    call: &CallExpression<'_>,
    index: usize,
    ctx: &LintContext<'_>,
) -> Option<String> {
    call.arguments
        .get(index)
        .and_then(Argument::as_expression)
        .and_then(|argument| {
            effect_cleanup_expression_key(argument, ctx, &mut FxHashSet::default())
        })
}

fn effect_cleanup_call_argument_key_with_parameter_keys(
    call: &CallExpression<'_>,
    index: usize,
    ctx: &LintContext<'_>,
    parameter_keys: &FxHashMap<SymbolId, String>,
) -> Option<String> {
    call.arguments
        .get(index)
        .and_then(Argument::as_expression)
        .and_then(|argument| {
            effect_cleanup_expression_key_with_parameter_keys(argument, ctx, parameter_keys)
        })
}

fn effect_cleanup_expression_key_with_parameter_keys(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    parameter_keys: &FxHashMap<SymbolId, String>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            if let Some(parameter_key) =
                symbol_id.and_then(|symbol_id| parameter_keys.get(&symbol_id))
            {
                return Some(parameter_key.clone());
            }
            effect_cleanup_expression_key(expression, ctx, &mut FxHashSet::default())
        }
        expression if expression.as_member_expression().is_some() => {
            let member = expression.as_member_expression()?;
            let receiver_key = effect_cleanup_expression_key_with_parameter_keys(
                member.object(),
                ctx,
                parameter_keys,
            )?;
            let property_name = effect_cleanup_resolved_member_name(member, ctx)?;
            Some(format!("{receiver_key}.{property_name}"))
        }
        _ => effect_cleanup_expression_key(expression, ctx, &mut FxHashSet::default()),
    }
}

fn effect_cleanup_return_expressions<'a>(
    function_id: NodeId,
    ctx: &LintContext<'a>,
) -> Vec<&'a Expression<'a>> {
    let function_node = ctx.nodes().get_node(function_id);
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        return vec![expression];
    }
    let mut returned_expressions = Vec::new();
    for candidate in ctx.nodes().iter() {
        if effect_cleanup_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
            continue;
        }
        let AstKind::ReturnStatement(statement) = candidate.kind() else {
            continue;
        };
        if let Some(argument) = &statement.argument {
            returned_expressions.push(argument);
        }
    }
    returned_expressions
}

fn effect_cleanup_nodes_cover_if_branches(
    function_id: NodeId,
    matching_nodes: &[&AstNode<'_>],
    ctx: &LintContext<'_>,
) -> bool {
    if matching_nodes.is_empty() {
        return false;
    }
    let mut branches_by_if_span: FxHashMap<(u32, u32), (bool, bool)> = FxHashMap::default();
    for matching_node in matching_nodes {
        for ancestor in ctx.nodes().ancestors(matching_node.id()) {
            if ancestor.id() == function_id {
                break;
            }
            let AstKind::IfStatement(statement) = ancestor.kind() else {
                continue;
            };
            if !effect_cleanup_node_is_unconditional_from(ancestor, function_id, ctx) {
                continue;
            }
            let entry = branches_by_if_span
                .entry((statement.span.start, statement.span.end))
                .or_default();
            if statement
                .consequent
                .span()
                .contains_inclusive(matching_node.span())
            {
                entry.0 = true;
            }
            if statement
                .alternate
                .as_ref()
                .is_some_and(|alternate| alternate.span().contains_inclusive(matching_node.span()))
            {
                entry.1 = true;
            }
        }
    }
    branches_by_if_span
        .values()
        .any(|branches| branches.0 && branches.1)
}

fn effect_cleanup_node_is_reachable(
    node: &AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    is_node_reachable_within_function(node, ctx.nodes().get_node(function_id), ctx)
}

fn effect_cleanup_nodes_share_branch_path(
    usage_node: &AstNode<'_>,
    cleanup_node: &AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let usage_branches = effect_cleanup_branch_path(usage_node, function_id, ctx);
    !usage_branches.is_empty()
        && usage_branches == effect_cleanup_branch_path(cleanup_node, function_id, ctx)
}

fn effect_cleanup_branch_path(
    node: &AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Vec<(u32, bool)> {
    let mut branches = Vec::new();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == function_id {
            break;
        }
        let AstKind::IfStatement(statement) = ancestor.kind() else {
            continue;
        };
        if statement.consequent.span().contains_inclusive(node.span()) {
            branches.push((statement.span.start, true));
        } else if statement
            .alternate
            .as_ref()
            .is_some_and(|alternate| alternate.span().contains_inclusive(node.span()))
        {
            branches.push((statement.span.start, false));
        }
    }
    branches.sort_unstable();
    branches
}

fn effect_cleanup_node_is_unconditional_from(
    node: &AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == function_id {
            return true;
        }
        let is_unconditional =
            match ancestor.kind() {
                AstKind::IfStatement(statement) => {
                    if statement.test.span().contains_inclusive(child_span) {
                        true
                    } else {
                        let static_test = effect_cleanup_static_boolean(&statement.test);
                        statement.consequent.span().contains_inclusive(child_span)
                            && static_test == Some(true)
                            || statement.alternate.as_ref().is_some_and(|alternate| {
                                alternate.span().contains_inclusive(child_span)
                                    && static_test == Some(false)
                            })
                    }
                }
                AstKind::ConditionalExpression(expression) => {
                    if expression.test.span().contains_inclusive(child_span) {
                        true
                    } else {
                        let static_test = effect_cleanup_static_boolean(&expression.test);
                        expression.consequent.span().contains_inclusive(child_span)
                            && static_test == Some(true)
                            || expression.alternate.span().contains_inclusive(child_span)
                                && static_test == Some(false)
                    }
                }
                AstKind::LogicalExpression(expression) => {
                    expression.left.span().contains_inclusive(child_span)
                        || expression.right.span().contains_inclusive(child_span)
                            && matches!(
                                (
                                    expression.operator.as_str(),
                                    effect_cleanup_static_boolean(&expression.left)
                                ),
                                ("&&", Some(true)) | ("||", Some(false))
                            )
                }
                AstKind::TryStatement(statement) => statement
                    .finalizer
                    .as_ref()
                    .is_some_and(|finalizer| finalizer.span.contains_inclusive(child_span)),
                AstKind::SwitchStatement(statement) => {
                    statement.discriminant.span().contains_inclusive(child_span)
                }
                AstKind::ForStatement(statement) => {
                    statement.init.as_ref().is_some_and(|initializer| {
                        initializer.span().contains_inclusive(child_span)
                    }) || statement
                        .test
                        .as_ref()
                        .is_some_and(|test| test.span().contains_inclusive(child_span))
                }
                AstKind::ForInStatement(statement) => {
                    statement.right.span().contains_inclusive(child_span)
                }
                AstKind::ForOfStatement(statement) => {
                    statement.right.span().contains_inclusive(child_span)
                }
                AstKind::WhileStatement(statement) => {
                    statement.test.span().contains_inclusive(child_span)
                }
                AstKind::CatchClause(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::SwitchCase(_)
                | AstKind::AwaitExpression(_)
                | AstKind::ThrowStatement(_) => false,
                _ => true,
            };
        if !is_unconditional {
            return false;
        }
        child_span = ancestor.span();
    }
    false
}

fn effect_cleanup_static_boolean(expression: &Expression<'_>) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
        {
            effect_cleanup_static_boolean(&unary.argument).map(|value| !value)
        }
        _ => None,
    }
}
