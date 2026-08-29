use oxc_ast::{
    AstKind,
    ast::{Argument, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{AstNode, context::LintContext, rule::Rule};

const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const OBSERVER_CONSTRUCTOR_NAMES: [&str; 4] = [
    "IntersectionObserver",
    "MutationObserver",
    "ResizeObserver",
    "PerformanceObserver",
];
const SYNCHRONOUS_ITERATOR_METHOD_NAMES: [&str; 11] = [
    "every",
    "filter",
    "find",
    "findIndex",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
    "sort",
];
const COLLECTION_MUTATION_METHOD_NAMES: [&str; 9] = [
    "clear", "delete", "pop", "push", "set", "shift", "sort", "splice", "unshift",
];
const MESSAGE: &str = "This observer is created and started in the effect but never disconnected, so it keeps firing against detached nodes and leaks one observer per mount; return a cleanup that calls `disconnect()` or `unobserve()`.";

#[derive(Debug, Default, Clone)]
pub struct EffectObserverNeedsDisconnect;

#[derive(Debug)]
struct TrackedObserver {
    construction_id: NodeId,
    binding_symbols: FxHashSet<SymbolId>,
    did_observe: bool,
    did_observe_unknown_target: bool,
    did_release_all: bool,
    did_release_via_callback_parameter: bool,
    callback_released_target_keys: FxHashSet<String>,
    observed_iteration_target_keys: FxHashSet<String>,
    observed_target_keys: FxHashSet<String>,
}

declare_oxc_lint!(
    /// Require DOM observers started in an effect to release their observations.
    EffectObserverNeedsDisconnect,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require effect-owned observers to disconnect during cleanup.",
);

impl Rule for EffectObserverNeedsDisconnect {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let function_node_ids = index_observer_function_nodes(ctx);
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

            let mut tracked_observers =
                collect_effect_observers(callback_id, ctx, &function_node_ids);
            if tracked_observers.is_empty() {
                continue;
            }
            collect_observer_aliases(&mut tracked_observers, ctx);

            for_each_observer_execution_node(
                callback_id,
                ctx,
                &function_node_ids,
                &mut |candidate| {
                    record_observer_call(candidate, &mut tracked_observers, ctx);
                },
            );

            let cleanup_function_ids =
                collect_observer_cleanup_function_ids(callback_id, ctx, &function_node_ids);
            for cleanup_id in &cleanup_function_ids {
                for_each_observer_execution_node(
                    *cleanup_id,
                    ctx,
                    &function_node_ids,
                    &mut |candidate| {
                        record_observer_call(candidate, &mut tracked_observers, ctx);
                    },
                );
            }

            let observer_callback_ids = tracked_observers
                .iter()
                .filter_map(|tracked| observer_callback_id(tracked, ctx))
                .collect::<Vec<_>>();
            for observer_callback_id in observer_callback_ids {
                for_each_observer_execution_node(
                    observer_callback_id,
                    ctx,
                    &function_node_ids,
                    &mut |candidate| {
                        record_observer_call(candidate, &mut tracked_observers, ctx);
                    },
                );
            }

            let returned_expressions =
                collect_effect_return_expressions(callback_id, ctx, &function_node_ids);
            for tracked in &mut tracked_observers {
                if returned_expressions.iter().any(|expression| {
                    is_bound_observer_disconnect(
                        expression,
                        &tracked.binding_symbols,
                        ctx,
                        &mut FxHashSet::default(),
                    )
                }) {
                    release_all_observations(tracked);
                }
                collect_callback_parameter_releases(tracked, ctx, &function_node_ids);
                for released_key in &tracked.callback_released_target_keys {
                    tracked.observed_target_keys.remove(released_key);
                }
            }

            for tracked in &tracked_observers {
                if !tracked.did_observe
                    || tracked.did_release_all
                    || tracked.did_release_via_callback_parameter
                    || (!tracked.did_observe_unknown_target
                        && tracked.observed_iteration_target_keys.is_empty()
                        && tracked.observed_target_keys.is_empty())
                    || observer_is_retained_in_disconnected_collection(
                        tracked,
                        callback_id,
                        &cleanup_function_ids,
                        ctx,
                        &function_node_ids,
                    )
                {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::error(MESSAGE)
                        .with_label(ctx.nodes().get_node(tracked.construction_id).span()),
                );
            }
        }
    }
}

