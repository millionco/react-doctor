use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{
    AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator, UpdateOperator,
};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{AstNode, context::LintContext, rule::Rule};

const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const MESSAGE: &str = "This requestAnimationFrame loop can schedule another frame but is never cancelled, so pending work may continue after unmount; store every frame id in one handle and cancel that handle from the returned effect cleanup.";
const COLLECTION_VALUES_PREFIX: &str = "collection-values:";

#[derive(Debug, Default, Clone)]
pub struct EffectRafLoopNeedsCancel;

#[derive(Debug, Clone)]
struct RafLoop {
    initial_call_id: NodeId,
    scheduled_function_id: NodeId,
    scheduling_call_ids: Vec<NodeId>,
}

#[derive(Debug, Default)]
struct CleanupGuardMutations {
    boolean_values: FxHashMap<String, bool>,
    changed_from_snapshot_keys: FxHashSet<String>,
}

declare_oxc_lint!(
    /// Require effect-owned self-rescheduling animation frame loops to stop on cleanup.
    EffectRafLoopNeedsCancel,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require requestAnimationFrame loops to stop during effect cleanup.",
);

impl Rule for EffectRafLoopNeedsCancel {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for effect_node in ctx.nodes().iter() {
            let AstKind::CallExpression(effect_call) = effect_node.kind() else {
                continue;
            };
            if !is_react_hook_call(effect_call, &EFFECT_HOOK_NAMES, ctx) {
                continue;
            }
            let Some(callback_expression) = effect_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) =
                exact_local_callback_function_id(callback_expression, ctx, &mut Vec::new())
            else {
                continue;
            };
            let cleanup_function_ids = collect_raf_cleanup_function_ids(callback_id, ctx);
            for raf_loop in find_effect_raf_loops(callback_expression, ctx) {
                if every_raf_reschedule_is_progress_bounded(&raf_loop, ctx) {
                    continue;
                }
                if let Some(handle_key) = cancellable_raf_handle_key(&raf_loop, callback_id, ctx)
                    && cleanup_function_ids
                        .iter()
                        .any(|cleanup_id| cleanup_cancels_raf_handle(*cleanup_id, &handle_key, ctx))
                {
                    continue;
                }
                if cleanup_function_ids.iter().any(|cleanup_id| {
                    let mutations =
                        collect_raf_cleanup_guard_mutations(*cleanup_id, callback_id, ctx);
                    cleanup_guards_every_raf_reschedule(&raf_loop, &mutations, ctx)
                }) {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(MESSAGE)
                        .with_label(ctx.nodes().get_node(raf_loop.initial_call_id).span()),
                );
            }
        }
    }
}

fn find_effect_raf_loops<'a>(
    callback_expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Vec<RafLoop> {
    let mut loops = Vec::new();
    let mut seen_calls = FxHashSet::default();
    let Some(callback_id) =
        exact_local_callback_function_id(callback_expression, ctx, &mut Vec::new())
    else {
        return loops;
    };
    for_each_effect_raf_execution_node(callback_id, ctx, |candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return;
        };
        if !is_global_frame_call(call, "requestAnimationFrame", ctx) {
            return;
        }
        let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
            return;
        };
        let Some(scheduled_function_id) =
            exact_local_callback_function_id(argument, ctx, &mut Vec::new())
        else {
            return;
        };
        let scheduling_call_ids = collect_self_scheduling_raf_calls(scheduled_function_id, ctx);
        if scheduling_call_ids.len() > 1 && seen_calls.insert(candidate.id()) {
            let mut all_calls = vec![candidate.id()];
            all_calls.extend(scheduling_call_ids.into_iter().skip(1));
            loops.push(RafLoop {
                initial_call_id: candidate.id(),
                scheduled_function_id,
                scheduling_call_ids: all_calls,
            });
        }
    });
    loops
}

fn collect_self_scheduling_raf_calls(
    scheduled_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Vec<NodeId> {
    let mut calls = vec![scheduled_function_id];
    for_each_raf_execution_node(scheduled_function_id, ctx, |candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return;
        };
        if !is_global_frame_call(call, "requestAnimationFrame", ctx) {
            return;
        }
        let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
            return;
        };
        if exact_local_callback_function_id(argument, ctx, &mut Vec::new())
            == Some(scheduled_function_id)
        {
            calls.push(candidate.id());
        }
    });
    calls
}

fn for_each_raf_execution_node<'a>(
    root_function_id: NodeId,
    ctx: &LintContext<'a>,
    visitor: impl FnMut(&AstNode<'a>),
) {
    for_each_raf_execution_node_internal(root_function_id, None, ctx, visitor);
}

fn for_each_effect_raf_execution_node<'a>(
    root_function_id: NodeId,
    ctx: &LintContext<'a>,
    visitor: impl FnMut(&AstNode<'a>),
) {
    for_each_raf_execution_node_internal(root_function_id, Some(root_function_id), ctx, visitor);
}