fn collect_effect_observers(
    callback_id: NodeId,
    ctx: &LintContext<'_>,
    function_node_ids: &FxHashMap<NodeId, Vec<NodeId>>,
) -> Vec<TrackedObserver> {
    let mut observers = Vec::new();
    let mut seen_constructions = FxHashSet::default();
    for_each_observer_execution_node(callback_id, ctx, function_node_ids, &mut |candidate| {
        let AstKind::NewExpression(construction) = candidate.kind() else {
            return;
        };
        if !is_global_observer_constructor(&construction.callee, ctx)
            || !seen_constructions.insert(candidate.id())
        {
            return;
        }
        let construction_root = transparent_expression_root(candidate, ctx);
        let declarator_node = ctx.nodes().parent_node(construction_root.id());
        let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
            return;
        };
        if declarator
            .init
            .as_ref()
            .is_none_or(|initializer| initializer.span() != construction_root.span())
        {
            return;
        }
        let Some(binding) = declarator.id.get_binding_identifier() else {
            return;
        };
        observers.push(TrackedObserver {
            construction_id: candidate.id(),
            binding_symbols: FxHashSet::from_iter([binding.symbol_id()]),
            did_observe: false,
            did_observe_unknown_target: false,
            did_release_all: false,
            did_release_via_callback_parameter: false,
            callback_released_target_keys: FxHashSet::default(),
            observed_iteration_target_keys: FxHashSet::default(),
            observed_target_keys: FxHashSet::default(),
        });
    });
    observers
}

fn is_global_observer_constructor(callee: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    match callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            OBSERVER_CONSTRUCTOR_NAMES.contains(&identifier.name.as_str())
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
            if !OBSERVER_CONSTRUCTOR_NAMES
                .contains(&member.static_property_name().unwrap_or_default())
            {
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

fn collect_observer_aliases(observers: &mut [TrackedObserver], ctx: &LintContext<'_>) {
    let mut did_grow = true;
    while did_grow {
        did_grow = false;
        for candidate in ctx.nodes().iter() {
            let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
                continue;
            };
            let Some(binding) = declarator.id.get_binding_identifier() else {
                continue;
            };
            let Some(initializer_symbol) = declarator
                .init
                .as_ref()
                .and_then(|initializer| observer_expression_symbol(initializer, ctx))
            else {
                continue;
            };
            for tracked in observers.iter_mut() {
                if tracked.binding_symbols.contains(&initializer_symbol)
                    && tracked.binding_symbols.insert(binding.symbol_id())
                {
                    did_grow = true;
                }
            }
        }
    }
}

fn record_observer_call(
    candidate: &AstNode<'_>,
    observers: &mut [TrackedObserver],
    ctx: &LintContext<'_>,
) {
    let AstKind::CallExpression(call) = candidate.kind() else {
        return;
    };
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return;
    };
    let Some(receiver_symbol) = observer_expression_symbol(member.object(), ctx) else {
        return;
    };
    let Some(tracked) = observers
        .iter_mut()
        .find(|tracked| tracked.binding_symbols.contains(&receiver_symbol))
    else {
        return;
    };
    match member.static_property_name() {
        Some("observe") => {
            tracked.did_observe = true;
            tracked.did_release_all = false;
            let target = call.arguments.first().and_then(Argument::as_expression);
            let iteration_target_key =
                target.and_then(|target| serialize_for_each_target(candidate.id(), target, ctx));
            let target_key = target.and_then(|target| serialize_observer_reference(target, ctx));
            if let Some(iteration_target_key) = iteration_target_key {
                tracked
                    .observed_iteration_target_keys
                    .insert(iteration_target_key);
            } else if let Some(target_key) = target_key {
                tracked.observed_target_keys.insert(target_key);
            } else {
                tracked.did_observe_unknown_target = true;
            }
        }
        Some("disconnect") if tracked.did_observe => release_all_observations(tracked),
        Some("unobserve") if tracked.did_observe => {
            let target = call.arguments.first().and_then(Argument::as_expression);
            let iteration_target_key =
                target.and_then(|target| serialize_for_each_target(candidate.id(), target, ctx));
            let target_key = target.and_then(|target| serialize_observer_reference(target, ctx));
            if let Some(iteration_target_key) = iteration_target_key
                && tracked
                    .observed_iteration_target_keys
                    .contains(&iteration_target_key)
            {
                tracked
                    .observed_iteration_target_keys
                    .remove(&iteration_target_key);
            } else if let Some(target_key) = target_key {
                tracked.observed_target_keys.remove(&target_key);
            }
        }
        _ => {}
    }
}