fn for_each_raf_execution_node_internal<'a>(
    root_function_id: NodeId,
    local_helper_scope_id: Option<NodeId>,
    ctx: &LintContext<'a>,
    mut visitor: impl FnMut(&AstNode<'a>),
) {
    let local_helper_scope_span =
        local_helper_scope_id.map(|function_id| ctx.nodes().get_node(function_id).span());
    let mut pending_function_ids = vec![root_function_id];
    let mut visited_function_ids = FxHashSet::default();
    while let Some(function_id) = pending_function_ids.pop() {
        if !visited_function_ids.insert(function_id) {
            continue;
        }
        for candidate in ctx.nodes().iter() {
            if local_callback_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
                continue;
            }
            visitor(candidate);
            let AstKind::CallExpression(call) = candidate.kind() else {
                continue;
            };
            if let Some(called_id) =
                exact_local_callback_function_id(&call.callee, ctx, &mut Vec::new())
                && local_helper_scope_span.is_none_or(|scope_span| {
                    scope_span.contains_inclusive(ctx.nodes().get_node(called_id).span())
                })
            {
                pending_function_ids.push(called_id);
            }
            let Some(member) = call.callee.as_member_expression() else {
                continue;
            };
            if !is_synchronous_iterator_method(member.static_property_name()) {
                continue;
            }
            for argument in &call.arguments {
                let Some(callback) = argument.as_expression() else {
                    continue;
                };
                if let Some(callback_id) =
                    exact_local_callback_function_id(callback, ctx, &mut Vec::new())
                    && local_helper_scope_span.is_none_or(|scope_span| {
                        scope_span.contains_inclusive(ctx.nodes().get_node(callback_id).span())
                    })
                {
                    pending_function_ids.push(callback_id);
                }
            }
        }
    }
}

fn is_synchronous_iterator_method(name: Option<&str>) -> bool {
    matches!(
        name,
        Some(
            "every"
                | "filter"
                | "find"
                | "findIndex"
                | "findLast"
                | "findLastIndex"
                | "flatMap"
                | "forEach"
                | "map"
                | "reduce"
                | "reduceRight"
                | "some"
                | "sort"
        )
    )
}

fn is_global_frame_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    method_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            identifier.name == method_name
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            if member.static_property_name() != Some(method_name) {
                return false;
            }
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return false;
            };
            matches!(receiver.name.as_str(), "window" | "globalThis" | "self")
                && ctx
                    .scoping()
                    .get_reference(receiver.reference_id())
                    .symbol_id()
                    .is_none()
        }
    }
}

fn collect_raf_cleanup_function_ids(callback_id: NodeId, ctx: &LintContext<'_>) -> Vec<NodeId> {
    let mut cleanup_ids = Vec::new();
    let callback_node = ctx.nodes().get_node(callback_id);
    if let AstKind::ArrowFunctionExpression(function) = callback_node.kind()
        && let Some(expression) = function.get_expression()
    {
        resolve_raf_cleanup_expression(expression, ctx, &mut cleanup_ids);
    }
    for candidate in ctx.nodes().iter() {
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(callback_id) {
            continue;
        }
        let AstKind::ReturnStatement(statement) = candidate.kind() else {
            continue;
        };
        if let Some(argument) = &statement.argument {
            resolve_raf_cleanup_expression(argument, ctx, &mut cleanup_ids);
        }
    }
    cleanup_ids.sort_by_key(|id| ctx.nodes().get_node(*id).span().start);
    cleanup_ids.dedup();
    cleanup_ids
}

fn resolve_raf_cleanup_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    cleanup_ids: &mut Vec<NodeId>,
) {
    match expression.get_inner_expression() {
        Expression::ConditionalExpression(conditional) => {
            resolve_raf_cleanup_expression(&conditional.consequent, ctx, cleanup_ids);
            resolve_raf_cleanup_expression(&conditional.alternate, ctx, cleanup_ids);
        }
        Expression::SequenceExpression(sequence) => {
            if let Some(last) = sequence.expressions.last() {
                resolve_raf_cleanup_expression(last, ctx, cleanup_ids);
            }
        }
        expression => {
            if let Some(function_id) =
                exact_local_callback_function_id(expression, ctx, &mut Vec::new())
            {
                cleanup_ids.push(function_id);
            }
        }
    }
}

fn serialize_raf_handle_key(expression: &Expression<'_>, ctx: &LintContext<'_>) -> Option<String> {
    serialize_raf_handle_key_internal(expression, ctx, &mut FxHashSet::default())
}

fn serialize_raf_handle_key_internal(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            let binding_key = symbol.map_or_else(
                || identifier.name.to_string(),
                |symbol_id| format!("{}#{}", identifier.name, symbol_id.index()),
            );
            let Some(symbol_id) = symbol else {
                return Some(binding_key);
            };
            if !visited_symbols.insert(symbol_id) {
                return Some(binding_key);
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return Some(binding_key);
            };
            let Some(initializer) = &declarator.init else {
                return Some(binding_key);
            };
            serialize_raf_handle_key_internal(initializer, ctx, visited_symbols)
                .filter(|initializer_key| initializer_key != &binding_key)
                .or(Some(binding_key))
        }
        expression => {
            let member = expression.as_member_expression()?;
            let receiver =
                serialize_raf_handle_key_internal(member.object(), ctx, visited_symbols)?;
            Some(format!("{receiver}.{}", member.static_property_name()?))
        }
    }
}