fn release_all_observations(tracked: &mut TrackedObserver) {
    tracked.did_release_all = true;
    tracked.did_observe_unknown_target = false;
    tracked.observed_iteration_target_keys.clear();
    tracked.observed_target_keys.clear();
}

fn observer_expression_symbol(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn serialize_observer_reference(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            Some(symbol.map_or_else(
                || identifier.name.to_string(),
                |symbol_id| format!("{}#{}", identifier.name, symbol_id.index()),
            ))
        }
        Expression::StringLiteral(literal) => Some(format!("string:{}", literal.value)),
        Expression::NumericLiteral(literal) => Some(format!("number:{}", literal.value)),
        expression => {
            let member = expression.as_member_expression()?;
            let receiver = serialize_observer_reference(member.object(), ctx)?;
            Some(format!("{receiver}.{}", member.static_property_name()?))
        }
    }
}

fn serialize_for_each_target(
    method_call_id: NodeId,
    target: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let iterator_callback_id = local_callback_nearest_function_id(method_call_id, ctx)?;
    let iterator_callback = ctx.nodes().get_node(iterator_callback_id);
    if !observer_function_is_synchronous(iterator_callback) {
        return None;
    }
    let callback_root = transparent_expression_root(iterator_callback, ctx);
    let iterator_call_node = ctx.nodes().parent_node(callback_root.id());
    let AstKind::CallExpression(iterator_call) = iterator_call_node.kind() else {
        return None;
    };
    if !iterator_call
        .arguments
        .iter()
        .filter_map(Argument::as_expression)
        .any(|argument| argument.span() == callback_root.span())
        || observer_node_has_control_flow_ancestor(
            iterator_call_node.id(),
            local_callback_nearest_function_id(iterator_call_node.id(), ctx)?,
            ctx,
        )
    {
        return None;
    }
    let iterator_member = iterator_call
        .callee
        .get_inner_expression()
        .as_member_expression()?;
    if iterator_member.static_property_name() != Some("forEach") {
        return None;
    }
    let collection_symbol = observer_expression_symbol(iterator_member.object(), ctx)?;
    let stable_collection_symbol =
        resolve_stable_collection_symbol(collection_symbol, ctx, &mut FxHashSet::default())?;
    let collection_key = serialize_symbol_key(stable_collection_symbol, ctx);

    let mut visited_symbols = FxHashSet::default();
    let target_key =
        serialize_for_each_expression(target, iterator_callback_id, ctx, &mut visited_symbols)?;
    visited_symbols.clear();
    let mut guard_keys = Vec::new();
    let mut child_id = method_call_id;
    for ancestor in ctx.nodes().ancestors(method_call_id) {
        if ancestor.id() == iterator_callback_id {
            return Some(format!(
                "{collection_key}:{}:{target_key}",
                guard_keys.join("&")
            ));
        }
        match ancestor.kind() {
            AstKind::IfStatement(statement) => {
                let polarity = if statement
                    .consequent
                    .span()
                    .contains_inclusive(ctx.nodes().get_node(child_id).span())
                {
                    "truthy"
                } else {
                    "falsy"
                };
                let guard_key = serialize_for_each_expression(
                    &statement.test,
                    iterator_callback_id,
                    ctx,
                    &mut visited_symbols,
                )?;
                guard_keys.push(format!("{polarity}:{guard_key}"));
            }
            AstKind::ConditionalExpression(_)
            | AstKind::LogicalExpression(_)
            | AstKind::SwitchStatement(_)
            | AstKind::ForStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_)
            | AstKind::WhileStatement(_)
            | AstKind::DoWhileStatement(_) => return None,
            _ => {}
        }
        child_id = ancestor.id();
    }
    None
}