fn stored_raf_handle_key(call_id: NodeId, ctx: &LintContext<'_>) -> Option<String> {
    let root = transparent_expression_root(ctx.nodes().get_node(call_id), ctx);
    let parent = ctx.nodes().parent_node(root.id());
    match parent.kind() {
        AstKind::AssignmentExpression(assignment) if assignment.right.span() == root.span() => {
            serialize_raf_assignment_target_key(&assignment.left, ctx)
        }
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == root.span()) =>
        {
            declarator
                .id
                .get_binding_identifier()
                .map(|binding| format!("{}#{}", binding.name, binding.symbol_id().index()))
        }
        AstKind::CallExpression(storage_call) => {
            let member = storage_call.callee.as_member_expression()?;
            let argument_index = storage_call
                .arguments
                .iter()
                .position(|argument| argument.span() == root.span())?;
            let method = member.static_property_name()?;
            if !((method == "set" && argument_index > 0) || (matches!(method, "push" | "unshift")))
            {
                return None;
            }
            serialize_raf_handle_key(member.object(), ctx)
                .map(|key| format!("{COLLECTION_VALUES_PREFIX}{key}"))
        }
        _ => None,
    }
}

fn serialize_raf_assignment_target_key(
    target: &oxc_ast::ast::AssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let target = target.as_simple_assignment_target()?;
    match target {
        oxc_ast::ast::SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) => {
            let symbol = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            Some(symbol.map_or_else(
                || identifier.name.to_string(),
                |symbol_id| format!("{}#{}", identifier.name, symbol_id.index()),
            ))
        }
        target => target
            .as_member_expression()
            .and_then(|member| serialize_raf_member_key(member, ctx)),
    }
}

fn serialize_raf_member_key(
    member: &MemberExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let receiver = serialize_raf_handle_key(member.object(), ctx)?;
    Some(format!("{receiver}.{}", member.static_property_name()?))
}

fn cancellable_raf_handle_key(
    raf_loop: &RafLoop,
    effect_callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let keys = raf_loop
        .scheduling_call_ids
        .iter()
        .map(|call_id| stored_raf_handle_key(*call_id, ctx))
        .collect::<Vec<_>>();
    let first = keys.first()?.as_ref()?.clone();
    if keys.iter().any(|key| key.as_ref() != Some(&first)) {
        return None;
    }
    if first.starts_with(COLLECTION_VALUES_PREFIX) {
        return Some(first);
    }
    let scheduling_write_ids = raf_loop
        .scheduling_call_ids
        .iter()
        .filter_map(|id| {
            let root = transparent_expression_root(ctx.nodes().get_node(*id), ctx);
            let parent = ctx.nodes().parent_node(root.id());
            matches!(parent.kind(), AstKind::AssignmentExpression(assignment)
                if assignment.right.span() == root.span())
            .then_some(parent.id())
        })
        .collect::<FxHashSet<_>>();
    for candidate in ctx.nodes().iter() {
        if !matches!(
            local_callback_nearest_function_id(candidate.id(), ctx),
            Some(owner) if owner == effect_callback_id || owner == raf_loop.scheduled_function_id
        ) {
            continue;
        }
        let write = match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                serialize_raf_assignment_target_key(&assignment.left, ctx)
            }
            AstKind::UpdateExpression(update) => {
                serialize_raf_update_target_key(&update.argument, ctx)
            }
            _ => None,
        };
        if write.as_deref() != Some(first.as_str()) {
            continue;
        }
        if scheduling_write_ids.contains(&candidate.id()) {
            continue;
        }
        if raf_loop
            .scheduling_call_ids
            .iter()
            .any(|id| ctx.nodes().get_node(*id).span().start < candidate.span().start)
        {
            return None;
        }
    }
    Some(first)
}

fn serialize_raf_update_target_key(
    target: &oxc_ast::ast::SimpleAssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match target {
        oxc_ast::ast::SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) => {
            let symbol = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            Some(symbol.map_or_else(
                || identifier.name.to_string(),
                |symbol_id| format!("{}#{}", identifier.name, symbol_id.index()),
            ))
        }
        target => target
            .as_member_expression()
            .and_then(|member| serialize_raf_member_key(member, ctx)),
    }
}

fn cleanup_cancels_raf_handle(
    cleanup_function_id: NodeId,
    handle_key: &str,
    ctx: &LintContext<'_>,
) -> bool {
    if let Some(collection_key) = handle_key.strip_prefix(COLLECTION_VALUES_PREFIX) {
        return cleanup_cancels_raf_collection(cleanup_function_id, collection_key, ctx);
    }
    let mut did_cancel = false;
    for_each_raf_execution_node(cleanup_function_id, ctx, |candidate| {
        if did_cancel {
            return;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            return;
        };
        if !is_cancel_animation_frame_call(call, ctx) {
            return;
        }
        did_cancel = call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(|argument| serialize_raf_handle_key(argument, ctx))
            .as_deref()
            == Some(handle_key);
    });
    did_cancel
}

fn cleanup_cancels_raf_collection(
    cleanup_function_id: NodeId,
    collection_key: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let mut did_cancel = false;
    for_each_raf_execution_node(cleanup_function_id, ctx, |candidate| {
        if did_cancel {
            return;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            return;
        };
        let Some(member) = call.callee.as_member_expression() else {
            return;
        };
        if member.static_property_name() != Some("forEach")
            || serialize_raf_handle_key(member.object(), ctx).as_deref() != Some(collection_key)
        {
            return;
        }
        let Some(callback) = call.arguments.first().and_then(Argument::as_expression) else {
            return;
        };
        let Some(callback_id) = exact_local_callback_function_id(callback, ctx, &mut Vec::new())
        else {
            return;
        };
        let Some(parameter_symbol) = first_function_parameter_symbol(callback_id, ctx) else {
            return;
        };
        for_each_raf_execution_node(callback_id, ctx, |callback_candidate| {
            let AstKind::CallExpression(cancel_call) = callback_candidate.kind() else {
                return;
            };
            if !is_cancel_animation_frame_call(cancel_call, ctx) {
                return;
            }
            did_cancel = cancel_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .and_then(|argument| match argument.get_inner_expression() {
                    Expression::Identifier(identifier) => ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id(),
                    _ => None,
                })
                == Some(parameter_symbol);
        });
    });
    did_cancel
}

fn first_function_parameter_symbol(function_id: NodeId, ctx: &LintContext<'_>) -> Option<SymbolId> {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function
            .params
            .items
            .first()?
            .pattern
            .get_binding_identifier()
            .map(|binding| binding.symbol_id()),
        AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .first()?
            .pattern
            .get_binding_identifier()
            .map(|binding| binding.symbol_id()),
        _ => None,
    }
}

fn is_cancel_animation_frame_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if is_global_frame_call(call, "cancelAnimationFrame", ctx) {
        return true;
    }
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    binding_property_name_for_symbol(&declarator.id, symbol_id).as_deref()
        == Some("cancelAnimationFrame")
        && declarator.init.as_ref().is_some_and(|initializer| {
            matches!(initializer.get_inner_expression(), Expression::Identifier(receiver)
                if matches!(receiver.name.as_str(), "window" | "globalThis" | "self")
                    && ctx.scoping().get_reference(receiver.reference_id()).symbol_id().is_none())
        })
}

fn collect_raf_cleanup_guard_mutations(
    cleanup_function_id: NodeId,
    effect_callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> CleanupGuardMutations {
    let mut mutations = CleanupGuardMutations::default();
    let mut invoked_member_keys = FxHashSet::default();
    for_each_raf_execution_node(cleanup_function_id, ctx, |candidate| {
        let execution_function_id =
            local_callback_nearest_function_id(candidate.id(), ctx).unwrap_or(cleanup_function_id);
        if !raf_cleanup_node_is_unconditional(candidate, execution_function_id, ctx) {
            return;
        }
        match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                let Some(key) = serialize_raf_assignment_target_key(&assignment.left, ctx) else {
                    return;
                };
                if assignment.operator != AssignmentOperator::Assign {
                    mutations.boolean_values.remove(&key);
                    mutations.changed_from_snapshot_keys.insert(key);
                    return;
                }
                match assignment.right.get_inner_expression() {
                    Expression::BooleanLiteral(value) => {
                        mutations.changed_from_snapshot_keys.remove(&key);
                        mutations.boolean_values.insert(key, value.value);
                    }
                    _ => {
                        mutations.boolean_values.remove(&key);
                        mutations.changed_from_snapshot_keys.remove(&key);
                    }
                }
            }
            AstKind::UpdateExpression(update) => {
                if let Some(key) = serialize_raf_update_target_key(&update.argument, ctx) {
                    mutations.boolean_values.remove(&key);
                    mutations.changed_from_snapshot_keys.insert(key);
                }
            }
            AstKind::CallExpression(call) => {
                let Some(member) = call.callee.as_member_expression() else {
                    return;
                };
                if member.static_property_name() == Some("abort")
                    && let Some(receiver) = serialize_raf_handle_key(member.object(), ctx)
                {
                    mutations
                        .boolean_values
                        .insert(format!("{receiver}.signal.aborted"), true);
                }
                if let Some(member_key) = serialize_raf_member_key(member, ctx) {
                    invoked_member_keys.insert(member_key);
                }
            }
            _ => {}
        }
    });
    let effect_callback_span = ctx.nodes().get_node(effect_callback_id).span();
    for candidate in ctx.nodes().iter() {
        if !effect_callback_span.contains_inclusive(candidate.span()) {
            continue;
        }
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            continue;
        };
        let Some(member) = assignment
            .left
            .as_simple_assignment_target()
            .and_then(|target| target.as_member_expression())
        else {
            continue;
        };
        let Some(member_key) = serialize_raf_member_key(member, ctx) else {
            continue;
        };
        if !invoked_member_keys.contains(&member_key) {
            continue;
        }
        let Some(function_id) =
            exact_local_callback_function_id(&assignment.right, ctx, &mut Vec::new())
        else {
            continue;
        };
        for_each_raf_execution_node(function_id, ctx, |function_candidate| {
            let execution_function_id =
                local_callback_nearest_function_id(function_candidate.id(), ctx)
                    .unwrap_or(function_id);
            if !raf_cleanup_node_is_unconditional(function_candidate, execution_function_id, ctx) {
                return;
            }
            match function_candidate.kind() {
                AstKind::AssignmentExpression(function_assignment) => {
                    let Some(key) =
                        serialize_raf_assignment_target_key(&function_assignment.left, ctx)
                    else {
                        return;
                    };
                    if function_assignment.operator != AssignmentOperator::Assign {
                        mutations.boolean_values.remove(&key);
                        mutations.changed_from_snapshot_keys.insert(key);
                    } else if let Expression::BooleanLiteral(value) =
                        function_assignment.right.get_inner_expression()
                    {
                        mutations.changed_from_snapshot_keys.remove(&key);
                        mutations.boolean_values.insert(key, value.value);
                    }
                }
                AstKind::UpdateExpression(update) => {
                    if let Some(key) = serialize_raf_update_target_key(&update.argument, ctx) {
                        mutations.boolean_values.remove(&key);
                        mutations.changed_from_snapshot_keys.insert(key);
                    }
                }
                _ => {}
            }
        });
    }
    mutations
}