fn serialize_for_each_expression(
    expression: &Expression<'_>,
    iterator_callback_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| reference.is_write())
            {
                return None;
            }
            if let Some(parameter_index) =
                function_parameter_index(iterator_callback_id, symbol_id, ctx)
            {
                return Some(format!("${parameter_index}"));
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            if local_callback_nearest_function_id(declaration.id(), ctx)
                == Some(iterator_callback_id)
                && visited_symbols.insert(symbol_id)
                && let AstKind::VariableDeclarator(declarator) = declaration.kind()
                && let Some(initializer) = &declarator.init
            {
                return serialize_for_each_expression(
                    initializer,
                    iterator_callback_id,
                    ctx,
                    visited_symbols,
                );
            }
            Some(serialize_symbol_key(symbol_id, ctx))
        }
        Expression::StringLiteral(literal) => Some(format!("string:{}", literal.value)),
        Expression::NumericLiteral(literal) => Some(format!("number:{}", literal.value)),
        Expression::BooleanLiteral(literal) => Some(format!("boolean:{}", literal.value)),
        Expression::NullLiteral(_) => Some("null".to_string()),
        Expression::CallExpression(call) => {
            let member = call.callee.get_inner_expression().as_member_expression()?;
            if member.static_property_name() != Some("getElementById") {
                return None;
            }
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return None;
            };
            if receiver.name != "document"
                || ctx
                    .scoping()
                    .get_reference(receiver.reference_id())
                    .symbol_id()
                    .is_some()
            {
                return None;
            }
            let argument_keys = call
                .arguments
                .iter()
                .map(|argument| {
                    serialize_for_each_expression(
                        argument.as_expression()?,
                        iterator_callback_id,
                        ctx,
                        visited_symbols,
                    )
                })
                .collect::<Option<Vec<_>>>()?;
            Some(format!(
                "document.getElementById({})",
                argument_keys.join(",")
            ))
        }
        expression => {
            let member = expression.as_member_expression()?;
            let receiver = serialize_for_each_expression(
                member.object(),
                iterator_callback_id,
                ctx,
                visited_symbols,
            )?;
            Some(format!("{receiver}.{}", member.static_property_name()?))
        }
    }
}

fn function_parameter_index(
    function_id: NodeId,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<usize> {
    let parameters = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => &function.params.items,
        AstKind::ArrowFunctionExpression(function) => &function.params.items,
        _ => return None,
    };
    parameters.iter().position(|parameter| {
        parameter
            .pattern
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
    })
}

fn resolve_stable_collection_symbol(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Option<SymbolId> {
    if !visited_symbols.insert(symbol_id) || observer_collection_symbol_is_mutated(symbol_id, ctx) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Some(symbol_id);
    };
    let Some(initializer_symbol) = declarator
        .init
        .as_ref()
        .and_then(|initializer| observer_expression_symbol(initializer, ctx))
    else {
        return Some(symbol_id);
    };
    resolve_stable_collection_symbol(initializer_symbol, ctx, visited_symbols)
}

fn observer_collection_symbol_is_mutated(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            if reference.is_write() {
                return true;
            }
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let member_node = ctx.nodes().parent_node(reference_root.id());
            let Some(member) = member_node.kind().as_member_expression_kind() else {
                return false;
            };
            if member.object().span() != reference_root.span() {
                return false;
            }
            let parent = ctx.nodes().parent_node(member_node.id());
            if matches!(parent.kind(), AstKind::AssignmentExpression(assignment) if assignment.left.span() == member_node.span())
            {
                return true;
            }
            matches!(parent.kind(), AstKind::CallExpression(call) if call.callee.span() == member_node.span())
                && COLLECTION_MUTATION_METHOD_NAMES
                    .iter()
                    .any(|method_name| member.static_property_name().as_deref() == Some(*method_name))
        })
}