fn raf_cleanup_node_is_unconditional(
    node: &AstNode<'_>,
    cleanup_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == cleanup_function_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::IfStatement(_)
                | AstKind::ConditionalExpression(_)
                | AstKind::LogicalExpression(_)
                | AstKind::SwitchStatement(_)
                | AstKind::TryStatement(_)
                | AstKind::ForStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
        ) {
            return false;
        }
    }
    false
}

fn cleanup_guards_every_raf_reschedule(
    raf_loop: &RafLoop,
    mutations: &CleanupGuardMutations,
    ctx: &LintContext<'_>,
) -> bool {
    let recursive_calls = &raf_loop.scheduling_call_ids[1..];
    !recursive_calls.is_empty()
        && recursive_calls.iter().all(|call_id| {
            raf_call_has_dominating_cleanup_guard(
                *call_id,
                raf_loop.scheduled_function_id,
                mutations,
                ctx,
            )
        })
}

fn raf_call_has_dominating_cleanup_guard(
    call_id: NodeId,
    scheduled_function_id: NodeId,
    mutations: &CleanupGuardMutations,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child = ctx.nodes().get_node(call_id);
    for parent in ctx.nodes().ancestors(call_id) {
        if parent.id() == scheduled_function_id {
            return false;
        }
        match parent.kind() {
            AstKind::IfStatement(statement) => {
                let branch_value = statement.consequent.span().contains_inclusive(child.span());
                if (branch_value
                    || statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| alternate.span().contains_inclusive(child.span())))
                    && cleanup_blocks_raf_branch(&statement.test, branch_value, mutations, ctx)
                {
                    return true;
                }
            }
            AstKind::ConditionalExpression(expression) => {
                let branch_value = expression
                    .consequent
                    .span()
                    .contains_inclusive(child.span());
                if cleanup_blocks_raf_branch(&expression.test, branch_value, mutations, ctx) {
                    return true;
                }
            }
            AstKind::LogicalExpression(expression)
                if expression.right.span().contains_inclusive(child.span()) =>
            {
                let cleanup_value = evaluate_raf_cleanup_truth(&expression.left, mutations, ctx);
                let blocked = match expression.operator {
                    LogicalOperator::And => cleanup_value == Some(false),
                    LogicalOperator::Or => cleanup_value == Some(true),
                    LogicalOperator::Coalesce => cleanup_value.is_some(),
                };
                if blocked {
                    return true;
                }
            }
            AstKind::BlockStatement(block) => {
                let Some(statement_index) = block
                    .body
                    .iter()
                    .position(|statement| statement.span().contains_inclusive(child.span()))
                else {
                    child = parent;
                    continue;
                };
                for previous in block.body.iter().take(statement_index) {
                    let oxc_ast::ast::Statement::IfStatement(previous_if) = previous else {
                        continue;
                    };
                    if raf_statement_always_exits(&previous_if.consequent)
                        && cleanup_blocks_raf_branch(&previous_if.test, false, mutations, ctx)
                    {
                        return true;
                    }
                    if previous_if
                        .alternate
                        .as_ref()
                        .is_some_and(raf_statement_always_exits)
                        && cleanup_blocks_raf_branch(&previous_if.test, true, mutations, ctx)
                    {
                        return true;
                    }
                }
            }
            _ => {}
        }
        child = parent;
    }
    false
}