fn serialize_symbol_key(symbol_id: SymbolId, ctx: &LintContext<'_>) -> String {
    let name = ctx.scoping().symbol_name(symbol_id);
    format!("{name}#{}", symbol_id.index())
}

fn observer_function_is_synchronous(function: &AstNode<'_>) -> bool {
    match function.kind() {
        AstKind::Function(function) => !function.r#async && !function.generator,
        AstKind::ArrowFunctionExpression(function) => !function.r#async,
        _ => false,
    }
}

fn collect_callback_parameter_releases(
    tracked: &mut TrackedObserver,
    ctx: &LintContext<'_>,
    function_node_ids: &FxHashMap<NodeId, Vec<NodeId>>,
) {
    let Some(callback_id) = observer_callback_id(tracked, ctx) else {
        return;
    };
    let Some(observer_parameter_symbol) = function_parameter_symbol(callback_id, 1, ctx) else {
        return;
    };
    let entries_parameter_symbol = function_parameter_symbol(callback_id, 0, ctx);
    for_each_observer_execution_node(callback_id, ctx, function_node_ids, &mut |candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            return;
        };
        if observer_expression_symbol(member.object(), ctx) != Some(observer_parameter_symbol) {
            return;
        }
        match member.static_property_name() {
            Some("disconnect") => tracked.did_release_via_callback_parameter = true,
            Some("unobserve") => {
                let Some(target) = call.arguments.first().and_then(Argument::as_expression) else {
                    return;
                };
                if entries_parameter_symbol.is_some_and(|entries_symbol| {
                    is_observer_entry_iteration_target(
                        target,
                        candidate.id(),
                        callback_id,
                        entries_symbol,
                        ctx,
                    )
                }) {
                    tracked.did_release_via_callback_parameter = true;
                } else if let Some(target_key) = serialize_observer_reference(target, ctx) {
                    tracked.callback_released_target_keys.insert(target_key);
                }
            }
            _ => {}
        }
    });
}

fn observer_callback_id(tracked: &TrackedObserver, ctx: &LintContext<'_>) -> Option<NodeId> {
    let construction_node = ctx.nodes().get_node(tracked.construction_id);
    let AstKind::NewExpression(construction) = construction_node.kind() else {
        return None;
    };
    let callback_expression = construction
        .arguments
        .first()
        .and_then(Argument::as_expression)?;
    match callback_expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    }
}

fn function_parameter_symbol(
    function_id: NodeId,
    parameter_index: usize,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let parameter = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.params.items.get(parameter_index),
        AstKind::ArrowFunctionExpression(function) => function.params.items.get(parameter_index),
        _ => None,
    }?;
    parameter
        .pattern
        .get_binding_identifier()
        .map(|binding| binding.symbol_id())
}

fn is_observer_entry_iteration_target(
    target: &Expression<'_>,
    release_call_id: NodeId,
    observer_callback_id: NodeId,
    entries_symbol: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(target_member) = target.get_inner_expression().as_member_expression() else {
        return false;
    };
    if target_member.static_property_name() != Some("target") {
        return false;
    }
    let Some(entry_symbol) = observer_expression_symbol(target_member.object(), ctx) else {
        return false;
    };
    let Some(iterator_callback_id) = local_callback_nearest_function_id(release_call_id, ctx)
    else {
        return false;
    };
    if iterator_callback_id == observer_callback_id
        || function_parameter_symbol(iterator_callback_id, 0, ctx) != Some(entry_symbol)
    {
        return false;
    }
    let iterator_node = ctx.nodes().get_node(iterator_callback_id);
    let iterator_root = transparent_expression_root(iterator_node, ctx);
    let iterator_call_node = ctx.nodes().parent_node(iterator_root.id());
    let AstKind::CallExpression(iterator_call) = iterator_call_node.kind() else {
        return false;
    };
    let Some(iterator_member) = iterator_call
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    iterator_member.static_property_name() == Some("forEach")
        && observer_expression_symbol(iterator_member.object(), ctx) == Some(entries_symbol)
}

fn collect_observer_cleanup_function_ids(
    callback_id: NodeId,
    ctx: &LintContext<'_>,
    function_node_ids: &FxHashMap<NodeId, Vec<NodeId>>,
) -> Vec<NodeId> {
    let mut cleanup_ids = Vec::new();
    let callback_node = ctx.nodes().get_node(callback_id);
    if let AstKind::ArrowFunctionExpression(function) = callback_node.kind()
        && let Some(expression) = function.get_expression()
    {
        resolve_observer_cleanup_expression(expression, ctx, &mut cleanup_ids);
    }
    for candidate_id in function_node_ids.get(&callback_id).into_iter().flatten() {
        let candidate = ctx.nodes().get_node(*candidate_id);
        let AstKind::ReturnStatement(statement) = candidate.kind() else {
            continue;
        };
        if let Some(argument) = &statement.argument {
            resolve_observer_cleanup_expression(argument, ctx, &mut cleanup_ids);
        }
    }
    cleanup_ids.sort_by_key(|id| ctx.nodes().get_node(*id).span().start);
    cleanup_ids.dedup();
    cleanup_ids
}

fn resolve_observer_cleanup_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    cleanup_ids: &mut Vec<NodeId>,
) {
    match expression.get_inner_expression() {
        Expression::ConditionalExpression(conditional) => {
            resolve_observer_cleanup_expression(&conditional.consequent, ctx, cleanup_ids);
            resolve_observer_cleanup_expression(&conditional.alternate, ctx, cleanup_ids);
        }
        Expression::SequenceExpression(sequence) => {
            if let Some(last) = sequence.expressions.last() {
                resolve_observer_cleanup_expression(last, ctx, cleanup_ids);
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

fn collect_effect_return_expressions<'a>(
    callback_id: NodeId,
    ctx: &LintContext<'a>,
    function_node_ids: &FxHashMap<NodeId, Vec<NodeId>>,
) -> Vec<&'a Expression<'a>> {
    let mut expressions = Vec::new();
    let callback_node = ctx.nodes().get_node(callback_id);
    if let AstKind::ArrowFunctionExpression(function) = callback_node.kind()
        && let Some(expression) = function.get_expression()
    {
        expressions.push(expression);
    }
    for candidate_id in function_node_ids.get(&callback_id).into_iter().flatten() {
        let candidate = ctx.nodes().get_node(*candidate_id);
        let AstKind::ReturnStatement(statement) = candidate.kind() else {
            continue;
        };
        if let Some(argument) = &statement.argument {
            expressions.push(argument);
        }
    }
    expressions
}

fn is_bound_observer_disconnect(
    expression: &Expression<'_>,
    observer_symbols: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        let parent = ctx.nodes().parent_node(declaration.id());
        if !matches!(parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| reference.is_write())
        {
            return false;
        }
        return declarator.init.as_ref().is_some_and(|initializer| {
            is_bound_observer_disconnect(initializer, observer_symbols, ctx, visited_symbols)
        });
    }
    let Expression::CallExpression(bind_call) = expression else {
        return false;
    };
    let Some(bind_member) = bind_call
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if bind_member.static_property_name() != Some("bind") {
        return false;
    }
    let Some(disconnect_member) = bind_member
        .object()
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if disconnect_member.static_property_name() != Some("disconnect") {
        return false;
    }
    let method_receiver = observer_expression_symbol(disconnect_member.object(), ctx);
    let bound_receiver = bind_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .and_then(|argument| observer_expression_symbol(argument, ctx));
    method_receiver.is_some_and(|symbol| observer_symbols.contains(&symbol))
        && bound_receiver.is_some_and(|symbol| observer_symbols.contains(&symbol))
}

fn observer_is_retained_in_disconnected_collection(
    tracked: &TrackedObserver,
    callback_id: NodeId,
    cleanup_function_ids: &[NodeId],
    ctx: &LintContext<'_>,
    function_node_ids: &FxHashMap<NodeId, Vec<NodeId>>,
) -> bool {
    let Some(collection_symbol) =
        retained_observer_collection_symbol(tracked, callback_id, ctx, function_node_ids)
    else {
        return false;
    };
    cleanup_function_ids.len() == 1
        && cleanup_disconnects_collection(
            cleanup_function_ids[0],
            collection_symbol,
            ctx,
            function_node_ids,
        )
}

fn retained_observer_collection_symbol(
    tracked: &TrackedObserver,
    callback_id: NodeId,
    ctx: &LintContext<'_>,
    function_node_ids: &FxHashMap<NodeId, Vec<NodeId>>,
) -> Option<SymbolId> {
    let mut collection_symbols = FxHashSet::default();
    for_each_observer_execution_node(callback_id, ctx, function_node_ids, &mut |candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            return;
        };
        if member.static_property_name() != Some("push")
            || !call.arguments.iter().any(|argument| {
                argument
                    .as_expression()
                    .and_then(|expression| observer_expression_symbol(expression, ctx))
                    .is_some_and(|symbol| tracked.binding_symbols.contains(&symbol))
            })
        {
            return;
        }
        let owner_function_id = local_callback_nearest_function_id(candidate.id(), ctx);
        if owner_function_id.is_some_and(|owner_id| {
            observer_node_has_conditional_ancestor(candidate.id(), owner_id, ctx)
        }) {
            return;
        }
        if let Some(symbol) = observer_expression_symbol(member.object(), ctx) {
            collection_symbols.insert(symbol);
        }
    });
    if collection_symbols.len() != 1 {
        return None;
    }
    let collection_symbol = *collection_symbols.iter().next()?;
    let declaration = ctx.symbol_declaration(collection_symbol);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    let is_const_empty_array = matches!(parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
        && matches!(declarator.init.as_ref().map(Expression::get_inner_expression), Some(Expression::ArrayExpression(array)) if array.elements.is_empty());
    if !is_const_empty_array
        || ctx
            .scoping()
            .get_resolved_references(collection_symbol)
            .any(|reference| reference.is_write())
    {
        return None;
    }
    let has_mutating_call = ctx
        .scoping()
        .get_resolved_references(collection_symbol)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let root = transparent_expression_root(reference_node, ctx);
            let member_node = ctx.nodes().parent_node(root.id());
            let AstKind::StaticMemberExpression(member) = member_node.kind() else {
                return true;
            };
            let call_node = ctx.nodes().parent_node(member_node.id());
            !matches!(call_node.kind(), AstKind::CallExpression(call) if call.callee.span() == member.span && matches!(member.property.name.as_str(), "push" | "forEach"))
        });
    (!has_mutating_call).then_some(collection_symbol)
}