fn raf_statement_always_exits(statement: &oxc_ast::ast::Statement<'_>) -> bool {
    match statement {
        oxc_ast::ast::Statement::ReturnStatement(_)
        | oxc_ast::ast::Statement::ThrowStatement(_) => true,
        oxc_ast::ast::Statement::BlockStatement(block) => {
            block.body.iter().any(raf_statement_always_exits)
        }
        oxc_ast::ast::Statement::IfStatement(statement) => {
            raf_statement_always_exits(&statement.consequent)
                && statement
                    .alternate
                    .as_ref()
                    .is_some_and(raf_statement_always_exits)
        }
        _ => false,
    }
}

fn cleanup_blocks_raf_branch(
    test: &Expression<'_>,
    branch_value: bool,
    mutations: &CleanupGuardMutations,
    ctx: &LintContext<'_>,
) -> bool {
    evaluate_raf_cleanup_truth(test, mutations, ctx)
        .is_some_and(|cleanup_value| cleanup_value != branch_value)
}

fn evaluate_raf_cleanup_truth(
    expression: &Expression<'_>,
    mutations: &CleanupGuardMutations,
    ctx: &LintContext<'_>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::Identifier(_) => serialize_raf_handle_key(expression, ctx)
            .and_then(|key| mutations.boolean_values.get(&key).copied()),
        expression if expression.as_member_expression().is_some() => {
            serialize_raf_handle_key(expression, ctx)
                .and_then(|key| mutations.boolean_values.get(&key).copied())
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            evaluate_raf_cleanup_truth(&unary.argument, mutations, ctx).map(|value| !value)
        }
        Expression::LogicalExpression(logical) => {
            let left = evaluate_raf_cleanup_truth(&logical.left, mutations, ctx);
            let right = evaluate_raf_cleanup_truth(&logical.right, mutations, ctx);
            match logical.operator {
                LogicalOperator::And if left == Some(false) || right == Some(false) => Some(false),
                LogicalOperator::And if left == Some(true) => right,
                LogicalOperator::Or if left == Some(true) || right == Some(true) => Some(true),
                LogicalOperator::Or if left == Some(false) => right,
                LogicalOperator::Coalesce => left,
                _ => None,
            }
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Equality
                    | BinaryOperator::StrictEquality
                    | BinaryOperator::Inequality
                    | BinaryOperator::StrictInequality
            ) =>
        {
            let left = evaluate_raf_cleanup_truth(&binary.left, mutations, ctx);
            let right = evaluate_raf_cleanup_truth(&binary.right, mutations, ctx);
            if let (Some(left), Some(right)) = (left, right) {
                return Some(match binary.operator {
                    BinaryOperator::Equality | BinaryOperator::StrictEquality => left == right,
                    _ => left != right,
                });
            }
            let left_key = serialize_raf_handle_key(&binary.left, ctx);
            let right_key = serialize_raf_handle_key(&binary.right, ctx);
            if left_key.is_some()
                && left_key == right_key
                && mutations
                    .changed_from_snapshot_keys
                    .contains(left_key.as_ref()?)
            {
                return Some(matches!(
                    binary.operator,
                    BinaryOperator::Inequality | BinaryOperator::StrictInequality
                ));
            }
            None
        }
        _ => None,
    }
}

fn every_raf_reschedule_is_progress_bounded(raf_loop: &RafLoop, ctx: &LintContext<'_>) -> bool {
    let mut written_keys = FxHashSet::default();
    let mut increasing_keys = FxHashSet::default();
    let mut decreasing_keys = FxHashSet::default();
    collect_raf_progress_keys(
        raf_loop.scheduled_function_id,
        &mut written_keys,
        &mut increasing_keys,
        &mut decreasing_keys,
        ctx,
    );
    for parameter_symbol in function_parameter_symbols(raf_loop.scheduled_function_id, ctx) {
        let key = format!("#{}", parameter_symbol.index());
        if !written_keys.iter().any(|written| written.ends_with(&key)) {
            increasing_keys.insert(key);
        }
    }
    let mut did_grow = true;
    while did_grow {
        did_grow = false;
        for candidate in ctx.nodes().iter() {
            if local_callback_nearest_function_id(candidate.id(), ctx)
                != Some(raf_loop.scheduled_function_id)
            {
                continue;
            }
            let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
                continue;
            };
            let Some(binding) = declarator.id.get_binding_identifier() else {
                continue;
            };
            let Some(initializer) = &declarator.init else {
                continue;
            };
            let key = format!("{}#{}", binding.name, binding.symbol_id().index());
            if written_keys.contains(&key)
                || increasing_keys.contains(&key)
                || decreasing_keys.contains(&key)
            {
                continue;
            }
            if raf_expression_is_monotonic(initializer, &increasing_keys, &written_keys, ctx) {
                increasing_keys.insert(key);
                did_grow = true;
            } else if raf_expression_is_monotonic(initializer, &decreasing_keys, &written_keys, ctx)
            {
                decreasing_keys.insert(key);
                did_grow = true;
            }
        }
    }
    if increasing_keys.is_empty() && decreasing_keys.is_empty() {
        return false;
    }
    raf_loop.scheduling_call_ids[1..].iter().all(|call_id| {
        raf_call_has_progress_bound(
            *call_id,
            raf_loop.scheduled_function_id,
            &increasing_keys,
            &decreasing_keys,
            &written_keys,
            ctx,
        )
    })
}