fn cleanup_disconnects_collection(
    cleanup_id: NodeId,
    collection_symbol: SymbolId,
    ctx: &LintContext<'_>,
    function_node_ids: &FxHashMap<NodeId, Vec<NodeId>>,
) -> bool {
    let mut did_disconnect_collection = false;
    for candidate_id in function_node_ids.get(&cleanup_id).into_iter().flatten() {
        let candidate = ctx.nodes().get_node(*candidate_id);
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            continue;
        };
        if member.static_property_name() != Some("forEach")
            || observer_expression_symbol(member.object(), ctx) != Some(collection_symbol)
            || observer_node_has_conditional_ancestor(candidate.id(), cleanup_id, ctx)
        {
            continue;
        }
        let Some(iterator_callback) = call.arguments.first().and_then(Argument::as_expression)
        else {
            continue;
        };
        let Some(iterator_id) =
            exact_local_callback_function_id(iterator_callback, ctx, &mut Vec::new())
        else {
            continue;
        };
        let Some(observer_parameter) = function_parameter_symbol(iterator_id, 0, ctx) else {
            continue;
        };
        for iterator_candidate_id in function_node_ids.get(&iterator_id).into_iter().flatten() {
            let iterator_candidate = ctx.nodes().get_node(*iterator_candidate_id);
            let AstKind::CallExpression(disconnect_call) = iterator_candidate.kind() else {
                continue;
            };
            let Some(disconnect_member) = disconnect_call
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                continue;
            };
            if disconnect_member.static_property_name() == Some("disconnect")
                && observer_expression_symbol(disconnect_member.object(), ctx)
                    == Some(observer_parameter)
                && !observer_node_has_conditional_ancestor(
                    iterator_candidate.id(),
                    iterator_id,
                    ctx,
                )
            {
                did_disconnect_collection = true;
            }
        }
    }
    did_disconnect_collection
}