fn collect_raf_progress_keys(
    function_id: NodeId,
    written_keys: &mut FxHashSet<String>,
    increasing_keys: &mut FxHashSet<String>,
    decreasing_keys: &mut FxHashSet<String>,
    ctx: &LintContext<'_>,
) {
    let mut non_increasing_keys = FxHashSet::default();
    let mut non_decreasing_keys = FxHashSet::default();
    for_each_raf_execution_node(function_id, ctx, |candidate| match candidate.kind() {
        AstKind::UpdateExpression(update) => {
            let Some(key) = serialize_raf_update_target_key(&update.argument, ctx) else {
                return;
            };
            written_keys.insert(key.clone());
            if !matches!(
                &update.argument,
                oxc_ast::ast::SimpleAssignmentTarget::AssignmentTargetIdentifier(_)
            ) {
                return;
            }
            match update.operator {
                UpdateOperator::Increment => {
                    increasing_keys.insert(key.clone());
                    non_decreasing_keys.insert(key);
                }
                UpdateOperator::Decrement => {
                    decreasing_keys.insert(key.clone());
                    non_increasing_keys.insert(key);
                }
            }
        }
        AstKind::AssignmentExpression(assignment) => {
            let Some(key) = serialize_raf_assignment_target_key(&assignment.left, ctx) else {
                return;
            };
            written_keys.insert(key.clone());
            if !matches!(
                assignment.left.as_simple_assignment_target(),
                Some(oxc_ast::ast::SimpleAssignmentTarget::AssignmentTargetIdentifier(_))
            ) {
                return;
            }
            let is_positive = matches!(assignment.right.get_inner_expression(), Expression::NumericLiteral(value) if value.value > 0.0);
            let (is_increasing, is_decreasing) = match assignment.operator {
                AssignmentOperator::Addition if is_positive => (true, false),
                AssignmentOperator::Subtraction if is_positive => (false, true),
                AssignmentOperator::Assign => {
                    if let Expression::BinaryExpression(binary) =
                        assignment.right.get_inner_expression()
                    {
                        let left_matches = serialize_raf_handle_key(&binary.left, ctx).as_deref()
                            == Some(key.as_str());
                        let has_positive_offset = matches!(
                            binary.right.get_inner_expression(),
                            Expression::NumericLiteral(value) if value.value > 0.0
                        );
                        if left_matches && has_positive_offset {
                            (
                                binary.operator == BinaryOperator::Addition,
                                binary.operator == BinaryOperator::Subtraction,
                            )
                        } else {
                            (false, false)
                        }
                    } else {
                        (false, false)
                    }
                }
                _ => (false, false),
            };
            if is_increasing {
                increasing_keys.insert(key.clone());
            } else {
                non_increasing_keys.insert(key.clone());
            }
            if is_decreasing {
                decreasing_keys.insert(key.clone());
            } else {
                non_decreasing_keys.insert(key);
            }
        }
        _ => {}
    });
    increasing_keys.retain(|key| !non_increasing_keys.contains(key));
    decreasing_keys.retain(|key| !non_decreasing_keys.contains(key));
}

fn function_parameter_symbols(function_id: NodeId, ctx: &LintContext<'_>) -> Vec<SymbolId> {
    let parameters = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => &function.params.items,
        AstKind::ArrowFunctionExpression(function) => &function.params.items,
        _ => return Vec::new(),
    };
    parameters
        .iter()
        .filter_map(|parameter| parameter.pattern.get_binding_identifier())
        .map(|binding| binding.symbol_id())
        .collect()
}

fn raf_call_has_progress_bound(
    call_id: NodeId,
    scheduled_function_id: NodeId,
    increasing_keys: &FxHashSet<String>,
    decreasing_keys: &FxHashSet<String>,
    written_keys: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child_span = ctx.nodes().get_node(call_id).span();
    for ancestor in ctx.nodes().ancestors(call_id) {
        if ancestor.id() == scheduled_function_id {
            break;
        }
        let (test, expected) = match ancestor.kind() {
            AstKind::IfStatement(statement) => {
                let in_consequent = statement.consequent.span().contains_inclusive(child_span);
                let in_alternate = statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(child_span));
                if !in_consequent && !in_alternate {
                    child_span = ancestor.span();
                    continue;
                }
                (&statement.test, in_consequent)
            }
            AstKind::ConditionalExpression(expression) => {
                let in_consequent = expression.consequent.span().contains_inclusive(child_span);
                (&expression.test, in_consequent)
            }
            _ => {
                child_span = ancestor.span();
                continue;
            }
        };
        if is_raf_numeric_bound_test(
            test,
            expected,
            increasing_keys,
            decreasing_keys,
            written_keys,
            ctx,
        ) {
            return true;
        }
        child_span = ancestor.span();
    }
    false
}

fn is_raf_numeric_bound_test(
    expression: &Expression<'_>,
    expected: bool,
    increasing_keys: &FxHashSet<String>,
    decreasing_keys: &FxHashSet<String>,
    written_keys: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            is_raf_numeric_bound_test(
                &unary.argument,
                !expected,
                increasing_keys,
                decreasing_keys,
                written_keys,
                ctx,
            )
        }
        Expression::LogicalExpression(logical) if logical.operator != LogicalOperator::Coalesce => {
            is_raf_numeric_bound_test(
                &logical.left,
                expected,
                increasing_keys,
                decreasing_keys,
                written_keys,
                ctx,
            ) && is_raf_numeric_bound_test(
                &logical.right,
                expected,
                increasing_keys,
                decreasing_keys,
                written_keys,
                ctx,
            )
        }
        Expression::BinaryExpression(binary) => {
            let left_increasing =
                raf_expression_is_monotonic(&binary.left, increasing_keys, written_keys, ctx)
                    && is_numeric_literal(&binary.right);
            let right_increasing = is_numeric_literal(&binary.left)
                && raf_expression_is_monotonic(&binary.right, increasing_keys, written_keys, ctx);
            let increasing_bound = match binary.operator {
                BinaryOperator::LessThan | BinaryOperator::LessEqualThan => left_increasing,
                BinaryOperator::GreaterThan | BinaryOperator::GreaterEqualThan => right_increasing,
                _ => false,
            };
            let increasing_inverse = match binary.operator {
                BinaryOperator::GreaterThan | BinaryOperator::GreaterEqualThan => left_increasing,
                BinaryOperator::LessThan | BinaryOperator::LessEqualThan => right_increasing,
                _ => false,
            };
            if if expected {
                increasing_bound
            } else {
                increasing_inverse
            } {
                return true;
            }
            let left_decreasing =
                raf_expression_is_monotonic(&binary.left, decreasing_keys, written_keys, ctx)
                    && is_numeric_literal(&binary.right);
            let right_decreasing = is_numeric_literal(&binary.left)
                && raf_expression_is_monotonic(&binary.right, decreasing_keys, written_keys, ctx);
            let decreasing_bound = match binary.operator {
                BinaryOperator::GreaterThan | BinaryOperator::GreaterEqualThan => left_decreasing,
                BinaryOperator::LessThan | BinaryOperator::LessEqualThan => right_decreasing,
                _ => false,
            };
            let decreasing_inverse = match binary.operator {
                BinaryOperator::LessThan | BinaryOperator::LessEqualThan => left_decreasing,
                BinaryOperator::GreaterThan | BinaryOperator::GreaterEqualThan => right_decreasing,
                _ => false,
            };
            if expected {
                decreasing_bound
            } else {
                decreasing_inverse
            }
        }
        _ => false,
    }
}

fn raf_expression_is_monotonic(
    expression: &Expression<'_>,
    monotonic_keys: &FxHashSet<String>,
    written_keys: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let key = serialize_raf_handle_key(expression, ctx);
            key.as_ref().is_some_and(|key| {
                monotonic_keys.contains(key)
                    || ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_some_and(|symbol| {
                            monotonic_keys.contains(&format!("#{}", symbol.index()))
                        })
            })
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Addition | BinaryOperator::Subtraction
            ) =>
        {
            raf_expression_is_monotonic(&binary.left, monotonic_keys, written_keys, ctx)
                && raf_numeric_offset_is_stable(&binary.right, written_keys, ctx)
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Multiplication | BinaryOperator::Division
            ) =>
        {
            raf_expression_is_monotonic(&binary.left, monotonic_keys, written_keys, ctx)
                && matches!(binary.right.get_inner_expression(), Expression::NumericLiteral(value) if value.value > 0.0)
        }
        Expression::CallExpression(call) => {
            let Some(member) = call.callee.as_member_expression() else {
                return false;
            };
            let Expression::Identifier(math) = member.object().get_inner_expression() else {
                return false;
            };
            if math.name != "Math"
                || ctx
                    .scoping()
                    .get_reference(math.reference_id())
                    .symbol_id()
                    .is_some()
                || !matches!(member.static_property_name(), Some("min" | "max"))
            {
                return false;
            }
            let mut found_progress = false;
            for argument in &call.arguments {
                let Some(argument) = argument.as_expression() else {
                    return false;
                };
                if raf_expression_is_monotonic(argument, monotonic_keys, written_keys, ctx) {
                    found_progress = true;
                } else if !is_numeric_literal(argument) {
                    return false;
                }
            }
            found_progress
        }
        _ => false,
    }
}

fn raf_numeric_offset_is_stable(
    expression: &Expression<'_>,
    written_keys: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    is_numeric_literal(expression)
        || matches!(expression.get_inner_expression(), Expression::Identifier(_))
            && serialize_raf_handle_key(expression, ctx)
                .is_some_and(|key| !written_keys.contains(&key))
}

fn is_numeric_literal(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::NumericLiteral(_)
    )
}