fn observer_node_has_conditional_ancestor(
    node_id: NodeId,
    owner_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .take_while(|ancestor| ancestor.id() != owner_function_id)
        .any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::ConditionalExpression(_)
                    | AstKind::IfStatement(_)
                    | AstKind::LogicalExpression(_)
                    | AstKind::SwitchStatement(_)
            )
        })
}

fn observer_node_has_control_flow_ancestor(
    node_id: NodeId,
    owner_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .take_while(|ancestor| ancestor.id() != owner_function_id)
        .any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::ConditionalExpression(_)
                    | AstKind::IfStatement(_)
                    | AstKind::LogicalExpression(_)
                    | AstKind::SwitchStatement(_)
                    | AstKind::ForStatement(_)
                    | AstKind::ForInStatement(_)
                    | AstKind::ForOfStatement(_)
                    | AstKind::WhileStatement(_)
                    | AstKind::DoWhileStatement(_)
            )
        })
}

fn index_observer_function_nodes(ctx: &LintContext<'_>) -> FxHashMap<NodeId, Vec<NodeId>> {
    let mut function_node_ids = FxHashMap::<NodeId, Vec<NodeId>>::default();
    for candidate in ctx.nodes().iter() {
        if let Some(function_id) = local_callback_nearest_function_id(candidate.id(), ctx) {
            function_node_ids
                .entry(function_id)
                .or_default()
                .push(candidate.id());
        }
    }
    function_node_ids
}

fn for_each_observer_execution_node<'a>(
    root_function_id: NodeId,
    ctx: &LintContext<'a>,
    function_node_ids: &FxHashMap<NodeId, Vec<NodeId>>,
    visitor: &mut impl FnMut(&AstNode<'a>),
) {
    for_each_observer_execution_node_internal(
        root_function_id,
        ctx,
        function_node_ids,
        visitor,
        &mut FxHashSet::default(),
    );
}

fn for_each_observer_execution_node_internal<'a>(
    function_id: NodeId,
    ctx: &LintContext<'a>,
    function_node_ids: &FxHashMap<NodeId, Vec<NodeId>>,
    visitor: &mut impl FnMut(&AstNode<'a>),
    active_function_ids: &mut FxHashSet<NodeId>,
) {
    if !active_function_ids.insert(function_id) {
        return;
    }
    let mut direct_nodes = function_node_ids
        .get(&function_id)
        .into_iter()
        .flatten()
        .map(|candidate_id| ctx.nodes().get_node(*candidate_id))
        .collect::<Vec<_>>();
    direct_nodes.sort_by_key(|candidate| (candidate.span().start, candidate.span().end));
    for candidate in direct_nodes {
        visitor(candidate);
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        if let Some(called_id) =
            exact_local_callback_function_id(&call.callee, ctx, &mut Vec::new())
        {
            for_each_observer_execution_node_internal(
                called_id,
                ctx,
                function_node_ids,
                visitor,
                active_function_ids,
            );
        }
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            continue;
        };
        if !SYNCHRONOUS_ITERATOR_METHOD_NAMES
            .contains(&member.static_property_name().unwrap_or_default())
        {
            continue;
        }
        for argument in &call.arguments {
            let Some(callback) = argument.as_expression() else {
                continue;
            };
            if let Some(callback_id) =
                exact_local_callback_function_id(callback, ctx, &mut Vec::new())
            {
                for_each_observer_execution_node_internal(
                    callback_id,
                    ctx,
                    function_node_ids,
                    visitor,
                    active_function_ids,
                );
            }
        }
    }
    active_function_ids.remove(&function_id);
}
