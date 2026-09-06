use std::{
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, ArrayExpressionElement, BindingPattern, ExportDefaultDeclarationKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_parser::Parser;
use oxc_resolver::{ResolveOptions, Resolver, TsconfigDiscovery};
use oxc_semantic::{NodeId, Semantic, SemanticBuilder};
use oxc_span::{GetSpan, SourceType, VALID_EXTENSIONS};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::{ExportExportName, ExportImportName, ImportImportName, ModuleRecord},
    rule::Rule,
};

const NO_ADJUST_SUBSCRIPTION_MEMBER_CALLS: [&str; 8] = [
    "addEventListener",
    "addListener",
    "listen",
    "observe",
    "on",
    "sub",
    "subscribe",
    "watch",
];
const NO_ADJUST_DEFERRED_MEMBER_CALLS: [&str; 3] = ["catch", "finally", "then"];
const NO_ADJUST_INDEPENDENT_WRITER_DEFERRED_DIRECT_CALLS: [&str; 5] = [
    "addEventListener",
    "addListener",
    "requestAnimationFrame",
    "setInterval",
    "setTimeout",
];
const NO_ADJUST_INDEPENDENT_WRITER_DEFERRED_MEMBER_CALLS: [&str; 4] =
    ["catch", "finally", "subscribe", "then"];
const NO_ADJUST_EAGER_ITERATOR_METHODS: [&str; 11] = [
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
const NO_ADJUST_ARRAY_RETURNING_METHODS: [&str; 11] = [
    "concat",
    "filter",
    "flat",
    "flatMap",
    "map",
    "slice",
    "sort",
    "toReversed",
    "toSorted",
    "toSpliced",
    "with",
];
const NO_ADJUST_EAGER_COLLECTION_CONSTRUCTORS: [&str; 12] = [
    "Array",
    "BigInt64Array",
    "BigUint64Array",
    "Float32Array",
    "Float64Array",
    "Int8Array",
    "Int16Array",
    "Int32Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Uint16Array",
    "Uint32Array",
];
const NO_ADJUST_EAGER_FOREACH_COLLECTION_CONSTRUCTORS: [&str; 14] = [
    "Array",
    "BigInt64Array",
    "BigUint64Array",
    "Float32Array",
    "Float64Array",
    "Int8Array",
    "Int16Array",
    "Int32Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Uint16Array",
    "Uint32Array",
    "Map",
    "Set",
];
const NO_ADJUST_FETCH_DIRECT_CALLS: [&str; 5] = ["fetch", "got", "ky", "ofetch", "wretch"];
const NO_ADJUST_FETCH_MEMBER_OBJECTS: [&str; 6] =
    ["axios", "got", "ky", "ofetch", "request", "wretch"];
const NO_ADJUST_TIMER_DIRECT_CALLS: [&str; 7] = [
    "clearInterval",
    "clearTimeout",
    "queueMicrotask",
    "requestAnimationFrame",
    "requestIdleCallback",
    "setInterval",
    "setTimeout",
];
const NO_ADJUST_TIMER_CLEANUP_CALLS: [&str; 2] = ["clearInterval", "clearTimeout"];
const NO_ADJUST_GLOBAL_NAMESPACE_NAMES: [&str; 3] = ["globalThis", "self", "window"];
const NO_ADJUST_OBSERVER_CONSTRUCTORS: [&str; 4] = [
    "IntersectionObserver",
    "MutationObserver",
    "PerformanceObserver",
    "ResizeObserver",
];
const NO_ADJUST_EXTERNAL_DOM_MEMBER_CALLS: [&str; 15] = [
    "blur",
    "canPlayType",
    "focus",
    "getBoundingClientRect",
    "getClientRects",
    "measure",
    "measureInWindow",
    "measureLayout",
    "scroll",
    "scrollBy",
    "scrollIntoView",
    "scrollTo",
    "select",
    "setRangeText",
    "setSelectionRange",
];
const NO_ADJUST_PURE_DIRECT_CALLS: [&str; 10] = [
    "Array",
    "BigInt",
    "Boolean",
    "Number",
    "Object",
    "String",
    "encodeURIComponent",
    "parseFloat",
    "parseInt",
    "structuredClone",
];
const NO_ADJUST_PURE_MEMBER_CALLS: [&str; 14] = [
    "concat",
    "filter",
    "flatMap",
    "join",
    "map",
    "reduce",
    "replace",
    "slice",
    "split",
    "toLowerCase",
    "toSorted",
    "toString",
    "toUpperCase",
    "trim",
];
const NO_ADJUST_CROSS_FILE_EXPORT_DEPTH: usize = 4;

static NO_ADJUST_IMPORTED_DOM_SYNC_CACHE: OnceLock<
    Mutex<FxHashMap<(PathBuf, String, usize, u64), bool>>,
> = OnceLock::new();

struct NoAdjustValueContext<'node, 'ast> {
    substitutions: FxHashMap<SymbolId, &'node Expression<'ast>>,
    write_anchor: &'node AstNode<'ast>,
}

#[derive(Debug, Default, Clone)]
pub struct NoAdjustStateOnPropChange;

declare_oxc_lint!(
    /// Warns when an effect synchronously adjusts state after a prop changes.
    NoAdjustStateOnPropChange,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when an effect synchronously adjusts state after a prop changes.",
);

impl Rule for NoAdjustStateOnPropChange {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(effect_call) = node.kind() else {
            return;
        };
        if !is_react_hook_call(effect_call, &["useEffect"], ctx) {
            return;
        }
        let Some(component_node_id) = no_adjust_nearest_function_node_id(node.id(), ctx) else {
            return;
        };
        let Some(Expression::ArrayExpression(dependencies)) = effect_call
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
        else {
            return;
        };
        if !dependencies
            .elements
            .iter()
            .filter_map(no_adjust_array_element_expression)
            .any(|dependency| {
                no_adjust_dependency_expression_has_prop_source(
                    dependency,
                    component_node_id,
                    ctx,
                    &mut Vec::new(),
                )
            })
        {
            return;
        }
        let Some(callback_expression) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let Some(callback_node_id) =
            no_adjust_effect_callback_function_id(callback_expression, ctx)
        else {
            return;
        };
        if no_adjust_function_is_async(callback_node_id, ctx) {
            return;
        }
        if no_adjust_effect_has_cleanup(callback_node_id, ctx) {
            return;
        }

        let prop_dependency_symbols =
            no_adjust_prop_dependency_symbols(dependencies, component_node_id, ctx);
        let mut callback_execution_frames = Vec::new();
        no_adjust_for_each_callback_execution_node(
            callback_node_id,
            true,
            ctx,
            |candidate, invocation_id| {
                callback_execution_frames.push((candidate.id(), invocation_id));
            },
        );
        let callback_execution_node_id_set = callback_execution_frames
            .iter()
            .map(|(candidate_id, _)| *candidate_id)
            .collect::<FxHashSet<_>>();
        let external_work_nodes = no_adjust_collect_external_work_nodes(callback_node_id, ctx);
        for (candidate_id, invocation_id) in callback_execution_frames {
            let candidate = ctx.nodes().get_node(candidate_id);
            if no_adjust_enclosing_function_is_async(candidate.id(), ctx) {
                continue;
            }
            let AstKind::CallExpression(setter_call) = candidate.kind() else {
                continue;
            };
            let Expression::Identifier(setter_identifier) =
                setter_call.callee.get_inner_expression()
            else {
                continue;
            };
            if setter_call.arguments.len() != 1 {
                continue;
            }
            let Some(written_value) = setter_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let resolved_state_pair =
                if no_adjust_callee_resolves_to_local_function(&setter_call.callee, ctx) {
                    None
                } else {
                    resolve_const_identifier_root_symbol(setter_identifier, ctx)
                        .and_then(|setter_symbol_id| {
                            no_adjust_state_symbol_for_setter(setter_symbol_id, ctx)
                                .map(|state_symbol_id| (setter_symbol_id, state_symbol_id))
                        })
                        .or_else(|| {
                            let setter_symbol_id = ctx
                                .scoping()
                                .get_reference(setter_identifier.reference_id())
                                .symbol_id()?;
                            no_adjust_state_symbol_for_setter(setter_symbol_id, ctx)
                                .map(|state_symbol_id| (setter_symbol_id, state_symbol_id))
                        })
                        .or_else(|| {
                            no_adjust_literal_hook_result_upstream_state_pair(
                                setter_identifier,
                                written_value,
                                ctx,
                            )
                        })
                };
            let Some((setter_symbol_id, state_symbol_id)) = resolved_state_pair else {
                continue;
            };
            let value_context = no_adjust_setter_value_context(candidate, invocation_id, ctx);
            let remaining_value_call_frames = usize::from(invocation_id.is_none());
            let should_report = {
                let written_value_has_prop_source = no_adjust_written_value_has_prop_source(
                    written_value,
                    component_node_id,
                    ctx,
                    &mut Vec::new(),
                    &value_context.substitutions,
                    remaining_value_call_frames,
                    state_symbol_id,
                );
                let writes_prop_derived_value = written_value_has_prop_source
                    || no_adjust_written_member_value_has_prop_source(
                        written_value,
                        component_node_id,
                        ctx,
                    )
                    || no_adjust_function_body_has_prop_source(
                        written_value,
                        component_node_id,
                        ctx,
                        &value_context.substitutions,
                        state_symbol_id,
                    );
                let is_event_owned_prop_derived_adjustment = writes_prop_derived_value
                    && no_adjust_setter_has_independent_writer(
                        setter_symbol_id,
                        effect_call.span,
                        component_node_id,
                        ctx,
                    )
                    && (no_adjust_effect_reads_state_before_write(
                        state_symbol_id,
                        candidate,
                        invocation_id,
                        callback_node_id,
                        &callback_execution_node_id_set,
                        ctx,
                    ) || no_adjust_functional_updater_reads_current_state(written_value, ctx));
                !no_adjust_effect_has_related_external_work(
                    &external_work_nodes,
                    candidate,
                    setter_symbol_id,
                    state_symbol_id,
                    &prop_dependency_symbols,
                    component_node_id,
                    ctx,
                ) && !no_adjust_has_resource_lifecycle_setter_writer(
                    setter_symbol_id,
                    setter_call,
                    written_value,
                    effect_call.span,
                    &prop_dependency_symbols,
                    component_node_id,
                    ctx,
                ) && !no_adjust_write_resets_source_state(
                    written_value,
                    state_symbol_id,
                    value_context.write_anchor,
                    callback_expression,
                    ctx,
                ) && (is_event_owned_prop_derived_adjustment
                    || no_adjust_written_value_is_render_known(
                        written_value,
                        component_node_id,
                        ctx,
                        &mut Vec::new(),
                        &value_context.substitutions,
                        remaining_value_call_frames,
                    ))
                    && (!written_value_has_prop_source || is_event_owned_prop_derived_adjustment)
            };
            if !should_report {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(
                    "This effect adjusts state after a prop changes, so users briefly see the stale value.",
                )
                .with_label(setter_call.span),
            );
        }
    }
}

fn no_adjust_array_element_expression<'a, 'b>(
    element: &'b ArrayExpressionElement<'a>,
) -> Option<&'b Expression<'a>> {
    match element {
        ArrayExpressionElement::SpreadElement(spread) => Some(&spread.argument),
        element => element.as_expression(),
    }
}

fn no_adjust_effect_callback_function_id(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    match expression {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) => Some(function.node_id.get()),
                AstKind::VariableDeclarator(declarator) => {
                    no_adjust_effect_callback_initializer_function_id(declarator.init.as_ref()?)
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn no_adjust_effect_callback_initializer_function_id(
    initializer: &Expression<'_>,
) -> Option<NodeId> {
    match initializer {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::CallExpression(call_expression)
            if no_adjust_callee_is_syntactic_use_callback(&call_expression.callee) =>
        {
            match call_expression.arguments.first()?.as_expression()? {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn no_adjust_nearest_function_node_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn no_adjust_is_inside_statically_unreachable_branch(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child = node;
    loop {
        let parent = ctx.nodes().parent_node(child.id());
        let child_span = child.span();
        match parent.kind() {
            AstKind::IfStatement(statement) => {
                if let Expression::BooleanLiteral(test) = &statement.test
                    && ((!test.value && statement.consequent.span() == child_span)
                        || (test.value
                            && statement
                                .alternate
                                .as_ref()
                                .is_some_and(|alternate| alternate.span() == child_span)))
                {
                    return true;
                }
            }
            AstKind::ConditionalExpression(expression) => {
                if let Expression::BooleanLiteral(test) = &expression.test
                    && ((!test.value && expression.consequent.span() == child_span)
                        || (test.value && expression.alternate.span() == child_span))
                {
                    return true;
                }
            }
            AstKind::WhileStatement(statement) => {
                if statement.body.span() == child_span
                    && static_literal_truthiness(&statement.test) == Some(false)
                {
                    return true;
                }
            }
            AstKind::ForStatement(statement) => {
                if statement.body.span() == child_span
                    && statement
                        .test
                        .as_ref()
                        .is_some_and(|test| static_literal_truthiness(test) == Some(false))
                {
                    return true;
                }
            }
            AstKind::LogicalExpression(expression) if expression.right.span() == child_span => {
                let left_truthiness = static_literal_truthiness(&expression.left);
                if (expression.operator == oxc_syntax::operator::LogicalOperator::And
                    && left_truthiness == Some(false))
                    || (expression.operator == oxc_syntax::operator::LogicalOperator::Or
                        && left_truthiness == Some(true))
                {
                    return true;
                }
            }
            AstKind::Program(_) => return false,
            _ => {}
        }
        child = parent;
    }
}

fn no_adjust_function_is_async(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(node_id).kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn no_adjust_enclosing_function_is_async(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    no_adjust_nearest_function_node_id(node_id, ctx)
        .is_some_and(|function_node_id| no_adjust_function_is_async(function_node_id, ctx))
}

fn no_adjust_effect_has_cleanup(callback_node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let callback_node = ctx.nodes().get_node(callback_node_id);
    if let AstKind::ArrowFunctionExpression(function) = callback_node.kind()
        && let Some(expression) = function.get_expression()
        && no_adjust_is_cleanup_value(expression, ctx)
    {
        return true;
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            return false;
        };
        callback_node.span().contains_inclusive(candidate.span())
            && no_adjust_nearest_function_node_id(candidate.id(), ctx) == Some(callback_node_id)
            && return_statement
                .argument
                .as_ref()
                .is_some_and(|argument| no_adjust_is_cleanup_value(argument, ctx))
    })
}

fn no_adjust_is_cleanup_value(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
        Expression::Identifier(identifier) => {
            no_adjust_identifier_resolves_to_cleanup(identifier, ctx)
        }
        Expression::ConditionalExpression(conditional) => {
            no_adjust_is_cleanup_value(&conditional.consequent, ctx)
                || no_adjust_is_cleanup_value(&conditional.alternate, ctx)
        }
        expression => expression.as_member_expression().is_some(),
    }
}

fn no_adjust_identifier_resolves_to_cleanup(
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
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(_) | AstKind::FormalParameter(_) => true,
        AstKind::VariableDeclarator(declarator) => {
            declarator.init.as_ref().is_some_and(|initializer| {
                no_adjust_effect_callback_initializer_function_id(initializer).is_some()
            })
        }
        _ => false,
    }
}

fn no_adjust_callee_is_syntactic_use_callback(callee: &Expression<'_>) -> bool {
    match callee.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name == "useCallback",
        expression => {
            expression
                .as_member_expression()
                .and_then(|member| member.static_property_name())
                == Some("useCallback")
        }
    }
}

struct NoAdjustExternalWork {
    node_id: NodeId,
    invocation_path: Vec<NodeId>,
}

fn no_adjust_effect_has_related_external_work<'a>(
    external_work_nodes: &[NoAdjustExternalWork],
    setter_node: &AstNode<'a>,
    setter_symbol_id: SymbolId,
    state_symbol_id: SymbolId,
    prop_dependency_symbols: &FxHashSet<SymbolId>,
    component_node_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    external_work_nodes.iter().any(|external_work| {
        let candidate = ctx.nodes().get_node(external_work.node_id);
        let Some((is_resource_cancellation, is_dom_state_sync)) =
            no_adjust_external_work_kind(candidate, ctx)
        else {
            return false;
        };
        let Some(work_anchor_id) = no_adjust_work_anchor_in_setter_function(
            candidate,
            &external_work.invocation_path,
            setter_node,
            ctx,
        ) else {
            return false;
        };
        let work_anchor = ctx.nodes().get_node(work_anchor_id);
        no_adjust_span_contains_setter(candidate.span(), setter_symbol_id, ctx)
            || no_adjust_work_reads_all_prop_dependencies(
                candidate,
                prop_dependency_symbols,
                component_node_id,
                ctx,
            )
            || no_adjust_work_reads_all_prop_dependencies(
                work_anchor,
                prop_dependency_symbols,
                component_node_id,
                ctx,
            )
            || external_work.invocation_path.iter().any(|invocation_id| {
                no_adjust_work_reads_all_prop_dependencies(
                    ctx.nodes().get_node(*invocation_id),
                    prop_dependency_symbols,
                    component_node_id,
                    ctx,
                )
            })
            || is_dom_state_sync
                && no_adjust_dom_work_controls_same_state_write(
                    work_anchor,
                    setter_node,
                    setter_symbol_id,
                    ctx,
                )
            || is_resource_cancellation
                && no_adjust_control_region_reads_state(setter_node, state_symbol_id, ctx)
                && node_dominates_node(work_anchor, setter_node, ctx)
            || no_adjust_nodes_share_state_control_region(
                work_anchor,
                setter_node,
                state_symbol_id,
                ctx,
            )
            || no_adjust_invocation_control_reads_state(
                &external_work.invocation_path,
                setter_node,
                state_symbol_id,
                ctx,
            )
    })
}

fn no_adjust_invocation_control_reads_state(
    invocation_path: &[NodeId],
    setter_node: &AstNode<'_>,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(setter_function_id) = no_adjust_nearest_function_node_id(setter_node.id(), ctx) else {
        return false;
    };
    invocation_path.iter().any(|invocation_id| {
        let candidate = ctx.nodes().get_node(*invocation_id);
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return false;
        };
        no_adjust_resolved_callback_function_id(&call_expression.callee, ctx)
            == Some(setter_function_id)
            && no_adjust_control_region_reads_state(candidate, state_symbol_id, ctx)
    })
}

fn no_adjust_collect_external_work_nodes<'a>(
    callback_node_id: NodeId,
    ctx: &LintContext<'a>,
) -> Vec<NoAdjustExternalWork> {
    let mut external_work_nodes = Vec::new();
    let mut pending_functions = vec![(callback_node_id, Vec::new())];
    let mut visited_invocations = FxHashSet::default();
    while let Some((function_id, invocation_path)) = pending_functions.pop() {
        let invocation_id = invocation_path.last().copied();
        if !visited_invocations.insert((function_id, invocation_id)) {
            continue;
        }
        for candidate in ctx.nodes().iter() {
            if no_adjust_nearest_function_node_id(candidate.id(), ctx) != Some(function_id) {
                continue;
            }
            if no_adjust_external_work_kind(candidate, ctx).is_some() {
                external_work_nodes.push(NoAdjustExternalWork {
                    node_id: candidate.id(),
                    invocation_path: invocation_path.clone(),
                });
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                continue;
            };
            if let Some(called_function_id) =
                no_adjust_resolved_callback_function_id(&call.callee, ctx)
            {
                let mut called_invocation_path = invocation_path.clone();
                called_invocation_path.push(candidate.id());
                pending_functions.push((called_function_id, called_invocation_path));
            }
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                continue;
            };
            if !matches!(
                member.static_property_name(),
                Some(
                    "every"
                        | "filter"
                        | "find"
                        | "findIndex"
                        | "flatMap"
                        | "forEach"
                        | "map"
                        | "reduce"
                        | "reduceRight"
                        | "some"
                )
            ) {
                continue;
            }
            for argument in &call.arguments {
                let Some(callback_id) = argument.as_expression().and_then(|expression| {
                    no_adjust_resolved_callback_function_id(expression, ctx)
                }) else {
                    continue;
                };
                let mut iterator_invocation_path = invocation_path.clone();
                iterator_invocation_path.push(candidate.id());
                pending_functions.push((callback_id, iterator_invocation_path));
            }
        }
    }
    external_work_nodes
}

fn no_adjust_for_each_callback_execution_node<'a>(
    root_function_id: NodeId,
    use_state_fact_resolution: bool,
    ctx: &LintContext<'a>,
    mut visitor: impl FnMut(&AstNode<'a>, Option<NodeId>),
) {
    let mut pending_function_ids = vec![(root_function_id, 0usize, None)];
    let mut visited_function_ids = FxHashSet::default();
    while let Some((function_id, call_depth, invocation_id)) = pending_function_ids.pop() {
        if !use_state_fact_resolution && !visited_function_ids.insert(function_id) {
            continue;
        }
        for candidate in ctx.nodes().iter() {
            if no_adjust_nearest_function_node_id(candidate.id(), ctx) != Some(function_id) {
                continue;
            }
            visitor(candidate, invocation_id);
            let AstKind::CallExpression(call) = candidate.kind() else {
                continue;
            };
            let called_function_id = if use_state_fact_resolution {
                no_adjust_state_fact_callback_function_id(&call.callee, ctx)
            } else {
                no_adjust_resolved_callback_function_id(&call.callee, ctx)
            };
            if let Some(called_function_id) = called_function_id
                && (!use_state_fact_resolution
                    || !no_adjust_function_is_async(called_function_id, ctx)
                        && !no_adjust_state_fact_function_invokes_itself(called_function_id, ctx))
                && (!use_state_fact_resolution || call_depth == 0)
            {
                pending_function_ids.push((
                    called_function_id,
                    call_depth + 1,
                    Some(candidate.id()),
                ));
            }
            if use_state_fact_resolution && call_depth != 0 {
                continue;
            }
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                continue;
            };
            if !matches!(
                member.static_property_name(),
                Some(
                    "every"
                        | "filter"
                        | "find"
                        | "findIndex"
                        | "flatMap"
                        | "forEach"
                        | "map"
                        | "reduce"
                        | "reduceRight"
                        | "some"
                )
            ) {
                continue;
            }
            for argument in &call.arguments {
                let Some(callback_expression) = argument.as_expression() else {
                    continue;
                };
                let callback_id = if use_state_fact_resolution {
                    no_adjust_state_fact_callback_function_id(callback_expression, ctx)
                } else {
                    no_adjust_resolved_callback_function_id(callback_expression, ctx)
                };
                let Some(callback_id) = callback_id else {
                    continue;
                };
                if !use_state_fact_resolution
                    || !no_adjust_function_is_async(callback_id, ctx)
                        && !no_adjust_state_fact_function_invokes_itself(callback_id, ctx)
                {
                    pending_function_ids.push((
                        callback_id,
                        call_depth + usize::from(use_state_fact_resolution),
                        Some(candidate.id()),
                    ));
                }
            }
        }
    }
}

fn no_adjust_state_fact_callback_function_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) => Some(function.node_id.get()),
                AstKind::VariableDeclarator(declarator) => {
                    let initializer = declarator.init.as_ref()?.get_inner_expression();
                    if let Some(function_id) =
                        no_adjust_effect_callback_initializer_function_id(initializer)
                    {
                        return Some(function_id);
                    }
                    let Expression::CallExpression(wrapper_call) = initializer else {
                        return None;
                    };
                    if !no_adjust_is_react_use_effect_event_call(wrapper_call, ctx)
                        && !no_adjust_local_use_event_preserves_callback(&wrapper_call.callee, ctx)
                    {
                        return None;
                    }
                    no_adjust_function_expression_node_id(
                        wrapper_call.arguments.first()?.as_expression()?,
                    )
                }
                _ => None,
            }
        }
        expression => {
            let member = expression.as_member_expression()?;
            if member.static_property_name().as_deref() != Some("current") {
                return None;
            }
            let Expression::Identifier(identifier) = member.object().get_inner_expression() else {
                return None;
            };
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if no_adjust_ref_current_is_assigned(symbol_id, ctx) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let Expression::CallExpression(ref_call) =
                declarator.init.as_ref()?.get_inner_expression()
            else {
                return None;
            };
            if no_adjust_call_callee_name(ref_call) != Some("useRef") {
                return None;
            }
            no_adjust_function_expression_node_id(ref_call.arguments.first()?.as_expression()?)
        }
    }
}

fn no_adjust_call_invokes_state_fact_function<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    function_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    no_adjust_state_fact_callback_function_id(&call.callee, ctx) == Some(function_id)
        || call
            .callee
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|member| {
                matches!(
                    member.static_property_name(),
                    Some(
                        "every"
                            | "filter"
                            | "find"
                            | "findIndex"
                            | "flatMap"
                            | "forEach"
                            | "map"
                            | "reduce"
                            | "reduceRight"
                            | "some"
                    )
                ) && call.arguments.iter().any(|argument| {
                    argument.as_expression().is_some_and(|argument| {
                        no_adjust_state_fact_callback_function_id(argument, ctx)
                            == Some(function_id)
                    })
                })
            })
}

fn no_adjust_callee_resolves_to_local_function<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if no_adjust_state_fact_callback_function_id(expression, ctx).is_some() {
        return true;
    }
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
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return false;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(Expression::CallExpression(wrapper_call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Some(wrapper_name) = no_adjust_call_callee_name(wrapper_call) else {
        return false;
    };
    wrapper_name.starts_with("use")
        && wrapper_name
            .as_bytes()
            .get(3)
            .is_some_and(u8::is_ascii_uppercase)
        && wrapper_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(no_adjust_function_expression_node_id)
            .is_some()
}

fn no_adjust_state_fact_function_invokes_itself(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let function_span = ctx.nodes().get_node(function_id).span();
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        if !function_span.contains_inclusive(candidate.span())
            || no_adjust_nearest_function_node_id(candidate.id(), ctx) != Some(function_id)
        {
            return false;
        }
        no_adjust_state_fact_callback_function_id(&call.callee, ctx) == Some(function_id)
    })
}

fn no_adjust_ref_current_is_assigned(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let member_node = ctx.nodes().parent_node(reference_node.id());
            let Some(member) = member_node.kind().as_member_expression_kind() else {
                return false;
            };
            if member.static_property_name().as_deref() != Some("current") {
                return false;
            }
            matches!(ctx.nodes().parent_node(member_node.id()).kind(), AstKind::AssignmentExpression(assignment)
                if assignment.left.span() == member_node.span())
        })
}

fn no_adjust_call_callee_name<'node, 'ast>(
    call: &'node oxc_ast::ast::CallExpression<'ast>,
) -> Option<&'node str> {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(|member| member.static_property_name()),
    }
}

fn no_adjust_is_react_use_effect_event_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            if identifier.name != "useEffectEvent" {
                return false;
            }
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return true;
            };
            ctx.module_record().import_entries.iter().any(|entry| {
                !entry.is_type
                    && entry.module_request.name() == "react"
                    && ctx
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == Some(symbol_id)
                    && matches!(&entry.import_name, ImportImportName::Name(name)
                        if name.name() == "useEffectEvent")
            })
        }
        expression => expression
            .as_member_expression()
            .is_some_and(|member| {
                member.static_property_name() == Some("useEffectEvent")
                    && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                        if identifier.name == "React")
            }),
    }
}

fn no_adjust_local_use_event_preserves_callback(
    callee: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = callee.get_inner_expression() else {
        return false;
    };
    if !matches!(identifier.name.as_str(), "useEvent" | "useEventCallback") {
        return false;
    }
    let Some(implementation_id) = no_adjust_effect_callback_function_id(callee, ctx) else {
        return false;
    };
    let implementation = ctx.nodes().get_node(implementation_id);
    let callback_symbol_id = match implementation.kind() {
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
    };
    let Some(callback_symbol_id) = callback_symbol_id else {
        return false;
    };
    let callback_ref_symbol_ids = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
                return None;
            };
            if !implementation.span().contains_inclusive(candidate.span())
                || no_adjust_nearest_function_node_id(candidate.id(), ctx)
                    != Some(implementation_id)
            {
                return None;
            }
            let BindingPattern::BindingIdentifier(ref_binding) = &declarator.id else {
                return None;
            };
            let Expression::CallExpression(ref_call) =
                declarator.init.as_ref()?.get_inner_expression()
            else {
                return None;
            };
            if no_adjust_call_callee_name(ref_call) != Some("useRef") {
                return None;
            }
            let Expression::Identifier(initializer) = ref_call
                .arguments
                .first()
                .and_then(Argument::as_expression)?
                .get_inner_expression()
            else {
                return None;
            };
            (ctx.scoping()
                .get_reference(initializer.reference_id())
                .symbol_id()
                == Some(callback_symbol_id))
            .then(|| ref_binding.symbol_id())
        })
        .collect::<FxHashSet<_>>();
    if callback_ref_symbol_ids.is_empty() {
        return false;
    }

    let mut preserves_callback = false;
    no_adjust_for_each_returned_expression(implementation_id, ctx, |returned_expression| {
        if preserves_callback {
            return;
        }
        let Expression::CallExpression(wrapper_call) = returned_expression.get_inner_expression()
        else {
            return;
        };
        if !matches!(
            no_adjust_call_callee_name(wrapper_call),
            Some("useCallback" | "useEffectEvent")
        ) {
            return;
        }
        let Some(stable_callback) = wrapper_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let Some(stable_callback_id) = no_adjust_function_expression_node_id(stable_callback)
        else {
            return;
        };
        let stable_callback_span = ctx.nodes().get_node(stable_callback_id).span();
        preserves_callback = ctx.nodes().iter().any(|candidate| {
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            if !stable_callback_span.contains_inclusive(candidate.span())
                || no_adjust_nearest_function_node_id(candidate.id(), ctx)
                    != Some(stable_callback_id)
            {
                return false;
            }
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            if member.static_property_name().as_deref() != Some("current") {
                return false;
            }
            let Expression::Identifier(ref_identifier) = member.object().get_inner_expression()
            else {
                return false;
            };
            let Some(ref_symbol_id) = ctx
                .scoping()
                .get_reference(ref_identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            callback_ref_symbol_ids.contains(&ref_symbol_id)
                && !no_adjust_ref_has_non_forwarding_assignment(
                    ref_symbol_id,
                    callback_symbol_id,
                    ctx,
                )
        });
    });
    preserves_callback
}

fn no_adjust_ref_has_non_forwarding_assignment(
    ref_symbol_id: SymbolId,
    callback_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(ref_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let member_node = ctx.nodes().parent_node(reference_node.id());
            let Some(member) = member_node.kind().as_member_expression_kind() else {
                return false;
            };
            if member.static_property_name().as_deref() != Some("current") {
                return false;
            }
            let assignment_node = ctx.nodes().parent_node(member_node.id());
            let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
                return false;
            };
            if assignment.left.span() != member_node.span() {
                return false;
            }
            let Expression::Identifier(right_identifier) = assignment.right.get_inner_expression()
            else {
                return true;
            };
            ctx.scoping()
                .get_reference(right_identifier.reference_id())
                .symbol_id()
                != Some(callback_symbol_id)
        })
}

fn no_adjust_resolved_callback_function_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    let (_, function_span) = resolve_local_react_callback(expression, ctx)?;
    ctx.nodes().iter().find_map(|candidate| {
        (candidate.span() == function_span
            && matches!(
                candidate.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ))
        .then_some(candidate.id())
    })
}

fn no_adjust_external_work_kind<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<(bool, bool)> {
    match node.kind() {
        AstKind::AssignmentExpression(assignment) => assignment
            .left
            .as_member_expression()
            .and_then(|member| member.static_property_name())
            .is_some_and(|property_name| {
                property_name.starts_with("on")
                    && matches!(
                        assignment.right.get_inner_expression(),
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    )
            })
            .then_some((false, false)),
        AstKind::NewExpression(new_expression) => matches!(
            new_expression.callee.get_inner_expression(),
            Expression::Identifier(identifier)
                if NO_ADJUST_OBSERVER_CONSTRUCTORS.contains(&identifier.name.as_str())
                    && no_adjust_identifier_is_global(identifier, ctx)
        )
        .then_some((false, false)),
        AstKind::CallExpression(call_expression) => {
            let callee = call_expression.callee.get_inner_expression();
            if let Some(is_resource_cancellation) =
                no_adjust_timer_operation_is_cleanup(callee, ctx, &mut FxHashSet::default())
            {
                return Some((is_resource_cancellation, false));
            }
            if no_adjust_is_fetch_call(call_expression) {
                return Some((false, false));
            }
            if resolve_local_react_callback(callee, ctx).is_some_and(|(is_async, _)| is_async) {
                return Some((false, false));
            }
            if no_adjust_is_imported_external_dom_sync_call(call_expression, ctx) {
                return Some((false, true));
            }
            match callee {
                expression => {
                    let member = expression.as_member_expression()?;
                    let property_name = member.static_property_name()?;
                    let is_dom_state_sync = NO_ADJUST_EXTERNAL_DOM_MEMBER_CALLS
                        .contains(&property_name)
                        && no_adjust_expression_is_dom_receiver(
                            member.object(),
                            ctx,
                            &mut Vec::new(),
                        );
                    (is_dom_state_sync
                        || NO_ADJUST_SUBSCRIPTION_MEMBER_CALLS.contains(&property_name)
                        || NO_ADJUST_DEFERRED_MEMBER_CALLS.contains(&property_name))
                    .then_some((false, is_dom_state_sync))
                }
            }
        }
        _ => None,
    }
}

fn no_adjust_is_imported_external_dom_sync_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let Some(import_entry) = ctx.module_record().import_entries.iter().find(|entry| {
        !entry.is_type
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    }) else {
        return false;
    };
    let exported_name = match &import_entry.import_name {
        ImportImportName::Name(name) => name.name(),
        ImportImportName::Default(_) => "default",
        ImportImportName::NamespaceObject => return false,
    };
    let Some(file_path) = no_adjust_resolve_first_party_module_path(
        ctx.file_path(),
        import_entry.module_request.name(),
    ) else {
        return false;
    };
    no_adjust_foreign_export_has_external_dom_sync(&file_path, exported_name, 0)
}

fn no_adjust_resolve_first_party_module_path(
    from_file_path: &Path,
    module_source: &str,
) -> Option<PathBuf> {
    if Path::new(module_source).is_absolute() {
        return None;
    }
    let resolver = Resolver::new(ResolveOptions {
        extensions: VALID_EXTENSIONS
            .iter()
            .map(|extension| format!(".{extension}"))
            .collect(),
        main_fields: vec!["module".into(), "main".into()],
        condition_names: vec!["module".into(), "import".into()],
        extension_alias: vec![
            (".js".into(), vec![".js".into(), ".ts".into()]),
            (".mjs".into(), vec![".mjs".into(), ".mts".into()]),
            (".cjs".into(), vec![".cjs".into(), ".cts".into()]),
        ],
        tsconfig: Some(TsconfigDiscovery::Auto),
        ..ResolveOptions::default()
    });
    let resolved_path = resolver
        .resolve_file(from_file_path, module_source)
        .ok()?
        .path()
        .to_path_buf();
    (!resolved_path
        .components()
        .any(|component| component.as_os_str() == "node_modules"))
    .then_some(resolved_path)
}

fn no_adjust_foreign_export_has_external_dom_sync(
    file_path: &Path,
    exported_name: &str,
    depth: usize,
) -> bool {
    if depth >= NO_ADJUST_CROSS_FILE_EXPORT_DEPTH {
        return false;
    }
    let Ok(source_text) = std::fs::read_to_string(file_path) else {
        return false;
    };
    let mut source_hasher = std::collections::hash_map::DefaultHasher::new();
    source_text.hash(&mut source_hasher);
    let cache = NO_ADJUST_IMPORTED_DOM_SYNC_CACHE.get_or_init(Default::default);
    let cache_key = (
        file_path.to_path_buf(),
        exported_name.to_string(),
        depth,
        source_hasher.finish(),
    );
    if let Some(result) = cache
        .lock()
        .ok()
        .and_then(|results| results.get(&cache_key).copied())
    {
        return result;
    }
    let Some((result, is_cacheable)) = no_adjust_analyze_foreign_export(
        file_path,
        exported_name,
        depth,
        &source_text,
        &mut FxHashSet::default(),
    ) else {
        return false;
    };
    if is_cacheable && let Ok(mut results) = cache.lock() {
        results.insert(cache_key, result);
    }
    result
}

fn no_adjust_analyze_foreign_export(
    file_path: &Path,
    exported_name: &str,
    depth: usize,
    source_text: &str,
    visited_paths: &mut FxHashSet<PathBuf>,
) -> Option<(bool, bool)> {
    if depth >= NO_ADJUST_CROSS_FILE_EXPORT_DEPTH {
        return None;
    }
    let canonical_path = std::fs::canonicalize(file_path).ok()?;
    if !visited_paths.insert(canonical_path) {
        return None;
    }
    let Ok(source_type) = SourceType::from_path(file_path) else {
        return None;
    };
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, source_text, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = SemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return None;
    }
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(file_path, &parser_return.module_record, &semantic);
    if let Some(function_id) =
        no_adjust_foreign_exported_function_id(exported_name, &semantic, &module_record)
    {
        return Some((
            no_adjust_foreign_function_has_external_dom_sync(function_id, &semantic),
            true,
        ));
    }
    let has_type_only_reexport = program.body.iter().any(|statement| {
        matches!(statement,
        oxc_ast::ast::Statement::ExportFromDeclaration(declaration)
            if declaration.specifiers.iter().any(|specifier| {
                specifier.exported.name().as_str() == exported_name
                    && (declaration.export_kind.is_type()
                        || specifier.export_kind.is_type())
            }))
    });
    if !has_type_only_reexport
        && let Some((module_source, imported_name)) =
            no_adjust_foreign_reexport_target(exported_name, &module_record)
    {
        let reexported_path = no_adjust_resolve_first_party_module_path(file_path, module_source)?;
        let reexported_source = std::fs::read_to_string(&reexported_path).ok()?;
        return no_adjust_analyze_foreign_export(
            &reexported_path,
            imported_name,
            depth + 1,
            &reexported_source,
            visited_paths,
        )
        .map(|(result, _)| (result, false));
    }
    let mut unique_star_result = None;
    for statement in &program.body {
        let oxc_ast::ast::Statement::ExportAllDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.export_kind.is_type() || declaration.exported.is_some() {
            continue;
        }
        let Some(reexported_path) =
            no_adjust_resolve_first_party_module_path(file_path, declaration.source.value.as_str())
        else {
            continue;
        };
        let Ok(reexported_source) = std::fs::read_to_string(&reexported_path) else {
            continue;
        };
        let Some((candidate, _)) = no_adjust_analyze_foreign_export(
            &reexported_path,
            exported_name,
            depth + 1,
            &reexported_source,
            &mut visited_paths.clone(),
        ) else {
            continue;
        };
        if unique_star_result.is_some() {
            return None;
        }
        unique_star_result = Some((candidate, false));
    }
    unique_star_result
}

fn no_adjust_foreign_exported_function_id(
    exported_name: &str,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> Option<NodeId> {
    if let Some(local_name) = module_record.local_export_entries.iter().find_map(|entry| {
        let matches_export = match &entry.export_name {
            ExportExportName::Name(name) => name.name() == exported_name,
            ExportExportName::Default(_) => exported_name == "default",
            ExportExportName::Null => false,
        };
        matches_export.then(|| entry.local_name.name()).flatten()
    }) && let Some(function_id) =
        no_adjust_foreign_function_implementation_id(local_name, semantic)
    {
        return Some(function_id);
    } else if let Some(local_name) = module_record.local_export_entries.iter().find_map(|entry| {
        let matches_export = match &entry.export_name {
            ExportExportName::Name(name) => name.name() == exported_name,
            ExportExportName::Default(_) => exported_name == "default",
            ExportExportName::Null => false,
        };
        matches_export.then(|| entry.local_name.name()).flatten()
    }) && let Some(symbol_id) = semantic.scoping().get_root_binding(local_name.into())
        && !semantic
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| reference.is_write())
    {
        let declaration = semantic.symbol_declaration(symbol_id);
        match declaration.kind() {
            AstKind::Function(function) if function.body.is_some() => {
                return Some(declaration.id());
            }
            AstKind::VariableDeclarator(declarator) if matches!(semantic.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const()) =>
            {
                return match declarator.init.as_ref()?.get_inner_expression() {
                    Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                    Expression::FunctionExpression(function) => Some(function.node_id.get()),
                    _ => None,
                };
            }
            _ => {}
        }
    }
    if exported_name != "default" {
        return None;
    }
    semantic.nodes().iter().find_map(|node| {
        let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
            return None;
        };
        match &declaration.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                function.body.as_ref().map(|_| function.node_id.get())
            }
            ExportDefaultDeclarationKind::ArrowFunctionExpression(function) => {
                Some(function.node_id.get())
            }
            _ => None,
        }
    })
}

fn no_adjust_foreign_function_implementation_id(
    function_name: &str,
    semantic: &Semantic<'_>,
) -> Option<NodeId> {
    semantic.nodes().iter().find_map(|node| {
        let AstKind::Function(function) = node.kind() else {
            return None;
        };
        (function.body.is_some()
            && function
                .id
                .as_ref()
                .is_some_and(|identifier| identifier.name == function_name)
            && semantic
                .nodes()
                .ancestors(node.id())
                .skip(1)
                .all(|ancestor| {
                    !matches!(
                        ancestor.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    )
                }))
        .then_some(node.id())
    })
}

fn no_adjust_foreign_reexport_target<'a>(
    exported_name: &str,
    module_record: &'a ModuleRecord,
) -> Option<(&'a str, &'a str)> {
    module_record
        .indirect_export_entries
        .iter()
        .find_map(|entry| {
            let candidate_export = match &entry.export_name {
                ExportExportName::Name(name) => name.name(),
                ExportExportName::Default(_) => "default",
                ExportExportName::Null => return None,
            };
            if candidate_export != exported_name {
                return None;
            }
            let module_source = entry.module_request.as_ref()?.name();
            let imported_name = match &entry.import_name {
                ExportImportName::Name(name) => name.name(),
                _ => return None,
            };
            Some((module_source, imported_name))
        })
}

fn no_adjust_foreign_function_has_external_dom_sync(
    function_id: NodeId,
    semantic: &Semantic<'_>,
) -> bool {
    semantic.nodes().iter().any(|node| {
        if no_adjust_foreign_enclosing_function_id(node, semantic) != Some(function_id) {
            return false;
        }
        let AstKind::CallExpression(call) = node.kind() else {
            return false;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            return false;
        };
        member.static_property_name().is_some_and(|property_name| {
            NO_ADJUST_EXTERNAL_DOM_MEMBER_CALLS.contains(&property_name)
                && no_adjust_foreign_expression_is_dom_receiver(
                    member.object(),
                    semantic,
                    &mut FxHashSet::default(),
                )
        })
    })
}

fn no_adjust_foreign_enclosing_function_id(
    node: &AstNode<'_>,
    semantic: &Semantic<'_>,
) -> Option<NodeId> {
    semantic.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn no_adjust_foreign_expression_is_dom_receiver<'a>(
    expression: &Expression<'a>,
    semantic: &Semantic<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            if matches!(identifier.name.as_str(), "document" | "window")
                && semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
            {
                return true;
            }
            let Some(symbol_id) = semantic
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            let declaration = semantic.symbol_declaration(symbol_id);
            let is_dom_receiver = matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
            if matches!(semantic.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                && declarator.init.as_ref().is_some_and(|initializer| {
                    no_adjust_foreign_expression_is_dom_receiver(
                        initializer,
                        semantic,
                        visited_symbol_ids,
                    )
                }));
            visited_symbol_ids.remove(&symbol_id);
            is_dom_receiver
        }
        Expression::StaticMemberExpression(member) => {
            matches!(
                member.property.name.as_str(),
                "activeElement"
                    | "body"
                    | "documentElement"
                    | "firstElementChild"
                    | "lastElementChild"
                    | "ownerDocument"
                    | "parentElement"
                    | "parentNode"
                    | "shadowRoot"
            ) && no_adjust_foreign_expression_is_dom_receiver(
                &member.object,
                semantic,
                visited_symbol_ids,
            )
        }
        Expression::ComputedMemberExpression(member) => {
            member.static_property_name().is_some_and(|property_name| {
                matches!(
                    property_name.as_ref(),
                    "activeElement"
                        | "body"
                        | "documentElement"
                        | "firstElementChild"
                        | "lastElementChild"
                        | "ownerDocument"
                        | "parentElement"
                        | "parentNode"
                        | "shadowRoot"
                ) && no_adjust_foreign_expression_is_dom_receiver(
                    &member.object,
                    semantic,
                    visited_symbol_ids,
                )
            })
        }
        Expression::CallExpression(call) => {
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            matches!(
                member.static_property_name(),
                Some(
                    "cloneNode"
                        | "closest"
                        | "createElement"
                        | "createElementNS"
                        | "elementFromPoint"
                        | "getElementById"
                        | "getRootNode"
                        | "querySelector"
                )
            ) && no_adjust_foreign_expression_is_dom_receiver(
                member.object(),
                semantic,
                visited_symbol_ids,
            )
        }
        Expression::NewExpression(new_expression) => matches!(
            new_expression.callee.get_inner_expression(),
            Expression::Identifier(identifier)
                if matches!(
                    identifier.name.as_str(),
                    "DocumentFragment" | "EventTarget" | "Image" | "Option"
                ) && semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        ),
        Expression::ConditionalExpression(conditional) => {
            let branches = [&conditional.consequent, &conditional.alternate];
            let mut non_nullish_branch_count = 0;
            branches.into_iter().all(|branch| {
                if no_adjust_foreign_expression_is_nullish(branch, semantic) {
                    return true;
                }
                non_nullish_branch_count += 1;
                no_adjust_foreign_expression_is_dom_receiver(
                    branch,
                    semantic,
                    &mut visited_symbol_ids.clone(),
                )
            }) && non_nullish_branch_count > 0
        }
        _ => false,
    }
}

fn no_adjust_foreign_expression_is_nullish(
    expression: &Expression<'_>,
    semantic: &Semantic<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::NullLiteral(_)
    ) || matches!(
        expression.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == "undefined"
                && semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
    )
}

fn no_adjust_is_fetch_call(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    let callee = call.callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        return NO_ADJUST_FETCH_DIRECT_CALLS.contains(&identifier.name.as_str());
    }
    let Some(member) = callee.as_member_expression() else {
        return false;
    };
    matches!(
        member.object().get_inner_expression(),
        Expression::Identifier(identifier)
            if NO_ADJUST_FETCH_MEMBER_OBJECTS.contains(&identifier.name.as_str())
    )
}

fn no_adjust_timer_operation_is_cleanup<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<bool> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        if no_adjust_identifier_is_global(identifier, ctx)
            && NO_ADJUST_TIMER_DIRECT_CALLS.contains(&identifier.name.as_str())
        {
            return Some(NO_ADJUST_TIMER_CLEANUP_CALLS.contains(&identifier.name.as_str()));
        }
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        if !visited_symbol_ids.insert(symbol_id) {
            return None;
        }
        if let Some(operation_name) = no_adjust_imported_timeout_hook_operation(symbol_id, ctx) {
            return Some(NO_ADJUST_TIMER_CLEANUP_CALLS.contains(&operation_name.as_str()));
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
        return no_adjust_timer_operation_is_cleanup(
            declarator.init.as_ref()?,
            ctx,
            visited_symbol_ids,
        );
    }
    let member = expression.as_member_expression()?;
    let property_name = member.static_property_name()?;
    if !NO_ADJUST_TIMER_DIRECT_CALLS.contains(&property_name) {
        return None;
    }
    let Expression::Identifier(namespace) = member.object().get_inner_expression() else {
        return None;
    };
    (NO_ADJUST_GLOBAL_NAMESPACE_NAMES.contains(&namespace.name.as_str())
        && no_adjust_identifier_is_global(namespace, ctx))
    .then_some(NO_ADJUST_TIMER_CLEANUP_CALLS.contains(&property_name))
}

fn no_adjust_imported_timeout_hook_operation(
    operation_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let declaration = ctx.symbol_declaration(operation_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable) if variable.kind.is_const()
    ) {
        return None;
    }
    let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return None;
    };
    let operation_name = binding_property_name_for_symbol(&declarator.id, operation_symbol_id)?;
    if !matches!(operation_name.as_str(), "setTimeout" | "clearTimeout") {
        return None;
    }
    let paired_name = if operation_name == "setTimeout" {
        "clearTimeout"
    } else {
        "setTimeout"
    };
    if !pattern
        .properties
        .iter()
        .any(|property| property.key.static_name().as_deref() == Some(paired_name))
    {
        return None;
    }
    let Expression::CallExpression(hook_call) = declarator.init.as_ref()?.get_inner_expression()
    else {
        return None;
    };
    let Expression::Identifier(hook_identifier) = hook_call.callee.get_inner_expression() else {
        return None;
    };
    let hook_symbol_id = ctx
        .scoping()
        .get_reference(hook_identifier.reference_id())
        .symbol_id()?;
    ctx.module_record()
        .import_entries
        .iter()
        .any(|entry| {
            !entry.is_type
                && ctx
                    .scoping()
                    .get_root_binding(entry.local_name.name().into())
                    == Some(hook_symbol_id)
                && matches!(
                    &entry.import_name,
                    crate::module_record::ImportImportName::Name(imported_name)
                        if imported_name.name() == "useTimeouts"
                )
        })
        .then_some(operation_name)
}

fn no_adjust_work_anchor_in_setter_function(
    work_node: &AstNode<'_>,
    invocation_path: &[NodeId],
    setter_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let setter_function_id = no_adjust_nearest_function_node_id(setter_node.id(), ctx)?;
    let work_function_id = no_adjust_nearest_function_node_id(work_node.id(), ctx)?;
    if setter_function_id == work_function_id {
        return Some(work_node.id());
    }
    invocation_path.iter().rev().copied().find(|invocation_id| {
        no_adjust_nearest_function_node_id(*invocation_id, ctx) == Some(setter_function_id)
    })
}

fn no_adjust_span_contains_setter(
    span: oxc_span::Span,
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(setter_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if !span.contains_inclusive(reference_node.span()) {
                return false;
            }
            matches!(ctx.nodes().parent_node(reference_node.id()).kind(), AstKind::CallExpression(call)
                if call.callee.span() == reference_node.span())
        })
}

fn no_adjust_work_reads_all_prop_dependencies(
    work_node: &AstNode<'_>,
    prop_dependency_symbols: &FxHashSet<SymbolId>,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if prop_dependency_symbols.is_empty() {
        return false;
    }
    let mut work_prop_symbols = FxHashSet::default();
    no_adjust_collect_prop_source_symbols_in_span(
        work_node.span(),
        component_node_id,
        ctx,
        &mut Vec::new(),
        &mut work_prop_symbols,
    );
    prop_dependency_symbols.is_subset(&work_prop_symbols)
}

fn no_adjust_dom_work_controls_same_state_write<'a>(
    work_node: &AstNode<'a>,
    setter_node: &AstNode<'a>,
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    if setter_node.span().contains_inclusive(work_node.span()) {
        return true;
    }
    let Some(function_id) = no_adjust_nearest_function_node_id(setter_node.id(), ctx) else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(setter_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let call_node = ctx.nodes().parent_node(reference_node.id());
            no_adjust_nearest_function_node_id(reference_node.id(), ctx) == Some(function_id)
                && matches!(call_node.kind(), AstKind::CallExpression(call)
                    if call.callee.span() == reference_node.span())
                && node_dominates_node(work_node, call_node, ctx)
        })
}

fn no_adjust_nodes_share_state_control_region(
    work_node: &AstNode<'_>,
    setter_node: &AstNode<'_>,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(work_region) = no_adjust_control_region(work_node, ctx) else {
        return false;
    };
    no_adjust_control_region(setter_node, ctx) == Some(work_region)
        && no_adjust_control_region_reads_symbol(work_region.0, state_symbol_id, ctx)
}

fn no_adjust_control_region_reads_state(
    setter_node: &AstNode<'_>,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    no_adjust_control_region(setter_node, ctx).is_some_and(|(control_node_id, _)| {
        no_adjust_control_region_reads_symbol(control_node_id, state_symbol_id, ctx)
    })
}

fn no_adjust_control_region(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<(NodeId, u8)> {
    let node_span = node.span();
    let owner_function_id = no_adjust_nearest_function_node_id(node.id(), ctx);
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if Some(ancestor.id()) == owner_function_id {
            break;
        }
        match ancestor.kind() {
            AstKind::IfStatement(statement) => {
                if statement.consequent.span().contains_inclusive(node_span) {
                    return Some((ancestor.id(), 0));
                }
                if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(node_span))
                {
                    return Some((ancestor.id(), 1));
                }
            }
            AstKind::ConditionalExpression(expression) => {
                if expression.consequent.span().contains_inclusive(node_span) {
                    return Some((ancestor.id(), 0));
                }
                if expression.alternate.span().contains_inclusive(node_span) {
                    return Some((ancestor.id(), 1));
                }
            }
            AstKind::LogicalExpression(expression)
                if expression.right.span().contains_inclusive(node_span) =>
            {
                return Some((ancestor.id(), 0));
            }
            _ => {}
        }
    }
    None
}

fn no_adjust_control_region_reads_symbol(
    control_node_id: NodeId,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    if !no_adjust_symbol_is_state_value(state_symbol_id, ctx) {
        return false;
    }
    let control_node = ctx.nodes().get_node(control_node_id);
    let control_function_id = no_adjust_nearest_function_node_id(control_node_id, ctx);
    let condition_span = match ctx.nodes().get_node(control_node_id).kind() {
        AstKind::IfStatement(statement) => statement.test.span(),
        AstKind::ConditionalExpression(expression) => expression.test.span(),
        AstKind::LogicalExpression(expression) => expression.left.span(),
        _ => return false,
    };
    ctx.scoping()
        .get_resolved_references(state_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if !condition_span.contains_inclusive(reference_node.span())
                || no_adjust_is_inside_statically_unreachable_branch(reference_node, ctx)
            {
                return false;
            }
            let reference_function_id =
                no_adjust_nearest_function_node_id(reference.node_id(), ctx);
            reference_function_id == control_function_id
                || reference_function_id.is_some_and(|function_id| {
                    no_adjust_condition_callback_executes_synchronously(
                        function_id,
                        condition_span,
                        control_node,
                        ctx,
                    )
                })
        })
}

fn no_adjust_control_region_reads_written_state(
    control_node_id: NodeId,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    if no_adjust_control_region_reads_symbol(control_node_id, state_symbol_id, ctx) {
        return true;
    }
    if !no_adjust_symbol_is_state_value(state_symbol_id, ctx) {
        return false;
    }
    let control_node = ctx.nodes().get_node(control_node_id);
    let Some(function_id) = no_adjust_nearest_function_node_id(control_node_id, ctx) else {
        return false;
    };
    let component_node_id =
        no_adjust_nearest_function_node_id(function_id, ctx).unwrap_or(function_id);
    let condition_span = match control_node.kind() {
        AstKind::IfStatement(statement) => statement.test.span(),
        AstKind::ConditionalExpression(expression) => expression.test.span(),
        AstKind::LogicalExpression(expression) => expression.left.span(),
        _ => return false,
    };
    ctx.nodes().iter().any(|candidate| {
        let Some(member) = candidate.kind().as_member_expression_kind() else {
            return false;
        };
        if member.static_property_name().as_deref() != Some("current")
            || !condition_span.contains_inclusive(candidate.span())
            || no_adjust_is_inside_statically_unreachable_branch(candidate, ctx)
            || !no_adjust_expression_is_ref_value(member.object(), ctx)
        {
            return false;
        }
        let reference_function_id = no_adjust_nearest_function_node_id(candidate.id(), ctx);
        if reference_function_id != Some(function_id)
            && !reference_function_id.is_some_and(|callback_id| {
                no_adjust_condition_callback_executes_synchronously(
                    callback_id,
                    condition_span,
                    control_node,
                    ctx,
                )
            })
        {
            return false;
        }
        if !no_adjust_ref_current_is_render_known(
            member.object(),
            component_node_id,
            ctx,
            &mut Vec::new(),
            &FxHashMap::default(),
            1,
        ) {
            return false;
        }
        let Some((ref_symbol_id, values)) = no_adjust_ref_current_values(member.object(), ctx) else {
            return false;
        };
        let mut state_sources = FxHashSet::default();
        values.into_iter().all(|value| {
            no_adjust_collect_value_state_sources(
                value,
                ctx,
                &mut vec![ref_symbol_id],
                &FxHashMap::default(),
                1,
                &mut state_sources,
            )
        }) && state_sources.len() == 1
            && state_sources.contains(&state_symbol_id)
    })
}

fn no_adjust_collect_value_state_sources<'node, 'ast>(
    expression: &Expression<'ast>,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    substitutions: &FxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
    state_sources: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression_span = expression.span();
    for candidate in ctx.nodes().iter() {
        if !expression_span.contains_inclusive(candidate.span())
            || no_adjust_is_inside_ignored_pure_callback(candidate.id(), expression_span, ctx)
            || no_adjust_identifier_is_inside_opaque_value_call(candidate, expression_span, ctx)
        {
            continue;
        }
        if let AstKind::CallExpression(call) = candidate.kind()
            && !no_adjust_is_pure_call(call, ctx)
        {
            if remaining_call_frames == 0 {
                return false;
            }
            let Some(function_id) = no_adjust_state_fact_callback_function_id(&call.callee, ctx)
            else {
                return false;
            };
            let parameters = match ctx.nodes().get_node(function_id).kind() {
                AstKind::Function(function) => &function.params,
                AstKind::ArrowFunctionExpression(function) => &function.params,
                _ => return false,
            };
            let mut helper_substitutions = substitutions.clone();
            for (parameter, argument) in parameters.items.iter().zip(&call.arguments) {
                if let (Some(identifier), Some(argument)) = (
                    parameter.pattern.get_binding_identifier(),
                    argument.as_expression(),
                ) {
                    helper_substitutions.insert(identifier.symbol_id(), argument);
                }
            }
            let mut has_return = false;
            let mut all_returns_known = true;
            no_adjust_for_each_returned_expression(function_id, ctx, |returned_expression| {
                has_return = true;
                all_returns_known &= no_adjust_collect_value_state_sources(
                    returned_expression,
                    ctx,
                    visited_symbol_ids,
                    &helper_substitutions,
                    remaining_call_frames - 1,
                    state_sources,
                );
            });
            if !has_return || !all_returns_known {
                return false;
            }
            continue;
        }
        if let Some(member) = candidate.kind().as_member_expression_kind()
            && member.static_property_name().as_deref() == Some("current")
            && no_adjust_expression_is_ref_value(member.object(), ctx)
        {
            let Some((symbol_id, values)) = no_adjust_ref_current_values(member.object(), ctx)
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            let are_known = values.into_iter().all(|value| {
                no_adjust_collect_value_state_sources(
                    value, ctx, visited_symbol_ids, substitutions, remaining_call_frames, state_sources,
                )
            });
            visited_symbol_ids.pop();
            if !are_known {
                return false;
            }
            continue;
        }
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            continue;
        };
        let reference = ctx.scoping().get_reference(identifier.reference_id());
        let Some(symbol_id) = reference.symbol_id() else {
            continue;
        };
        if reference.is_type()
            || no_adjust_identifier_is_ref_current_object(candidate, symbol_id, ctx)
        {
            continue;
        }
        if let Some(substitution) = substitutions.get(&symbol_id) {
            if !no_adjust_collect_value_state_sources(
                substitution, ctx, visited_symbol_ids, substitutions, remaining_call_frames, state_sources,
            ) {
                return false;
            }
        } else if no_adjust_symbol_is_state_value(symbol_id, ctx) {
            state_sources.insert(symbol_id);
        } else if let Some(value) = no_adjust_symbol_value_expression(symbol_id, ctx) {
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            let is_known = no_adjust_collect_value_state_sources(
                value, ctx, visited_symbol_ids, substitutions, remaining_call_frames, state_sources,
            );
            visited_symbol_ids.pop();
            if !is_known {
                return false;
            }
        }
    }
    true
}

fn no_adjust_condition_callback_executes_synchronously(
    function_id: NodeId,
    condition_span: oxc_span::Span,
    control_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    if !condition_span.contains_inclusive(function_node.span())
        || no_adjust_function_is_async(function_id, ctx)
        || matches!(function_node.kind(), AstKind::Function(function) if function.generator)
    {
        return false;
    }
    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    if call.callee.span() == function_root.span() {
        return true;
    }
    let Some(callback_expression) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    if !no_adjust_iterator_callback_executes_synchronously(call, callback_expression, ctx)
        || callback_expression.span() != function_root.span()
    {
        return false;
    }
    condition_span.contains_inclusive(parent.span())
        && control_node.span().contains_inclusive(parent.span())
}

fn no_adjust_iterator_callback_executes_synchronously<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    callback_expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if no_adjust_is_synchronous_iterator_callback(call_expression, callback_expression, ctx) {
        return true;
    }
    let Some(member) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if !matches!(
        member.static_property_name(),
        Some(
            "every" | "filter" | "flatMap" | "forEach" | "map" | "reduce" | "reduceRight" | "some"
        )
    ) || call_expression
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .is_none_or(|argument| argument.span() != callback_expression.span())
    {
        return false;
    }
    no_adjust_expression_is_proven_memoized_array_receiver(member.object(), ctx, &mut Vec::new())
}

fn no_adjust_is_synchronous_iterator_callback<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    callback_expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let Some(method_name) = member.static_property_name() else {
        return false;
    };
    let argument_matches = |argument: Option<&Argument<'a>>, expected: oxc_span::Span| {
        argument
            .and_then(Argument::as_expression)
            .is_some_and(|expression| expression.span() == expected)
    };
    if method_name == "from"
        && no_adjust_expression_is_global_identifier(member.object(), "Array", ctx)
        && argument_matches(call_expression.arguments.get(1), callback_expression.span())
    {
        return call_expression
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|source| {
                !no_adjust_expression_is_provably_empty_eager_collection(
                    source,
                    ctx,
                    &mut Vec::new(),
                )
            });
    }
    if !NO_ADJUST_EAGER_ITERATOR_METHODS.contains(&method_name)
        || !argument_matches(
            call_expression.arguments.first(),
            callback_expression.span(),
        )
        || no_adjust_expression_is_provably_empty_eager_collection(
            member.object(),
            ctx,
            &mut Vec::new(),
        )
    {
        return false;
    }
    if method_name == "forEach" {
        no_adjust_expression_is_provably_eager_foreach_collection(
            member.object(),
            ctx,
            &mut Vec::new(),
        )
    } else {
        no_adjust_expression_is_provably_eager_collection(member.object(), ctx, &mut Vec::new())
    }
}

fn no_adjust_expression_is_provably_empty_eager_collection<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(array) => array.elements.is_empty(),
        Expression::NewExpression(new_expression) => {
            new_expression.arguments.is_empty()
                && no_adjust_global_constructor_matches(
                    &new_expression.callee,
                    &NO_ADJUST_EAGER_FOREACH_COLLECTION_CONSTRUCTORS,
                    ctx,
                )
        }
        Expression::CallExpression(call_expression) => {
            let Some(member) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                return false;
            };
            let Some(method_name) = member.static_property_name() else {
                return false;
            };
            if no_adjust_expression_is_global_identifier(member.object(), "Array", ctx)
                && matches!(method_name, "from" | "of")
            {
                if method_name == "of" {
                    return call_expression.arguments.is_empty();
                }
                return call_expression
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|source| {
                        no_adjust_expression_is_provably_empty_eager_collection(
                            source,
                            ctx,
                            visited_symbol_ids,
                        )
                    });
            }
            method_name != "concat"
                && NO_ADJUST_ARRAY_RETURNING_METHODS.contains(&method_name)
                && no_adjust_expression_is_provably_empty_eager_collection(
                    member.object(),
                    ctx,
                    visited_symbol_ids,
                )
        }
        Expression::Identifier(identifier) => {
            let Some((symbol_id, initializer)) =
                no_adjust_read_only_const_identifier_initializer(identifier, ctx)
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            no_adjust_expression_is_provably_empty_eager_collection(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => false,
    }
}

fn no_adjust_expression_is_provably_eager_collection<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(_) => true,
        Expression::NewExpression(new_expression) => no_adjust_global_constructor_matches(
            &new_expression.callee,
            &NO_ADJUST_EAGER_COLLECTION_CONSTRUCTORS,
            ctx,
        ),
        Expression::CallExpression(call_expression) => {
            let Some(member) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                return false;
            };
            let Some(method_name) = member.static_property_name() else {
                return false;
            };
            if (no_adjust_expression_is_global_identifier(member.object(), "Array", ctx)
                && matches!(method_name, "from" | "of"))
                || (no_adjust_expression_is_global_identifier(member.object(), "Object", ctx)
                    && matches!(method_name, "entries" | "keys" | "values"))
            {
                return true;
            }
            NO_ADJUST_ARRAY_RETURNING_METHODS.contains(&method_name)
                && no_adjust_expression_is_provably_eager_collection(
                    member.object(),
                    ctx,
                    visited_symbol_ids,
                )
        }
        Expression::Identifier(identifier) => {
            let Some((symbol_id, initializer)) =
                no_adjust_read_only_const_identifier_initializer(identifier, ctx)
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            no_adjust_expression_is_provably_eager_collection(initializer, ctx, visited_symbol_ids)
        }
        _ => false,
    }
}

fn no_adjust_expression_is_provably_eager_foreach_collection<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::NewExpression(new_expression) => no_adjust_global_constructor_matches(
            &new_expression.callee,
            &NO_ADJUST_EAGER_FOREACH_COLLECTION_CONSTRUCTORS,
            ctx,
        ),
        Expression::Identifier(identifier) => {
            let Some((symbol_id, initializer)) =
                no_adjust_read_only_const_identifier_initializer(identifier, ctx)
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            no_adjust_expression_is_provably_eager_foreach_collection(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        }
        expression => {
            no_adjust_expression_is_provably_eager_collection(expression, ctx, visited_symbol_ids)
        }
    }
}

fn no_adjust_expression_is_global_identifier(
    expression: &Expression<'_>,
    identifier_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == identifier_name
                && no_adjust_identifier_is_global(identifier, ctx)
    )
}

fn no_adjust_global_constructor_matches(
    expression: &Expression<'_>,
    constructor_names: &[&str],
    ctx: &LintContext<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::Identifier(identifier)
            if constructor_names.contains(&identifier.name.as_str())
                && no_adjust_identifier_is_global(identifier, ctx)
    )
}

fn no_adjust_read_only_const_identifier_initializer<'a, 'ctx>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Option<(SymbolId, &'ctx Expression<'a>)> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let initializer = no_adjust_read_only_const_direct_initializer(symbol_id, ctx)?;
    Some((symbol_id, initializer))
}

fn no_adjust_read_only_const_direct_initializer<'a, 'ctx>(
    symbol_id: SymbolId,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx Expression<'a>> {
    if ctx
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
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    declarator.init.as_ref()
}

fn no_adjust_expression_is_proven_memoized_array_receiver<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(call_expression)
            if is_react_hook_call(call_expression, &["useMemo"], ctx) =>
        {
            let Some(factory_expression) = call_expression
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                return false;
            };
            let Some(factory_id) = no_adjust_resolved_callback_function_id(factory_expression, ctx)
            else {
                return false;
            };
            if no_adjust_function_is_async(factory_id, ctx)
                || matches!(ctx.nodes().get_node(factory_id).kind(), AstKind::Function(function) if function.generator)
            {
                return false;
            }
            let mut returned_expression_count = 0;
            let mut all_returns_are_arrays = true;
            no_adjust_for_each_returned_expression(factory_id, ctx, |returned_expression| {
                returned_expression_count += 1;
                all_returns_are_arrays &= no_adjust_expression_is_proven_nonempty_array(
                    returned_expression,
                    factory_id,
                    ctx,
                    visited_symbol_ids,
                );
            });
            returned_expression_count > 0 && all_returns_are_arrays
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let is_memoized_array = matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
            if matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                && declarator.init.as_ref().is_some_and(|initializer| {
                    no_adjust_expression_is_proven_memoized_array_receiver(
                        initializer,
                        ctx,
                        visited_symbol_ids,
                    )
                }));
            visited_symbol_ids.pop();
            is_memoized_array
        }
        _ => false,
    }
}

fn no_adjust_expression_is_proven_nonempty_array<'a>(
    expression: &Expression<'a>,
    memo_factory_id: NodeId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(array) => !array.elements.is_empty(),
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let is_nonempty_array = matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
            if matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                && declarator.init.as_ref().is_some_and(|initializer| {
                    no_adjust_expression_is_proven_nonempty_array(
                        initializer,
                        memo_factory_id,
                        ctx,
                        visited_symbol_ids,
                    )
                }));
            visited_symbol_ids.pop();
            is_nonempty_array
        }
        Expression::CallExpression(call_expression) => {
            let Some(member) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                return false;
            };
            let Some(method_name) = member.static_property_name() else {
                return false;
            };
            if !matches!(
                method_name,
                "concat"
                    | "filter"
                    | "flat"
                    | "flatMap"
                    | "map"
                    | "slice"
                    | "sort"
                    | "toReversed"
                    | "toSorted"
                    | "toSpliced"
                    | "with"
            ) {
                return false;
            }
            if let Expression::Identifier(identifier) = member.object().get_inner_expression()
                && no_adjust_has_possible_static_property_write_before(identifier, method_name, ctx)
            {
                return false;
            }
            if method_name == "filter"
                && no_adjust_expression_is_outer_function_parameter(
                    member.object(),
                    memo_factory_id,
                    ctx,
                )
            {
                return true;
            }
            no_adjust_expression_is_proven_nonempty_array(
                member.object(),
                memo_factory_id,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => false,
    }
}

fn no_adjust_has_possible_static_property_write_before<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    property_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(root_symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return false;
    };
    potential_alias_symbol_ids(root_symbol_id, ctx)
        .into_iter()
        .flat_map(|symbol_id| ctx.scoping().get_resolved_references(symbol_id))
        .any(|reference| {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            static_property_write_member(identifier_node, ctx).is_some_and(|member_node| {
                resolved_static_member_property_name(member_node, ctx)
                    .is_none_or(|written_property_name| written_property_name == property_name)
            })
        })
}

fn no_adjust_expression_is_outer_function_parameter(
    expression: &Expression<'_>,
    inner_function_id: NodeId,
    ctx: &LintContext<'_>,
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
    let declaration = ctx.symbol_declaration(symbol_id);
    matches!(declaration.kind(), AstKind::FormalParameter(_))
        && no_adjust_nearest_function_node_id(declaration.id(), ctx) != Some(inner_function_id)
}

fn no_adjust_expression_is_dom_receiver<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if no_adjust_has_asserted_dom_target_type(expression, ctx)
        || is_proven_dom_event_target(expression, ctx, &mut visited_symbol_ids.clone())
        || no_adjust_expression_is_typed_react_ref_current(
            expression,
            ctx,
            &mut visited_symbol_ids.clone(),
        )
        || no_adjust_local_function_returns_dom_receiver(expression, ctx, visited_symbol_ids)
    {
        return true;
    }
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            let Some(initializer) = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
            else {
                return false;
            };
            visited_symbol_ids.push(symbol_id);
            let is_dom_receiver =
                no_adjust_expression_is_dom_receiver(initializer, ctx, visited_symbol_ids);
            visited_symbol_ids.pop();
            is_dom_receiver
        }
        Expression::ConditionalExpression(conditional) => {
            let branches = [&conditional.consequent, &conditional.alternate];
            let non_nullish_branches = branches
                .into_iter()
                .filter(|branch| !is_nullish_dom_target_expression(branch, ctx))
                .collect::<Vec<_>>();
            !non_nullish_branches.is_empty()
                && non_nullish_branches.into_iter().all(|branch| {
                    no_adjust_expression_is_dom_receiver(
                        branch,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    )
                })
        }
        Expression::ChainExpression(chain) => match &chain.expression {
            oxc_ast::ast::ChainElement::CallExpression(call) => call
                .callee
                .get_inner_expression()
                .as_member_expression()
                .is_some_and(|member| {
                    matches!(
                        member.static_property_name(),
                        Some(
                            "cloneNode"
                                | "closest"
                                | "createElement"
                                | "createElementNS"
                                | "elementFromPoint"
                                | "getElementById"
                                | "getRootNode"
                                | "querySelector"
                        )
                    ) && no_adjust_expression_is_dom_receiver(
                        member.object(),
                        ctx,
                        visited_symbol_ids,
                    )
                }),
            oxc_ast::ast::ChainElement::TSNonNullExpression(non_null) => {
                no_adjust_expression_is_dom_receiver(&non_null.expression, ctx, visited_symbol_ids)
            }
            chain_element => chain_element
                .as_member_expression()
                .and_then(|member| {
                    member
                        .static_property_name()
                        .map(|property_name| (property_name, member.object()))
                })
                .is_some_and(|(property_name, object)| {
                    matches!(
                        property_name,
                        "activeElement"
                            | "body"
                            | "documentElement"
                            | "firstElementChild"
                            | "lastElementChild"
                            | "ownerDocument"
                            | "parentElement"
                            | "parentNode"
                            | "shadowRoot"
                    ) && no_adjust_expression_is_dom_receiver(object, ctx, visited_symbol_ids)
                }),
        },
        _ => false,
    }
}

fn no_adjust_has_asserted_dom_target_type<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut wrapper = expression;
    let mut did_find_target_assertion = false;
    loop {
        let (inner, type_annotation) = match wrapper {
            Expression::TSAsExpression(assertion) => {
                (&assertion.expression, &assertion.type_annotation)
            }
            Expression::TSTypeAssertion(assertion) => {
                (&assertion.expression, &assertion.type_annotation)
            }
            Expression::TSSatisfiesExpression(assertion) => {
                (&assertion.expression, &assertion.type_annotation)
            }
            _ => break,
        };
        if is_dom_event_target_type(type_annotation, ctx) {
            did_find_target_assertion = true;
        } else if did_find_target_assertion {
            return false;
        }
        wrapper = inner;
    }
    if !did_find_target_assertion {
        return false;
    }
    let mut asserted_source = no_adjust_strip_parentheses(wrapper);
    if let Expression::Identifier(identifier) = asserted_source {
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
        if declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
            || !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            )
        {
            return false;
        }
        let Some(initializer) = declarator.init.as_ref() else {
            return false;
        };
        asserted_source = no_adjust_strip_parentheses(initializer);
    }
    if matches!(
        asserted_source,
        Expression::Identifier(_)
            | Expression::StaticMemberExpression(_)
            | Expression::ComputedMemberExpression(_)
            | Expression::PrivateFieldExpression(_)
            | Expression::ObjectExpression(_)
    ) {
        return false;
    }
    match asserted_source {
        Expression::NewExpression(new_expression) => {
            is_global_dom_event_target_constructor(&new_expression.callee, ctx, &mut Vec::new())
        }
        _ => true,
    }
}

fn no_adjust_strip_parentheses<'a, 'b>(mut expression: &'b Expression<'a>) -> &'b Expression<'a> {
    while let Expression::ParenthesizedExpression(parenthesized) = expression {
        expression = &parenthesized.expression;
    }
    expression
}

fn no_adjust_expression_is_typed_react_ref_current<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let Some(member) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    if member.static_property_name() != Some("current") {
        return false;
    }
    no_adjust_expression_has_typed_react_ref_origin(member.object(), ctx, visited_symbol_ids)
}

fn no_adjust_expression_has_typed_react_ref_origin<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let mut current = expression.get_inner_expression();
    while let Expression::Identifier(identifier) = current {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if visited_symbol_ids.contains(&symbol_id) {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return false;
        }
        let Some(initializer) = declarator.init.as_ref() else {
            return false;
        };
        visited_symbol_ids.push(symbol_id);
        current = initializer.get_inner_expression();
    }
    let Expression::CallExpression(call) = current else {
        return false;
    };
    if !is_react_api_call(call, "useRef", ctx) && !is_react_api_call(call, "createRef", ctx) {
        return false;
    }
    call.type_arguments
        .as_ref()
        .and_then(|arguments| arguments.params.first())
        .is_some_and(|argument| is_dom_event_target_type(argument, ctx))
}

fn no_adjust_local_function_returns_dom_receiver<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
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
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let function_node_id = match declaration.kind() {
        AstKind::Function(function)
            if !function.r#async
                && !function.generator
                && ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .all(|reference| !reference.is_write()) =>
        {
            function.node_id.get()
        }
        AstKind::VariableDeclarator(declarator)
            if matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) =>
        {
            let Some(initializer) = declarator.init.as_ref() else {
                return false;
            };
            match initializer.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) if !function.r#async => {
                    function.node_id.get()
                }
                Expression::FunctionExpression(function)
                    if !function.r#async && !function.generator =>
                {
                    function.node_id.get()
                }
                _ => return false,
            }
        }
        _ => return false,
    };
    visited_symbol_ids.push(symbol_id);
    let returns_dom_receiver =
        no_adjust_function_returns_only_dom_receivers(function_node_id, ctx, visited_symbol_ids);
    visited_symbol_ids.pop();
    returns_dom_receiver
}

fn no_adjust_function_returns_only_dom_receivers<'a>(
    function_node_id: NodeId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &[SymbolId],
) -> bool {
    if let AstKind::ArrowFunctionExpression(function) =
        ctx.nodes().get_node(function_node_id).kind()
        && let Some(returned_expression) = function.get_expression()
    {
        return no_adjust_expression_is_dom_receiver(
            returned_expression,
            ctx,
            &mut visited_symbol_ids.to_vec(),
        );
    }
    let statements = match ctx.nodes().get_node(function_node_id).kind() {
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
    let Some(statements) = statements else {
        return false;
    };
    if !statements.iter().any(statement_always_exits) {
        return false;
    }
    let mut returned_expression_count = 0;
    for candidate in ctx.nodes().iter() {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if no_adjust_nearest_function_node_id(candidate.id(), ctx) != Some(function_node_id) {
            continue;
        }
        let Some(returned_expression) = return_statement.argument.as_ref() else {
            return false;
        };
        returned_expression_count += 1;
        if !no_adjust_expression_is_dom_receiver(
            returned_expression,
            ctx,
            &mut visited_symbol_ids.to_vec(),
        ) {
            return false;
        }
    }
    returned_expression_count > 0
}

fn no_adjust_state_symbol_for_setter(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    if pattern.elements.len() != 2 || pattern.rest.is_some() {
        return None;
    }
    let Some(BindingPattern::BindingIdentifier(setter_identifier)) =
        pattern.elements.get(1).and_then(Option::as_ref)
    else {
        return None;
    };
    let Some(initializer) = declarator.init.as_ref() else {
        return None;
    };
    let state_symbol_id = match pattern.elements.first().and_then(Option::as_ref) {
        Some(BindingPattern::BindingIdentifier(identifier)) => identifier.symbol_id(),
        // HACK: Destructured state keeps its declaration identity through the setter; state reads still require a plain state binding.
        _ if matches!(initializer, Expression::CallExpression(_)) => setter_identifier.symbol_id(),
        _ => return None,
    };
    (setter_identifier.symbol_id() == symbol_id
        && no_adjust_expression_is_use_state_tuple(initializer, ctx, &mut Vec::new()))
    .then_some(state_symbol_id)
}

fn no_adjust_literal_hook_result_upstream_state_pair(
    setter_identifier: &oxc_ast::ast::IdentifierReference<'_>,
    written_value: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<(SymbolId, SymbolId)> {
    if !matches!(
        written_value.get_inner_expression(),
        Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::StringLiteral(_)
    ) {
        return None;
    }
    let hook_result_symbol_id = ctx
        .scoping()
        .get_reference(setter_identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(hook_result_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(&declarator.id, BindingPattern::ObjectPattern(_)) {
        return None;
    }
    let Expression::CallExpression(hook_call) = declarator.init.as_ref()?.get_inner_expression()
    else {
        return None;
    };
    let hook_name = no_adjust_call_callee_name(hook_call)?;
    if !hook_name.starts_with("use")
        || !hook_name
            .as_bytes()
            .get(3)
            .is_some_and(u8::is_ascii_uppercase)
    {
        return None;
    }
    let local_hook_function_id = no_adjust_state_fact_callback_function_id(&hook_call.callee, ctx);
    ctx.nodes().iter().find_map(|candidate| {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return None;
        };
        let is_in_hook_call = hook_call.span.contains_inclusive(identifier.span);
        let is_in_local_hook = local_hook_function_id.is_some_and(|function_id| {
            ctx.nodes()
                .get_node(function_id)
                .span()
                .contains_inclusive(identifier.span)
        });
        if !is_in_hook_call && !is_in_local_hook {
            return None;
        }
        let setter_symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        no_adjust_state_symbol_for_setter(setter_symbol_id, ctx)
            .map(|state_symbol_id| (setter_symbol_id, state_symbol_id))
    })
}

fn no_adjust_has_resource_lifecycle_setter_writer<'a>(
    setter_symbol_id: SymbolId,
    reset_call: &oxc_ast::ast::CallExpression<'a>,
    reset_value: &Expression<'a>,
    effect_span: oxc_span::Span,
    prop_dependency_symbols: &FxHashSet<SymbolId>,
    component_node_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    if prop_dependency_symbols.is_empty() {
        return false;
    }
    let matches_state_initializer =
        no_adjust_reset_matches_state_initializer(setter_symbol_id, reset_value, ctx);
    let is_resource_key_reconciliation = !matches_state_initializer
        && no_adjust_is_resource_key_reconciliation(
            reset_value,
            prop_dependency_symbols,
            component_node_id,
            ctx,
        );
    if !matches_state_initializer && !is_resource_key_reconciliation {
        return false;
    }

    let mut resource_handler_function_ids = FxHashSet::default();
    let mut has_matching_resource_identity = false;
    for opening_node in ctx.nodes().iter() {
        let AstKind::JSXOpeningElement(opening_element) = opening_node.kind() else {
            continue;
        };
        if no_adjust_nearest_function_node_id(opening_node.id(), ctx) != Some(component_node_id)
            || !no_adjust_resource_opening_reads_dependencies(
                opening_element,
                prop_dependency_symbols,
                component_node_id,
                ctx,
            )
        {
            continue;
        }
        has_matching_resource_identity = true;
        for attribute in &opening_element.attributes {
            let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let Some(attribute_name) = no_adjust_jsx_attribute_name(attribute) else {
                continue;
            };
            if !no_adjust_resource_event_is_valid_for_element(
                attribute_name,
                opening_element
                    .name
                    .get_identifier_name()
                    .map(|name| name.as_str()),
            ) {
                continue;
            }
            let Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) =
                &attribute.value
            else {
                continue;
            };
            let Some(handler_expression) = container.expression.as_expression() else {
                continue;
            };
            if let Expression::Identifier(identifier) = handler_expression.get_inner_expression()
                && resolve_const_identifier_root_symbol(identifier, ctx) == Some(setter_symbol_id)
            {
                return true;
            }
            if let Some(function_id) =
                no_adjust_resolved_callback_function_id(handler_expression, ctx)
            {
                resource_handler_function_ids.insert(function_id);
            }
        }
    }

    let mut pending_function_ids = resource_handler_function_ids
        .iter()
        .copied()
        .collect::<Vec<_>>();
    while let Some(function_id) = pending_function_ids.pop() {
        for candidate in ctx.nodes().iter() {
            if no_adjust_nearest_function_node_id(candidate.id(), ctx) != Some(function_id) {
                continue;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                continue;
            };
            if let Some(called_function_id) =
                no_adjust_resolved_callback_function_id(&call.callee, ctx)
                && resource_handler_function_ids.insert(called_function_id)
            {
                pending_function_ids.push(called_function_id);
            }
        }
    }

    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(writer_call) = candidate.kind() else {
            continue;
        };
        if candidate.span() == reset_call.span || effect_span.contains_inclusive(candidate.span()) {
            continue;
        }
        let Expression::Identifier(writer_identifier) = writer_call.callee.get_inner_expression()
        else {
            continue;
        };
        if resolve_const_identifier_root_symbol(writer_identifier, ctx) != Some(setter_symbol_id)
            || !no_adjust_resource_writer_value_matches(
                writer_call,
                prop_dependency_symbols,
                component_node_id,
                ctx,
            )
        {
            continue;
        }
        if no_adjust_nearest_function_node_id(candidate.id(), ctx)
            .is_some_and(|function_id| resource_handler_function_ids.contains(&function_id))
        {
            return true;
        }
        if has_matching_resource_identity
            && no_adjust_writer_is_in_resource_sync_effect(candidate, ctx)
        {
            return true;
        }
    }
    false
}

fn no_adjust_write_resets_source_state<'a>(
    written_value: &Expression<'a>,
    written_state_symbol_id: SymbolId,
    write_node: &AstNode<'a>,
    callback_expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut source_state_symbol_ids = FxHashSet::default();
    let mut collect_state_symbols = |expression: &Expression<'a>| {
        for candidate in ctx.nodes().iter() {
            let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                continue;
            };
            if !expression.span().contains_inclusive(identifier.span) {
                continue;
            }
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                continue;
            };
            if symbol_id != written_state_symbol_id
                && no_adjust_symbol_is_state_value(symbol_id, ctx)
            {
                source_state_symbol_ids.insert(symbol_id);
            }
        }
    };
    if let Some(function_id) = no_adjust_function_expression_node_id(written_value) {
        no_adjust_for_each_returned_expression(function_id, ctx, &mut collect_state_symbols);
    } else {
        collect_state_symbols(written_value);
    }
    if source_state_symbol_ids.is_empty() {
        return false;
    }
    let source_setter_symbol_ids = source_state_symbol_ids
        .into_iter()
        .filter_map(|state_symbol_id| no_adjust_setter_symbol_for_state(state_symbol_id, ctx))
        .collect::<FxHashSet<_>>();
    let Some(callback_node_id) = no_adjust_effect_callback_function_id(callback_expression, ctx)
    else {
        return false;
    };
    let mut resets_source_state = false;
    no_adjust_for_each_callback_execution_node(callback_node_id, true, ctx, |candidate, _| {
        if resets_source_state
            || are_nodes_in_mutually_exclusive_branches(write_node, candidate, ctx)
        {
            return;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            return;
        };
        let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
            return;
        };
        resets_source_state = resolve_const_identifier_root_symbol(identifier, ctx)
            .is_some_and(|symbol_id| source_setter_symbol_ids.contains(&symbol_id));
    });
    resets_source_state
}

fn no_adjust_setter_symbol_for_state(
    state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let declaration = ctx.symbol_declaration(state_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let BindingPattern::BindingIdentifier(state) = pattern.elements.first()?.as_ref()? else {
        return None;
    };
    let BindingPattern::BindingIdentifier(setter) = pattern.elements.get(1)?.as_ref()? else {
        return None;
    };
    (state.symbol_id() == state_symbol_id).then(|| setter.symbol_id())
}

fn no_adjust_reset_matches_state_initializer(
    setter_symbol_id: SymbolId,
    reset_value: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let declaration = ctx.symbol_declaration(setter_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(Expression::CallExpression(initializer)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if !is_react_hook_call(initializer, &["useState"], ctx) {
        return false;
    }
    let Some(initial_value) = initializer
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return matches!(reset_value.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "undefined" && no_adjust_identifier_is_global(identifier, ctx));
    };
    if let Expression::LogicalExpression(logical) = initial_value.get_inner_expression()
        && matches!(
            logical.operator,
            oxc_syntax::operator::LogicalOperator::Coalesce
                | oxc_syntax::operator::LogicalOperator::Or
        )
    {
        return no_adjust_same_static_value(&logical.left, reset_value, ctx)
            || no_adjust_same_static_value(&logical.right, reset_value, ctx);
    }
    no_adjust_same_static_value(initial_value, reset_value, ctx)
}

fn no_adjust_same_static_value(
    left: &Expression<'_>,
    right: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match (left.get_inner_expression(), right.get_inner_expression()) {
        (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::BooleanLiteral(left), Expression::BooleanLiteral(right)) => {
            left.value == right.value
        }
        (Expression::StringLiteral(left), Expression::StringLiteral(right)) => {
            left.value == right.value
        }
        (Expression::NumericLiteral(left), Expression::NumericLiteral(right)) => {
            left.value == right.value
        }
        (Expression::Identifier(left), Expression::Identifier(right)) => {
            let left_symbol = ctx.scoping().get_reference(left.reference_id()).symbol_id();
            let right_symbol = ctx
                .scoping()
                .get_reference(right.reference_id())
                .symbol_id();
            if left_symbol.is_some() || right_symbol.is_some() {
                left_symbol.is_some() && left_symbol == right_symbol
            } else {
                left.name == right.name
            }
        }
        (left, right) => {
            let (Some(left), Some(right)) =
                (left.as_member_expression(), right.as_member_expression())
            else {
                return false;
            };
            left.static_property_name() == right.static_property_name()
                && no_adjust_same_static_value(left.object(), right.object(), ctx)
        }
    }
}

fn no_adjust_is_resource_key_reconciliation(
    reset_value: &Expression<'_>,
    prop_dependency_symbols: &FxHashSet<SymbolId>,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(function_id) = no_adjust_function_expression_node_id(reset_value) else {
        return false;
    };
    let function_node = ctx.nodes().get_node(function_id);
    let parameter_symbol_ids = match function_node.kind() {
        AstKind::Function(function) => function
            .params
            .items
            .iter()
            .filter_map(|parameter| parameter.pattern.get_binding_identifier())
            .map(|binding| binding.symbol_id())
            .collect::<FxHashSet<_>>(),
        AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .iter()
            .filter_map(|parameter| parameter.pattern.get_binding_identifier())
            .map(|binding| binding.symbol_id())
            .collect::<FxHashSet<_>>(),
        _ => return false,
    };
    let mut reads_previous_value = false;
    let mut reads_dependency = false;
    let mut returns_null = false;
    for candidate in ctx.nodes().iter() {
        if candidate.id() != function_id
            && no_adjust_nearest_function_node_id(candidate.id(), ctx) != Some(function_id)
        {
            continue;
        }
        match candidate.kind() {
            AstKind::IdentifierReference(identifier) => {
                let symbol_id = ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id();
                reads_previous_value |=
                    symbol_id.is_some_and(|symbol_id| parameter_symbol_ids.contains(&symbol_id));
                if let Some(symbol_id) = symbol_id {
                    let mut source_symbols = FxHashSet::default();
                    no_adjust_collect_prop_source_symbols(
                        symbol_id,
                        component_node_id,
                        ctx,
                        &mut Vec::new(),
                        &mut source_symbols,
                    );
                    reads_dependency |= !source_symbols.is_disjoint(prop_dependency_symbols);
                }
            }
            AstKind::NullLiteral(_) => returns_null = true,
            _ => {}
        }
    }
    reads_previous_value && reads_dependency && returns_null
}

fn no_adjust_resource_opening_reads_dependencies(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    prop_dependency_symbols: &FxHashSet<SymbolId>,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(element_name) = opening_element.name.get_identifier_name() else {
        return false;
    };
    if element_name
        .as_bytes()
        .first()
        .is_none_or(|first| !first.is_ascii_lowercase())
    {
        return false;
    }
    opening_element.attributes.iter().any(|attribute| {
        let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
            return false;
        };
        if !matches!(
            no_adjust_jsx_attribute_name(attribute),
            Some("data" | "href" | "src" | "srcSet")
        ) {
            return false;
        }
        let mut source_symbols = FxHashSet::default();
        no_adjust_collect_prop_source_symbols_in_span(
            attribute.span,
            component_node_id,
            ctx,
            &mut Vec::new(),
            &mut source_symbols,
        );
        !source_symbols.is_disjoint(prop_dependency_symbols)
    })
}

fn no_adjust_jsx_attribute_name<'node, 'ast>(
    attribute: &'node oxc_ast::ast::JSXAttribute<'ast>,
) -> Option<&'node str> {
    match &attribute.name {
        oxc_ast::ast::JSXAttributeName::Identifier(identifier) => Some(identifier.name.as_str()),
        oxc_ast::ast::JSXAttributeName::NamespacedName(_) => None,
    }
}

fn no_adjust_resource_event_is_valid_for_element(
    attribute_name: &str,
    element_name: Option<&str>,
) -> bool {
    let Some(element_name) = element_name else {
        return false;
    };
    match attribute_name {
        "onAbort" | "onCanPlay" | "onCanPlayThrough" | "onEmptied" | "onEncrypted" | "onEnded"
        | "onLoadedData" | "onLoadedMetadata" | "onLoadStart" | "onProgress" | "onStalled"
        | "onSuspend" | "onWaiting" => matches!(element_name, "audio" | "video"),
        "onError" => matches!(
            element_name,
            "audio" | "video" | "img" | "link" | "source" | "script" | "picture" | "iframe"
        ),
        "onLoad" => matches!(
            element_name,
            "script" | "img" | "link" | "picture" | "iframe" | "object" | "source" | "body"
        ),
        _ => false,
    }
}

fn no_adjust_resource_writer_value_matches(
    writer_call: &oxc_ast::ast::CallExpression<'_>,
    prop_dependency_symbols: &FxHashSet<SymbolId>,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(value) = writer_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    if matches!(value.get_inner_expression(), Expression::BooleanLiteral(literal) if literal.value)
    {
        return true;
    }
    if let Expression::Identifier(identifier) = value.get_inner_expression()
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                matches!(
                    ctx.symbol_declaration(symbol_id).kind(),
                    AstKind::FormalParameter(_)
                )
            })
    {
        return true;
    }
    let mut source_symbols = FxHashSet::default();
    no_adjust_collect_prop_source_symbols_in_span(
        value.span(),
        component_node_id,
        ctx,
        &mut Vec::new(),
        &mut source_symbols,
    );
    !source_symbols.is_disjoint(prop_dependency_symbols)
}

fn no_adjust_writer_is_in_resource_sync_effect(
    writer_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(writer_node.id()) {
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        let function_root = transparent_expression_root(ancestor, ctx);
        let parent = ctx.nodes().parent_node(function_root.id());
        let AstKind::CallExpression(effect_call) = parent.kind() else {
            continue;
        };
        if !effect_call.arguments.first().is_some_and(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == function_root.span())
        }) || !is_react_hook_call(effect_call, &["useEffect"], ctx)
        {
            continue;
        }
        let mut has_resource_sync = false;
        for candidate in ctx.nodes().iter() {
            if !effect_call.span.contains_inclusive(candidate.span()) {
                continue;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                continue;
            };
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                continue;
            };
            if matches!(
                member.static_property_name(),
                Some("load" | "pause" | "play")
            ) && no_adjust_expression_is_dom_receiver(member.object(), ctx, &mut Vec::new())
            {
                has_resource_sync = true;
                break;
            }
        }
        return has_resource_sync;
    }
    false
}

fn no_adjust_setter_has_independent_writer(
    setter_symbol_id: SymbolId,
    effect_span: oxc_span::Span,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(setter_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if effect_span.contains_inclusive(reference_node.span()) {
                return false;
            }
            let root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(root.id());
            let is_writer = matches!(
                parent.kind(),
                AstKind::CallExpression(call)
                    if call.callee.span() == root.span()
                        || call.arguments.iter().any(|argument| {
                            argument
                                .as_expression()
                                .is_some_and(|expression| expression.span() == root.span())
                        })
            ) || no_adjust_is_inside_inline_event_handler(
                reference_node.id(),
                component_node_id,
                ctx,
            );
            is_writer
                && (no_adjust_is_inside_deferred_writer(
                    reference_node.id(),
                    component_node_id,
                    ctx,
                ) || no_adjust_is_inside_proven_event_handler(
                    reference_node.id(),
                    component_node_id,
                    true,
                    0,
                    ctx,
                ))
        })
}

fn no_adjust_is_inside_deferred_writer(
    node_id: NodeId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut previous_node = ctx.nodes().get_node(node_id);
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == component_node_id {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(function) if function.r#async
        ) || matches!(
            ancestor.kind(),
            AstKind::ArrowFunctionExpression(function) if function.r#async
        ) {
            return true;
        }
        if let AstKind::CallExpression(call) = ancestor.kind()
            && call
                .arguments
                .iter()
                .any(|argument| argument.span() == previous_node.span())
        {
            match call.callee.get_inner_expression() {
                Expression::Identifier(identifier)
                    if NO_ADJUST_INDEPENDENT_WRITER_DEFERRED_DIRECT_CALLS
                        .contains(&identifier.name.as_str()) =>
                {
                    return true;
                }
                callee => {
                    if callee.as_member_expression().is_some_and(|member| {
                        member.static_property_name().is_some_and(|property_name| {
                            NO_ADJUST_INDEPENDENT_WRITER_DEFERRED_DIRECT_CALLS
                                .contains(&property_name)
                                || NO_ADJUST_INDEPENDENT_WRITER_DEFERRED_MEMBER_CALLS
                                    .contains(&property_name)
                        })
                    }) {
                        return true;
                    }
                }
            }
        }
        previous_node = ancestor;
    }
    false
}

const NO_ADJUST_MAX_EVENT_HANDLER_PROOF_DEPTH: usize = 8;

fn no_adjust_is_inside_proven_event_handler(
    node_id: NodeId,
    component_node_id: NodeId,
    _allow_one_call_frame: bool,
    proof_depth: usize,
    ctx: &LintContext<'_>,
) -> bool {
    if proof_depth >= NO_ADJUST_MAX_EVENT_HANDLER_PROOF_DEPTH {
        return false;
    }
    if no_adjust_is_inside_inline_event_handler(node_id, component_node_id, ctx) {
        return true;
    }
    let Some(function_node_id) =
        no_adjust_enclosing_event_handler_function_node_id(node_id, component_node_id, ctx)
    else {
        return false;
    };
    no_adjust_function_has_reachable_event_path(
        function_node_id,
        component_node_id,
        proof_depth + 1,
        ctx,
    )
}

fn no_adjust_enclosing_event_handler_function_node_id(
    node_id: NodeId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(node_id)
        .take_while(|ancestor| ancestor.id() != component_node_id)
        .find_map(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
            .then(|| ancestor.id())
        })
}

fn no_adjust_event_handler_function_symbol_id(
    function_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let function_node = ctx.nodes().get_node(function_node_id);
    if let AstKind::Function(function) = function_node.kind()
        && function.is_function_declaration()
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id());
    }
    let mut ancestor = ctx.nodes().parent_node(function_node_id);
    loop {
        match ancestor.kind() {
            AstKind::VariableDeclarator(declarator) => {
                let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                    return None;
                };
                return Some(identifier.symbol_id());
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_) => {
                return None;
            }
            _ => ancestor = ctx.nodes().parent_node(ancestor.id()),
        }
    }
}

fn no_adjust_function_has_reachable_event_path(
    function_node_id: NodeId,
    component_node_id: NodeId,
    proof_depth: usize,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(function_symbol_id) =
        no_adjust_event_handler_function_symbol_id(function_node_id, ctx)
    else {
        return false;
    };
    for reference in ctx.scoping().get_resolved_references(function_symbol_id) {
        if no_adjust_is_inside_inline_event_handler(reference.node_id(), component_node_id, ctx) {
            return true;
        }
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let parent = ctx.nodes().parent_node(reference.node_id());
        if matches!(parent.kind(), AstKind::CallExpression(call_expression)
            if call_expression.callee.span() == reference_node.span())
            && no_adjust_is_inside_proven_event_handler(
                parent.id(),
                component_node_id,
                false,
                proof_depth,
                ctx,
            )
        {
            return true;
        }
    }
    false
}

fn no_adjust_is_inside_inline_event_handler(
    node_id: NodeId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == component_node_id {
            return false;
        }
        if let AstKind::JSXAttribute(attribute) = ancestor.kind()
            && let oxc_ast::ast::JSXAttributeName::Identifier(identifier) = &attribute.name
            && no_adjust_is_event_handler_name(identifier.name.as_str())
        {
            return true;
        }
        if let AstKind::ObjectProperty(property) = ancestor.kind()
            && !property.computed
            && property
                .key
                .static_name()
                .is_some_and(|name| no_adjust_is_event_handler_name(name.as_ref()))
        {
            return true;
        }
    }
    false
}

fn no_adjust_is_event_handler_name(name: &str) -> bool {
    name.starts_with("on") && name.as_bytes().get(2).is_some_and(u8::is_ascii_uppercase)
}

fn no_adjust_effect_reads_state_before_write(
    state_symbol_id: SymbolId,
    setter_node: &AstNode<'_>,
    invocation_id: Option<NodeId>,
    callback_node_id: NodeId,
    callback_execution_node_ids: &FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    no_adjust_execution_node_is_controlled_by_state(
        setter_node,
        state_symbol_id,
        invocation_id,
        callback_node_id,
        callback_execution_node_ids,
        &mut FxHashSet::default(),
        ctx,
    )
}

fn no_adjust_execution_node_is_controlled_by_state(
    execution_node: &AstNode<'_>,
    state_symbol_id: SymbolId,
    invocation_id: Option<NodeId>,
    callback_node_id: NodeId,
    callback_execution_node_ids: &FxHashSet<NodeId>,
    visited_function_ids: &mut FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(function_id) = no_adjust_nearest_function_node_id(execution_node.id(), ctx) else {
        return false;
    };
    if !visited_function_ids.insert(function_id) {
        return false;
    }
    let mut child = execution_node;
    for ancestor in ctx.nodes().ancestors(execution_node.id()) {
        if ancestor.id() == function_id {
            break;
        }
        let is_controlled = match ancestor.kind() {
            AstKind::IfStatement(statement) => {
                (statement.consequent.span().contains_inclusive(child.span())
                    || statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| alternate.span().contains_inclusive(child.span())))
                    && no_adjust_control_region_reads_written_state(ancestor.id(), state_symbol_id, ctx)
            }
            AstKind::ConditionalExpression(expression) => {
                (expression
                    .consequent
                    .span()
                    .contains_inclusive(child.span())
                    || expression.alternate.span().contains_inclusive(child.span()))
                    && no_adjust_control_region_reads_written_state(ancestor.id(), state_symbol_id, ctx)
            }
            AstKind::LogicalExpression(expression) => {
                expression.right.span().contains_inclusive(child.span())
                    && no_adjust_control_region_reads_written_state(ancestor.id(), state_symbol_id, ctx)
            }
            AstKind::BlockStatement(_) => no_adjust_has_prior_state_early_exit(
                ancestor.id(),
                child.span().start,
                state_symbol_id,
                ctx,
            ),
            _ => false,
        };
        if is_controlled {
            visited_function_ids.remove(&function_id);
            return true;
        }
        child = ancestor;
    }
    if function_id == callback_node_id {
        visited_function_ids.remove(&function_id);
        return false;
    }
    let is_invocation_controlled = invocation_id.is_some_and(|invocation_id| {
        let candidate = ctx.nodes().get_node(invocation_id);
        if !callback_execution_node_ids.contains(&candidate.id())
            || no_adjust_nearest_function_node_id(candidate.id(), ctx) == Some(function_id)
        {
            return false;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        no_adjust_call_invokes_state_fact_function(call, function_id, ctx)
            && no_adjust_execution_node_is_controlled_by_state(
                candidate,
                state_symbol_id,
                None,
                callback_node_id,
                callback_execution_node_ids,
                visited_function_ids,
                ctx,
            )
    });
    visited_function_ids.remove(&function_id);
    is_invocation_controlled
}

fn no_adjust_has_prior_state_early_exit(
    block_node_id: NodeId,
    execution_start: u32,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IfStatement(statement) = candidate.kind() else {
            return false;
        };
        if ctx.nodes().parent_node(candidate.id()).id() != block_node_id
            || candidate.span().end > execution_start
        {
            return false;
        }
        no_adjust_if_statement_is_early_exit(statement)
            && no_adjust_control_region_reads_written_state(candidate.id(), state_symbol_id, ctx)
    })
}

fn no_adjust_if_statement_is_early_exit(statement: &oxc_ast::ast::IfStatement<'_>) -> bool {
    fn statement_is_exit(statement: &oxc_ast::ast::Statement<'_>) -> bool {
        matches!(
            statement,
            oxc_ast::ast::Statement::ReturnStatement(_)
                | oxc_ast::ast::Statement::ThrowStatement(_)
                | oxc_ast::ast::Statement::ContinueStatement(_)
                | oxc_ast::ast::Statement::BreakStatement(_)
        )
    }

    if statement_is_exit(&statement.consequent) {
        return true;
    }
    let oxc_ast::ast::Statement::BlockStatement(block) = &statement.consequent else {
        return false;
    };
    block.body.iter().any(statement_is_exit)
}

fn no_adjust_functional_updater_reads_current_state(
    written_value: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(function_id) = no_adjust_function_expression_node_id(written_value) else {
        return false;
    };
    let function_node = ctx.nodes().get_node(function_id);
    let current_state_symbol_id = match function_node.kind() {
        AstKind::Function(function) => function
            .params
            .items
            .first()
            .and_then(|parameter| parameter.pattern.get_binding_identifier())
            .map(|identifier| identifier.symbol_id()),
        AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .first()
            .and_then(|parameter| parameter.pattern.get_binding_identifier())
            .map(|identifier| identifier.symbol_id()),
        _ => None,
    };
    let Some(current_state_symbol_id) = current_state_symbol_id else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(current_state_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            no_adjust_nearest_function_node_id(reference.node_id(), ctx) == Some(function_id)
                && !no_adjust_is_inside_statically_unreachable_branch(reference_node, ctx)
        })
}

fn no_adjust_setter_value_context<'node, 'ast>(
    setter_node: &'node AstNode<'ast>,
    invocation_id: Option<NodeId>,
    ctx: &'node LintContext<'ast>,
) -> NoAdjustValueContext<'node, 'ast> {
    let Some(setter_function_id) = no_adjust_nearest_function_node_id(setter_node.id(), ctx) else {
        return NoAdjustValueContext {
            substitutions: FxHashMap::default(),
            write_anchor: setter_node,
        };
    };
    let parameter_symbol_ids = match ctx.nodes().get_node(setter_function_id).kind() {
        AstKind::Function(function) => function
            .params
            .items
            .iter()
            .map(|parameter| {
                parameter
                    .pattern
                    .get_binding_identifier()
                    .map(|identifier| identifier.symbol_id())
            })
            .collect::<Vec<_>>(),
        AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .iter()
            .map(|parameter| {
                parameter
                    .pattern
                    .get_binding_identifier()
                    .map(|identifier| identifier.symbol_id())
            })
            .collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    let Some(invocation_id) = invocation_id else {
        return NoAdjustValueContext {
            substitutions: FxHashMap::default(),
            write_anchor: setter_node,
        };
    };
    let call_node = ctx.nodes().get_node(invocation_id);
    let AstKind::CallExpression(call_expression) = call_node.kind() else {
        return NoAdjustValueContext {
            substitutions: FxHashMap::default(),
            write_anchor: setter_node,
        };
    };
    let direct_invocation = no_adjust_state_fact_callback_function_id(&call_expression.callee, ctx)
        == Some(setter_function_id);
    let iterator_collection = (!direct_invocation)
        .then(|| {
            call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
        })
        .flatten()
        .filter(|member| {
            matches!(
                member.static_property_name(),
                Some(
                    "every"
                        | "filter"
                        | "find"
                        | "findIndex"
                        | "flatMap"
                        | "forEach"
                        | "map"
                        | "reduce"
                        | "reduceRight"
                        | "some"
                )
            ) && call_expression.arguments.iter().any(|argument| {
                argument.as_expression().is_some_and(|argument| {
                    no_adjust_state_fact_callback_function_id(argument, ctx)
                        == Some(setter_function_id)
                })
            })
        })
        .map(|member| member.object());
    if !direct_invocation && iterator_collection.is_none() {
        return NoAdjustValueContext {
            substitutions: FxHashMap::default(),
            write_anchor: setter_node,
        };
    }
    let substitutions = parameter_symbol_ids
        .iter()
        .enumerate()
        .filter_map(|(parameter_index, parameter_symbol_id)| {
            let argument = if direct_invocation {
                call_expression
                    .arguments
                    .get(parameter_index)?
                    .as_expression()?
            } else if parameter_index == 0 {
                iterator_collection?
            } else {
                return None;
            };
            Some(((*parameter_symbol_id)?, argument))
        })
        .collect::<FxHashMap<_, _>>();
    NoAdjustValueContext {
        substitutions,
        write_anchor: call_node,
    }
}

fn no_adjust_symbol_is_state_value(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    let Some(BindingPattern::BindingIdentifier(state_identifier)) =
        pattern.elements.first().and_then(Option::as_ref)
    else {
        return false;
    };
    let Some(initializer) = declarator.init.as_ref() else {
        return false;
    };
    state_identifier.symbol_id() == symbol_id
        && no_adjust_expression_is_use_state_tuple(initializer, ctx, &mut Vec::new())
}

fn no_adjust_state_is_externally_driven(
    state_symbol_id: SymbolId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let declaration = ctx.symbol_declaration(state_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    let Some(BindingPattern::BindingIdentifier(setter)) =
        pattern.elements.get(1).and_then(Option::as_ref)
    else {
        return false;
    };
    let mut has_deferred_call = false;
    for reference in ctx.scoping().get_resolved_references(setter.symbol_id()) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let reference_root = transparent_expression_root(reference_node, ctx);
        if no_adjust_is_deferred_callback_position(reference_root, ctx) {
            has_deferred_call = true;
            continue;
        }
        let parent = ctx.nodes().parent_node(reference_root.id());
        if !matches!(parent.kind(), AstKind::CallExpression(call)
            if call.callee.span() == reference_root.span())
        {
            continue;
        }
        if !no_adjust_is_inside_deferred_callback(parent.id(), component_node_id, ctx) {
            return false;
        }
        has_deferred_call = true;
    }
    has_deferred_call
}

fn no_adjust_is_inside_deferred_callback(
    node_id: NodeId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx
        .nodes()
        .ancestors(node_id)
        .take_while(|ancestor| ancestor.id() != component_node_id)
    {
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        if no_adjust_is_deferred_callback_position(ancestor, ctx) {
            return true;
        }
        let Some(function_symbol_id) = no_adjust_function_binding_symbol(ancestor, ctx) else {
            continue;
        };
        if ctx
            .scoping()
            .get_resolved_references(function_symbol_id)
            .any(|reference| {
                no_adjust_is_deferred_callback_position(
                    ctx.nodes().get_node(reference.node_id()),
                    ctx,
                )
            })
        {
            return true;
        }
    }
    false
}

fn no_adjust_function_binding_symbol<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    if let AstKind::Function(function) = function_node.kind()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.symbol_id());
    }
    let mut root = transparent_expression_root(function_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(root.id());
        if matches!(parent.kind(), AstKind::CallExpression(_)) {
            root = transparent_expression_root(parent, ctx);
            continue;
        }
        let AstKind::VariableDeclarator(declarator) = parent.kind() else {
            return None;
        };
        return declarator
            .id
            .get_binding_identifier()
            .map(|identifier| identifier.symbol_id());
    }
}

fn no_adjust_is_deferred_callback_position<'a>(
    expression_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression_root = transparent_expression_root(expression_node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    match parent.kind() {
        AstKind::CallExpression(call)
            if call.arguments.iter().any(|argument| {
                argument
                    .as_expression()
                    .is_some_and(|argument| argument.span() == expression_root.span())
            }) =>
        {
            no_adjust_call_callee_name(call).is_some_and(|name| {
                matches!(
                    name,
                    "setTimeout"
                        | "setInterval"
                        | "setImmediate"
                        | "requestAnimationFrame"
                        | "requestIdleCallback"
                        | "queueMicrotask"
                        | "addEventListener"
                        | "addListener"
                        | "subscribe"
                        | "observe"
                        | "watch"
                        | "watchPosition"
                        | "then"
                        | "catch"
                        | "finally"
                        | "on"
                        | "once"
                )
            })
        }
        AstKind::NewExpression(construction)
            if construction.arguments.iter().any(|argument| {
                argument
                    .as_expression()
                    .is_some_and(|argument| argument.span() == expression_root.span())
            }) =>
        {
            match construction.callee.get_inner_expression() {
                Expression::Identifier(identifier) => {
                    identifier.name == "Promise" || identifier.name.ends_with("Observer")
                }
                expression => expression
                    .as_member_expression()
                    .and_then(|member| member.static_property_name())
                    .is_some_and(|name| name == "Promise" || name.ends_with("Observer")),
            }
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.right.span() == expression_root.span() =>
        {
            assignment
                .left
                .as_member_expression()
                .and_then(|member| member.static_property_name())
                .is_some_and(|name| name.starts_with("on"))
        }
        _ => false,
    }
}

fn no_adjust_expression_is_use_state_tuple<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(call_expression) => {
            is_react_hook_call(call_expression, &["useState"], ctx)
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let is_use_state_tuple = if let AstKind::VariableDeclarator(declarator) =
                declaration.kind()
                && matches!(
                    ctx.nodes().parent_node(declaration.id()).kind(),
                    AstKind::VariableDeclaration(variable_declaration)
                        if variable_declaration.kind.is_const()
                ) {
                declarator.init.as_ref().is_some_and(|initializer| {
                    no_adjust_expression_is_use_state_tuple(initializer, ctx, visited_symbol_ids)
                })
            } else {
                false
            };
            visited_symbol_ids.pop();
            is_use_state_tuple
        }
        _ => false,
    }
}

fn no_adjust_symbol_is_component_parameter(
    symbol_id: SymbolId,
    _component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    if !matches!(declaration.kind(), AstKind::FormalParameter(_))
        && !ctx
            .nodes()
            .ancestors(declaration.id())
            .any(|ancestor| matches!(ancestor.kind(), AstKind::FormalParameter(_)))
    {
        return false;
    }
    no_adjust_nearest_function_node_id(declaration.id(), ctx).is_some_and(|function_node_id| {
        component_or_hook_function_name(ctx.nodes().get_node(function_node_id), ctx).is_some()
            || no_adjust_callback_has_uppercase_call_binding(function_node_id, ctx)
    })
}

fn no_adjust_callback_has_uppercase_call_binding(
    function_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut parent = ctx.nodes().parent_node(function_node_id);
    while matches!(parent.kind(), AstKind::CallExpression(_)) {
        parent = ctx.nodes().parent_node(parent.id());
    }
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return false;
    };
    let Some(identifier) = declarator.id.get_binding_identifier() else {
        return false;
    };
    if !identifier.name.as_bytes().first().is_some_and(u8::is_ascii_uppercase) {
        return false;
    }
    let Some(Expression::CallExpression(initializer)) = &declarator.init else {
        return false;
    };
    if matches!(&initializer.callee, Expression::Identifier(callee)
        if !matches!(callee.name.as_str(), "memo" | "forwardRef" | "observer"))
        && initializer.arguments.first().and_then(Argument::as_expression).is_some_and(|argument| {
            matches!(argument, Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_))
        })
    {
        return false;
    }
    !ctx.scoping().get_resolved_references(identifier.symbol_id()).any(|reference| {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let AstKind::CallExpression(call) = ctx.nodes().parent_node(reference_node.id()).kind() else {
            return false;
        };
        if !call.arguments.iter().any(|argument| argument.span() == reference_node.span()) {
            return false;
        }
        let callee_name = match &call.callee {
            Expression::Identifier(callee) => Some(callee.name.as_str()),
            Expression::CallExpression(callee) => match &callee.callee {
                Expression::Identifier(identifier) => Some(identifier.name.as_str()),
                _ => None,
            },
            _ => None,
        };
        callee_name.is_some_and(|name| !matches!(name, "memo" | "forwardRef" | "observer"))
    })
}

fn no_adjust_symbol_is_state_updater_parameter(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    if !matches!(declaration.kind(), AstKind::FormalParameter(_)) {
        return false;
    }
    let Some(function_node_id) = no_adjust_nearest_function_node_id(declaration.id(), ctx) else {
        return false;
    };
    let function_span = ctx.nodes().get_node(function_node_id).span();
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        if !call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span().contains_inclusive(function_span))
        }) {
            return false;
        }
        let Expression::Identifier(setter_identifier) = call.callee.get_inner_expression() else {
            return false;
        };
        resolve_const_identifier_root_symbol(setter_identifier, ctx)
            .and_then(|setter_symbol_id| no_adjust_state_symbol_for_setter(setter_symbol_id, ctx))
            .is_some()
    })
}

fn no_adjust_expression_has_prop_source(
    expression: &Expression<'_>,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression_span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        if !expression_span.contains_inclusive(identifier.span) {
            return false;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        no_adjust_symbol_has_prop_source(symbol_id, component_node_id, ctx, visited_symbol_ids)
    })
}

fn no_adjust_prop_dependency_symbols(
    dependencies: &oxc_ast::ast::ArrayExpression<'_>,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let mut prop_symbols = FxHashSet::default();
    for dependency in dependencies
        .elements
        .iter()
        .filter_map(no_adjust_array_element_expression)
    {
        no_adjust_collect_dependency_prop_source_symbols_in_span(
            dependency.span(),
            component_node_id,
            ctx,
            &mut Vec::new(),
            &mut prop_symbols,
        );
    }
    prop_symbols
}

fn no_adjust_dependency_expression_has_prop_source(
    expression: &Expression<'_>,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression_span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        if !expression_span.contains_inclusive(identifier.span) {
            return false;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        !no_adjust_symbol_is_state_value(symbol_id, ctx)
            && no_adjust_symbol_has_upstream_prop_source(
                symbol_id,
                component_node_id,
                ctx,
                visited_symbol_ids,
            )
    })
}

fn no_adjust_collect_dependency_prop_source_symbols_in_span(
    span: oxc_span::Span,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    prop_symbols: &mut FxHashSet<SymbolId>,
) {
    for candidate in ctx.nodes().iter() {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            continue;
        };
        if !span.contains_inclusive(identifier.span) {
            continue;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            continue;
        };
        if !no_adjust_symbol_is_state_value(symbol_id, ctx) {
            no_adjust_collect_upstream_prop_source_symbols(
                symbol_id,
                component_node_id,
                ctx,
                visited_symbol_ids,
                prop_symbols,
            );
        }
    }
}

fn no_adjust_collect_upstream_prop_source_symbols(
    symbol_id: SymbolId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    prop_symbols: &mut FxHashSet<SymbolId>,
) {
    if no_adjust_symbol_is_component_parameter(symbol_id, component_node_id, ctx) {
        prop_symbols.insert(symbol_id);
        return;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::VariableDeclarator(declarator) = declaration.kind()
        && let Some(initializer) = &declarator.init
    {
        for candidate in ctx.nodes().iter() {
            let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                continue;
            };
            if !initializer.span().contains_inclusive(identifier.span)
                || no_adjust_initializer_defers_reference(initializer, identifier.span)
            {
                continue;
            }
            let Some(upstream_symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                continue;
            };
            no_adjust_collect_upstream_prop_source_symbols(
                upstream_symbol_id,
                component_node_id,
                ctx,
                visited_symbol_ids,
                prop_symbols,
            );
        }
        no_adjust_collect_type_assertion_property_prop_sources(
            initializer,
            symbol_id,
            component_node_id,
            ctx,
            visited_symbol_ids,
            prop_symbols,
        );
    }
    visited_symbol_ids.pop();
}

fn no_adjust_initializer_defers_reference(
    initializer: &Expression<'_>,
    reference_span: oxc_span::Span,
) -> bool {
    let arguments = match initializer {
        Expression::CallExpression(call) => {
            if let Expression::Identifier(callee) = &call.callee {
                let name = callee.name.as_str();
                if name.starts_with("use")
                    && name.as_bytes().get(3).is_some_and(|character| {
                        character.is_ascii_uppercase() || character.is_ascii_digit()
                    })
                {
                    return false;
                }
            }
            &call.arguments
        }
        Expression::NewExpression(call) => &call.arguments,
        _ => return false,
    };
    arguments.iter().any(|argument| {
        argument.as_expression().is_some_and(|expression| {
            matches!(expression, Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_))
                && expression.span().contains_inclusive(reference_span)
        })
    })
}

fn no_adjust_collect_type_assertion_property_prop_sources(
    initializer: &Expression<'_>,
    source_symbol_id: SymbolId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    prop_symbols: &mut FxHashSet<SymbolId>,
) {
    let Expression::TSAsExpression(assertion) = initializer else {
        return;
    };
    let oxc_ast::ast::TSType::TSTypeLiteral(type_literal) = &assertion.type_annotation else {
        return;
    };
    for member in &type_literal.members {
        let oxc_ast::ast::TSSignature::TSPropertySignature(property) = member else {
            continue;
        };
        let Some(property_name) = property.key.static_name() else {
            continue;
        };
        for candidate in ctx.nodes().iter() {
            let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
                continue;
            };
            let Some(binding_identifier) = declarator.id.get_binding_identifier() else {
                continue;
            };
            if binding_identifier.symbol_id() == source_symbol_id
                || property_name != binding_identifier.name
                || no_adjust_nearest_function_node_id(candidate.id(), ctx)
                    != Some(component_node_id)
            {
                continue;
            }
            no_adjust_collect_upstream_prop_source_symbols(
                binding_identifier.symbol_id(),
                component_node_id,
                ctx,
                visited_symbol_ids,
                prop_symbols,
            );
        }
    }
}

fn no_adjust_symbol_has_upstream_prop_source(
    symbol_id: SymbolId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let mut prop_symbols = FxHashSet::default();
    no_adjust_collect_upstream_prop_source_symbols(
        symbol_id,
        component_node_id,
        ctx,
        visited_symbol_ids,
        &mut prop_symbols,
    );
    !prop_symbols.is_empty()
}

fn no_adjust_collect_prop_source_symbols_in_span(
    span: oxc_span::Span,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    prop_symbols: &mut FxHashSet<SymbolId>,
) {
    for candidate in ctx.nodes().iter() {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            continue;
        };
        if !span.contains_inclusive(identifier.span) {
            continue;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            continue;
        };
        no_adjust_collect_prop_source_symbols(
            symbol_id,
            component_node_id,
            ctx,
            visited_symbol_ids,
            prop_symbols,
        );
    }
}

fn no_adjust_collect_prop_source_symbols(
    symbol_id: SymbolId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    prop_symbols: &mut FxHashSet<SymbolId>,
) {
    if no_adjust_symbol_is_state_value(symbol_id, ctx) {
        return;
    }
    if no_adjust_symbol_is_component_parameter(symbol_id, component_node_id, ctx) {
        prop_symbols.insert(symbol_id);
        return;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::VariableDeclarator(declarator) = declaration.kind()
        && matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
                    || !ctx
                        .scoping()
                        .get_resolved_references(symbol_id)
                        .any(|reference| reference.is_write())
        )
        && let Some(initializer) = &declarator.init
    {
        no_adjust_collect_prop_source_symbols_in_span(
            initializer.span(),
            component_node_id,
            ctx,
            visited_symbol_ids,
            prop_symbols,
        );
    }
    visited_symbol_ids.pop();
}

fn no_adjust_written_value_has_prop_source<'node, 'ast>(
    expression: &Expression<'ast>,
    component_node_id: NodeId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    substitutions: &FxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
    written_state_symbol_id: SymbolId,
) -> bool {
    let Some(function_node_id) = no_adjust_function_expression_node_id(expression) else {
        return no_adjust_expression_has_prop_source_with_substitutions(
            expression,
            component_node_id,
            ctx,
            visited_symbol_ids,
            substitutions,
            remaining_call_frames,
            written_state_symbol_id,
        );
    };
    let mut has_prop_source = false;
    no_adjust_for_each_returned_expression(function_node_id, ctx, |returned_expression| {
        has_prop_source |= no_adjust_expression_has_prop_source_with_substitutions(
            returned_expression,
            component_node_id,
            ctx,
            visited_symbol_ids,
            substitutions,
            remaining_call_frames,
            written_state_symbol_id,
        );
    });
    has_prop_source
}

fn no_adjust_written_member_value_has_prop_source(
    expression: &Expression<'_>,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let candidate = expression.get_inner_expression();
    let member = match candidate {
        Expression::ChainExpression(chain) => chain.expression.as_member_expression(),
        candidate => candidate.as_member_expression(),
    };
    let Some(member) = member else {
        return false;
    };
    let mut root = member.object();
    while let Some(parent_member) = root.get_inner_expression().as_member_expression() {
        root = parent_member.object();
    }
    let Expression::Identifier(identifier) = root.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    no_adjust_symbol_has_upstream_prop_source(symbol_id, component_node_id, ctx, &mut Vec::new())
}

fn no_adjust_function_body_has_prop_source<'node, 'ast>(
    expression: &Expression<'ast>,
    component_node_id: NodeId,
    ctx: &LintContext<'ast>,
    substitutions: &FxHashMap<SymbolId, &'node Expression<'ast>>,
    written_state_symbol_id: SymbolId,
) -> bool {
    let Some(function_node_id) = no_adjust_function_expression_node_id(expression) else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        if no_adjust_nearest_function_node_id(candidate.id(), ctx) != Some(function_node_id) {
            return false;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        substitutions.get(&symbol_id).is_some_and(|substitution| {
            no_adjust_expression_has_prop_source_with_substitutions(
                substitution,
                component_node_id,
                ctx,
                &mut Vec::new(),
                substitutions,
                0,
                written_state_symbol_id,
            )
        }) || no_adjust_symbol_has_upstream_prop_source(
            symbol_id,
            component_node_id,
            ctx,
            &mut Vec::new(),
        )
    })
}

fn no_adjust_value_helper_call_has_prop_source<'node, 'ast>(
    call: &'node oxc_ast::ast::CallExpression<'ast>,
    component_node_id: NodeId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    substitutions: &FxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
    written_state_symbol_id: SymbolId,
) -> bool {
    if remaining_call_frames == 0 {
        return false;
    }
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    let Some(function_id) = no_adjust_state_fact_callback_function_id(&call.callee, ctx) else {
        return false;
    };
    if no_adjust_nearest_function_node_id(function_id, ctx).is_none()
        || no_adjust_function_is_async(function_id, ctx)
        || matches!(ctx.nodes().get_node(function_id).kind(), AstKind::Function(function) if function.generator)
        || no_adjust_state_fact_function_invokes_itself(function_id, ctx)
    {
        return false;
    }
    let Some(callee_symbol_id) = ctx
        .scoping()
        .get_reference(callee.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&callee_symbol_id) {
        return false;
    }
    let parameter_symbol_ids = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function
            .params
            .items
            .iter()
            .map(|parameter| {
                parameter
                    .pattern
                    .get_binding_identifier()
                    .map(|identifier| identifier.symbol_id())
            })
            .collect::<Vec<_>>(),
        AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .iter()
            .map(|parameter| {
                parameter
                    .pattern
                    .get_binding_identifier()
                    .map(|identifier| identifier.symbol_id())
            })
            .collect::<Vec<_>>(),
        _ => return false,
    };
    let mut helper_substitutions = substitutions.clone();
    for (parameter_index, parameter_symbol_id) in parameter_symbol_ids.iter().enumerate() {
        if let (Some(parameter_symbol_id), Some(argument)) = (
            parameter_symbol_id,
            call.arguments
                .get(parameter_index)
                .and_then(Argument::as_expression),
        ) {
            helper_substitutions.insert(*parameter_symbol_id, argument);
        }
    }
    visited_symbol_ids.push(callee_symbol_id);
    let mut has_prop_source = false;
    no_adjust_for_each_returned_expression(function_id, ctx, |returned_expression| {
        has_prop_source |= no_adjust_expression_has_prop_source_with_substitutions(
            returned_expression,
            component_node_id,
            ctx,
            visited_symbol_ids,
            &helper_substitutions,
            remaining_call_frames - 1,
            written_state_symbol_id,
        );
    });
    visited_symbol_ids.pop();
    has_prop_source
}

fn no_adjust_expression_has_prop_source_with_substitutions<'node, 'ast>(
    expression: &Expression<'ast>,
    component_node_id: NodeId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    substitutions: &FxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
    written_state_symbol_id: SymbolId,
) -> bool {
    let expression_span = expression.span();
    if ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        expression_span.contains_inclusive(candidate.span())
            && !no_adjust_is_inside_ignored_pure_callback(candidate.id(), expression_span, ctx)
            && !no_adjust_is_pure_call(call, ctx)
            && no_adjust_value_helper_call_has_prop_source(
                call,
                component_node_id,
                ctx,
                visited_symbol_ids,
                substitutions,
                remaining_call_frames,
                written_state_symbol_id,
            )
    }) {
        return true;
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        if !expression_span.contains_inclusive(identifier.span)
            || no_adjust_is_inside_ignored_pure_callback(candidate.id(), expression_span, ctx)
            || no_adjust_identifier_is_inside_opaque_value_call(candidate, expression_span, ctx)
            || no_adjust_identifier_is_locally_constructed_member_object(candidate, ctx)
        {
            return false;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        substitutions.get(&symbol_id).is_some_and(|substitution| {
            no_adjust_expression_has_prop_source_with_substitutions(
                substitution,
                component_node_id,
                ctx,
                visited_symbol_ids,
                substitutions,
                remaining_call_frames,
                written_state_symbol_id,
            )
        }) || no_adjust_value_symbol_has_prop_source(
            symbol_id,
            component_node_id,
            ctx,
            visited_symbol_ids,
            substitutions,
            remaining_call_frames,
            written_state_symbol_id,
        )
    })
}

fn no_adjust_identifier_is_locally_constructed_member_object(
    identifier_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let member_node = ctx.nodes().parent_node(identifier_node.id());
    let Some(member) = member_node.kind().as_member_expression_kind() else {
        return false;
    };
    member.object().span() == identifier_node.span()
        && no_adjust_expression_is_locally_constructed_collection(member.object(), ctx)
}

fn no_adjust_identifier_is_inside_opaque_value_call(
    identifier_node: &AstNode<'_>,
    expression_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(identifier_node.id())
        .take_while(|ancestor| expression_span.contains_inclusive(ancestor.span()))
        .any(|ancestor| {
            matches!(ancestor.kind(), AstKind::CallExpression(call)
                if !no_adjust_is_pure_call(call, ctx))
        })
}

fn no_adjust_value_symbol_has_prop_source<'node, 'ast>(
    symbol_id: SymbolId,
    component_node_id: NodeId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    substitutions: &FxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
    written_state_symbol_id: SymbolId,
) -> bool {
    if no_adjust_symbol_is_state_value(symbol_id, ctx) {
        if symbol_id == written_state_symbol_id {
            return false;
        }
        return no_adjust_symbol_has_upstream_prop_source(
            symbol_id,
            component_node_id,
            ctx,
            visited_symbol_ids,
        );
    }
    if no_adjust_symbol_is_component_parameter(symbol_id, component_node_id, ctx) {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(declaration)
        if declaration.kind.is_const()
            || !ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| reference.is_write()))
    {
        return no_adjust_symbol_has_upstream_prop_source(
            symbol_id,
            component_node_id,
            ctx,
            visited_symbol_ids,
        );
    }
    let Some(initializer) = &declarator.init else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    let has_prop_source = no_adjust_expression_has_prop_source_with_substitutions(
        initializer,
        component_node_id,
        ctx,
        visited_symbol_ids,
        substitutions,
        remaining_call_frames,
        written_state_symbol_id,
    );
    visited_symbol_ids.pop();
    has_prop_source
}

fn no_adjust_written_value_is_render_known<'node, 'ast>(
    expression: &Expression<'ast>,
    component_node_id: NodeId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    substitutions: &FxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
) -> bool {
    let Some(function_node_id) = no_adjust_function_expression_node_id(expression) else {
        return no_adjust_expression_is_render_known_with_context(
            expression,
            component_node_id,
            ctx,
            visited_symbol_ids,
            substitutions,
            remaining_call_frames,
        );
    };
    let mut returned_expression_count = 0;
    let mut all_returns_are_render_known = true;
    no_adjust_for_each_returned_expression(function_node_id, ctx, |returned_expression| {
        returned_expression_count += 1;
        all_returns_are_render_known &= no_adjust_expression_is_render_known_with_context(
            returned_expression,
            component_node_id,
            ctx,
            visited_symbol_ids,
            substitutions,
            remaining_call_frames,
        );
    });
    returned_expression_count > 0 && all_returns_are_render_known
}

fn no_adjust_function_expression_node_id(expression: &Expression<'_>) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    }
}

fn no_adjust_for_each_returned_expression<'a>(
    function_node_id: NodeId,
    ctx: &LintContext<'a>,
    mut visitor: impl FnMut(&Expression<'a>),
) {
    if let AstKind::ArrowFunctionExpression(function) =
        ctx.nodes().get_node(function_node_id).kind()
        && let Some(expression) = function.get_expression()
    {
        visitor(expression);
        return;
    }
    for candidate in ctx.nodes().iter() {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if no_adjust_nearest_function_node_id(candidate.id(), ctx) == Some(function_node_id)
            && let Some(returned_expression) = &return_statement.argument
        {
            visitor(returned_expression);
        }
    }
}

fn no_adjust_symbol_has_prop_source(
    symbol_id: SymbolId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if no_adjust_symbol_is_state_value(symbol_id, ctx) {
        return false;
    }
    if no_adjust_symbol_is_component_parameter(symbol_id, component_node_id, ctx) {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        visited_symbol_ids.pop();
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(declaration)
        if declaration.kind.is_const()
            || !ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| reference.is_write()))
    {
        visited_symbol_ids.pop();
        return false;
    }
    let has_prop_source = declarator.init.as_ref().is_some_and(|initializer| {
        no_adjust_expression_has_prop_source(
            initializer,
            component_node_id,
            ctx,
            visited_symbol_ids,
        )
    });
    visited_symbol_ids.pop();
    has_prop_source
}

fn no_adjust_expression_is_render_known_with_context<'node, 'ast>(
    expression: &Expression<'ast>,
    component_node_id: NodeId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    substitutions: &FxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
) -> bool {
    if matches!(
        expression.get_inner_expression(),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return false;
    }
    let expression_span = expression.span();
    for candidate in ctx.nodes().iter() {
        if !expression_span.contains_inclusive(candidate.span()) {
            continue;
        }
        if no_adjust_is_inside_ignored_pure_callback(candidate.id(), expression_span, ctx) {
            let ref_expression = match candidate.kind() {
                AstKind::StaticMemberExpression(member)
                    if member.property.name == "current"
                        && no_adjust_expression_is_ref_value(&member.object, ctx) =>
                {
                    Some(&member.object)
                }
                AstKind::ComputedMemberExpression(member)
                    if member.static_property_name().as_deref() == Some("current")
                        && no_adjust_expression_is_ref_value(&member.object, ctx) =>
                {
                    Some(&member.object)
                }
                _ => None,
            };
            if ref_expression.is_some_and(|ref_expression| {
                !no_adjust_ref_current_is_render_known(
                    ref_expression,
                    component_node_id,
                    ctx,
                    visited_symbol_ids,
                    substitutions,
                    remaining_call_frames,
                )
            }) {
                return false;
            }
            continue;
        }
        match candidate.kind() {
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                if candidate.span() != expression_span =>
            {
                if no_adjust_function_is_ignored_pure_callback(candidate, ctx) {
                    continue;
                }
                return false;
            }
            AstKind::AwaitExpression(_)
            | AstKind::YieldExpression(_)
            | AstKind::AssignmentExpression(_)
            | AstKind::UpdateExpression(_) => return false,
            AstKind::NewExpression(new_expression)
                if !no_adjust_is_pure_constructor(new_expression, ctx) =>
            {
                return false;
            }
            AstKind::CallExpression(call_expression)
                if !no_adjust_is_pure_call(call_expression, ctx)
                    && !no_adjust_value_helper_call_is_render_known(
                        call_expression,
                        component_node_id,
                        ctx,
                        visited_symbol_ids,
                        substitutions,
                        remaining_call_frames,
                    ) =>
            {
                return false;
            }
            AstKind::IdentifierReference(identifier) => {
                let identifier_node = candidate;
                if no_adjust_identifier_is_jsx_element_name(identifier_node, ctx) {
                    continue;
                }
                let Some(symbol_id) = ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                else {
                    if !matches!(
                        identifier.name.as_str(),
                        "Array"
                            | "BigInt"
                            | "Boolean"
                            | "Date"
                            | "Infinity"
                            | "JSON"
                            | "Math"
                            | "NaN"
                            | "Number"
                            | "Object"
                            | "Set"
                            | "String"
                            | "encodeURIComponent"
                            | "parseFloat"
                            | "parseInt"
                            | "structuredClone"
                            | "undefined"
                    ) {
                        return false;
                    }
                    continue;
                };
                if no_adjust_identifier_is_ref_current_object(identifier_node, symbol_id, ctx) {
                    continue;
                }
                if no_adjust_identifier_is_value_helper_callee(identifier_node, symbol_id, ctx) {
                    continue;
                }
                if no_adjust_identifier_is_consumed_by_render_known_helper(
                    identifier_node,
                    expression_span,
                    component_node_id,
                    ctx,
                    visited_symbol_ids,
                    substitutions,
                    remaining_call_frames,
                ) {
                    continue;
                }
                if no_adjust_identifier_is_allowed_updater_spread(identifier_node, symbol_id, ctx) {
                    continue;
                }
                if let Some(substitution) = substitutions.get(&symbol_id) {
                    if !no_adjust_expression_is_render_known_with_context(
                        substitution,
                        component_node_id,
                        ctx,
                        visited_symbol_ids,
                        substitutions,
                        remaining_call_frames,
                    ) {
                        return false;
                    }
                    continue;
                }
                if !no_adjust_symbol_is_render_known_with_context(
                    symbol_id,
                    component_node_id,
                    ctx,
                    visited_symbol_ids,
                    substitutions,
                    remaining_call_frames,
                ) {
                    return false;
                }
            }
            AstKind::StaticMemberExpression(member_expression)
                if no_adjust_expression_is_locally_constructed_collection(
                    &member_expression.object,
                    ctx,
                ) =>
            {
                return false;
            }
            AstKind::ComputedMemberExpression(member_expression)
                if no_adjust_expression_is_locally_constructed_collection(
                    &member_expression.object,
                    ctx,
                ) =>
            {
                return false;
            }
            AstKind::StaticMemberExpression(member_expression)
                if member_expression.property.name == "current"
                    && no_adjust_expression_is_ref_value(&member_expression.object, ctx) =>
            {
                if !no_adjust_ref_current_is_render_known(
                    &member_expression.object,
                    component_node_id,
                    ctx,
                    visited_symbol_ids,
                    substitutions,
                    remaining_call_frames,
                ) {
                    return false;
                }
            }
            AstKind::ComputedMemberExpression(member_expression)
                if member_expression.static_property_name().as_deref() == Some("current")
                    && no_adjust_expression_is_ref_value(&member_expression.object, ctx) =>
            {
                if !no_adjust_ref_current_is_render_known(
                    &member_expression.object,
                    component_node_id,
                    ctx,
                    visited_symbol_ids,
                    substitutions,
                    remaining_call_frames,
                ) {
                    return false;
                }
            }
            _ => {}
        }
    }
    true
}

fn no_adjust_identifier_is_jsx_element_name(
    identifier_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut current = identifier_node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::JSXMemberExpression(_) => current = parent,
            AstKind::JSXOpeningElement(opening_element) => {
                return opening_element
                    .name
                    .span()
                    .contains_inclusive(identifier_node.span());
            }
            AstKind::JSXClosingElement(closing_element) => {
                return closing_element
                    .name
                    .span()
                    .contains_inclusive(identifier_node.span());
            }
            _ => return false,
        }
    }
}

fn no_adjust_value_helper_call_is_render_known<'node, 'ast>(
    call: &'node oxc_ast::ast::CallExpression<'ast>,
    component_node_id: NodeId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    substitutions: &FxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
) -> bool {
    if is_react_hook_call(call, &["useMemo"], ctx) {
        let Some(function_id) = call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(|callback| no_adjust_state_fact_callback_function_id(callback, ctx))
        else {
            return false;
        };
        let mut returned_expression_count = 0;
        let mut all_returns_are_render_known = true;
        no_adjust_for_each_returned_expression(function_id, ctx, |returned_expression| {
            returned_expression_count += 1;
            all_returns_are_render_known &= no_adjust_expression_is_render_known_with_context(
                returned_expression,
                component_node_id,
                ctx,
                visited_symbol_ids,
                substitutions,
                remaining_call_frames,
            );
        });
        return returned_expression_count > 0 && all_returns_are_render_known;
    }
    if remaining_call_frames == 0 {
        return false;
    }
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    let Some(function_id) = no_adjust_state_fact_callback_function_id(&call.callee, ctx) else {
        return false;
    };
    if no_adjust_nearest_function_node_id(function_id, ctx).is_none()
        || no_adjust_function_is_async(function_id, ctx)
        || matches!(ctx.nodes().get_node(function_id).kind(), AstKind::Function(function) if function.generator)
        || no_adjust_state_fact_function_invokes_itself(function_id, ctx)
    {
        return false;
    }
    let Some(callee_symbol_id) = ctx
        .scoping()
        .get_reference(callee.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&callee_symbol_id) {
        return false;
    }
    let parameter_symbol_ids = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function
            .params
            .items
            .iter()
            .map(|parameter| {
                parameter
                    .pattern
                    .get_binding_identifier()
                    .map(|identifier| identifier.symbol_id())
            })
            .collect::<Vec<_>>(),
        AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .iter()
            .map(|parameter| {
                parameter
                    .pattern
                    .get_binding_identifier()
                    .map(|identifier| identifier.symbol_id())
            })
            .collect::<Vec<_>>(),
        _ => return false,
    };
    let mut helper_substitutions = substitutions.clone();
    for (parameter_index, parameter_symbol_id) in parameter_symbol_ids.iter().enumerate() {
        let Some(parameter_symbol_id) = parameter_symbol_id else {
            continue;
        };
        let Some(argument) = call
            .arguments
            .get(parameter_index)
            .and_then(Argument::as_expression)
        else {
            continue;
        };
        helper_substitutions.insert(*parameter_symbol_id, argument);
    }
    visited_symbol_ids.push(callee_symbol_id);
    let mut returned_expression_count = 0;
    let mut all_returns_are_render_known = true;
    no_adjust_for_each_returned_expression(function_id, ctx, |returned_expression| {
        returned_expression_count += 1;
        all_returns_are_render_known &= !no_adjust_returned_local_collection_has_member_write(
            returned_expression,
            function_id,
            ctx,
        ) && no_adjust_expression_is_render_known_with_context(
            returned_expression,
            component_node_id,
            ctx,
            visited_symbol_ids,
            &helper_substitutions,
            remaining_call_frames - 1,
        );
    });
    visited_symbol_ids.pop();
    returned_expression_count > 0 && all_returns_are_render_known
}

fn no_adjust_returned_local_collection_has_member_write(
    returned_expression: &Expression<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = returned_expression.get_inner_expression() else {
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
    if no_adjust_nearest_function_node_id(declaration.id(), ctx) != Some(function_id)
        || !declarator.init.as_ref().is_some_and(|initializer| {
            matches!(
                initializer.get_inner_expression(),
                Expression::ArrayExpression(_) | Expression::ObjectExpression(_)
            )
        })
    {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if no_adjust_nearest_function_node_id(reference_node.id(), ctx) != Some(function_id) {
                return false;
            }
            ctx.nodes()
                .ancestors(reference_node.id())
                .take_while(|ancestor| ancestor.id() != function_id)
                .find_map(|ancestor| {
                    matches!(ancestor.kind(), AstKind::AssignmentExpression(assignment)
                        if assignment.left.span().contains_inclusive(reference_node.span()))
                    .then_some(())
                })
                .is_some()
        })
}

fn no_adjust_identifier_is_consumed_by_render_known_helper<'node, 'ast>(
    identifier_node: &'node AstNode<'ast>,
    expression_span: oxc_span::Span,
    component_node_id: NodeId,
    ctx: &'node LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    substitutions: &FxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
) -> bool {
    ctx.nodes()
        .ancestors(identifier_node.id())
        .take_while(|ancestor| expression_span.contains_inclusive(ancestor.span()))
        .any(|ancestor| {
            let AstKind::CallExpression(call) = ancestor.kind() else {
                return false;
            };
            call.arguments.iter().any(|argument| {
                argument.as_expression().is_some_and(|argument| {
                    argument.span().contains_inclusive(identifier_node.span())
                })
            }) && no_adjust_value_helper_call_is_render_known(
                call,
                component_node_id,
                ctx,
                visited_symbol_ids,
                substitutions,
                remaining_call_frames,
            )
        })
}

fn no_adjust_identifier_is_value_helper_callee(
    identifier_node: &AstNode<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(identifier_node.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    call.callee.span() == identifier_node.span()
        && ctx
            .scoping()
            .get_reference(match identifier_node.kind() {
                AstKind::IdentifierReference(identifier) => identifier.reference_id(),
                _ => return false,
            })
            .symbol_id()
            == Some(symbol_id)
        && no_adjust_state_fact_callback_function_id(&call.callee, ctx).is_some()
}

fn no_adjust_identifier_is_ref_current_object(
    identifier_node: &AstNode<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(identifier_node.id());
    parent
        .kind()
        .as_member_expression_kind()
        .is_some_and(|member| {
            member.object().span() == identifier_node.span()
                && member.static_property_name().as_deref() == Some("current")
                && no_adjust_symbol_is_ref_value(symbol_id, ctx, &mut Vec::new())
        })
}

fn no_adjust_ref_current_values<'a>(
    ref_expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<(SymbolId, Vec<&'a Expression<'a>>)> {
    let Expression::Identifier(identifier) = ref_expression.get_inner_expression() else {
        return None;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return None;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let Some(Expression::CallExpression(ref_call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return None;
    };
    if no_adjust_call_callee_name(ref_call) != Some("useRef") {
        return None;
    }
    let mut values = ref_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .into_iter()
        .collect::<Vec<_>>();
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let member_node = ctx.nodes().parent_node(reference_node.id());
        let Some(member) = member_node.kind().as_member_expression_kind() else {
            return None;
        };
        if member.object().span() != reference_node.span()
            || member.static_property_name().as_deref() != Some("current")
        {
            return None;
        }
        let member_parent = ctx.nodes().parent_node(member_node.id());
        match member_parent.kind() {
            AstKind::AssignmentExpression(assignment)
                if assignment.left.span() == member_node.span() =>
            {
                if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign {
                    return None;
                }
                values.push(&assignment.right);
            }
            AstKind::UpdateExpression(_) => return None,
            _ => {}
        }
    }
    Some((symbol_id, values))
}

fn no_adjust_ref_current_is_render_known<'node, 'ast>(
    ref_expression: &Expression<'ast>,
    component_node_id: NodeId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    substitutions: &FxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
) -> bool {
    let Some((symbol_id, values)) = no_adjust_ref_current_values(ref_expression, ctx) else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let is_render_known = values.into_iter().all(|value| {
        no_adjust_expression_is_render_known_with_context(
            value,
            component_node_id,
            ctx,
            visited_symbol_ids,
            substitutions,
            remaining_call_frames,
        )
    });
    visited_symbol_ids.pop();
    is_render_known
}

fn no_adjust_expression_is_locally_constructed_collection(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
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
    matches!(ctx.symbol_declaration(symbol_id).kind(), AstKind::VariableDeclarator(declarator)
        if declarator.init.as_ref().is_some_and(|initializer| matches!(initializer.get_inner_expression(),
            Expression::ArrayExpression(_) | Expression::ObjectExpression(_))))
}

fn no_adjust_expression_is_ref_value<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
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
    no_adjust_symbol_is_ref_value(symbol_id, ctx, &mut Vec::new())
}

fn no_adjust_symbol_is_ref_value(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let is_ref_value = if let AstKind::VariableDeclarator(declarator) = declaration.kind() {
        declarator.init.as_ref().is_some_and(|initializer| {
            match initializer.get_inner_expression() {
                Expression::CallExpression(call_expression) => {
                    is_react_hook_call(call_expression, &["useRef"], ctx)
                }
                Expression::Identifier(identifier) => ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_some_and(|source_symbol_id| {
                        no_adjust_symbol_is_ref_value(source_symbol_id, ctx, visited_symbol_ids)
                    }),
                _ => false,
            }
        })
    } else {
        false
    };
    visited_symbol_ids.pop();
    is_ref_value
}

fn no_adjust_is_inside_ignored_pure_callback(
    node_id: NodeId,
    expression_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .take_while(|ancestor| expression_span.contains_inclusive(ancestor.span()))
        .any(|ancestor| no_adjust_function_is_ignored_pure_callback(ancestor, ctx))
}

fn no_adjust_function_is_ignored_pure_callback(
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if !matches!(
        function_node.kind(),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
    ) {
        return false;
    }
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    call_expression.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == function_node.span())
    }) && (no_adjust_is_pure_call(call_expression, ctx)
        || is_react_hook_call(call_expression, &["useMemo"], ctx))
}

fn no_adjust_symbol_is_render_known_with_context<'node, 'ast>(
    symbol_id: SymbolId,
    component_node_id: NodeId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    substitutions: &FxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
) -> bool {
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::FormalParameter(_) => {
            no_adjust_symbol_is_component_parameter(symbol_id, component_node_id, ctx)
        }
        AstKind::ImportSpecifier(_)
        | AstKind::ImportDefaultSpecifier(_)
        | AstKind::ImportNamespaceSpecifier(_) => false,
        AstKind::VariableDeclarator(declarator) => {
            if matches!(&declarator.id, BindingPattern::ArrayPattern(_)) {
                return no_adjust_symbol_is_state_value(symbol_id, ctx)
                    && !no_adjust_state_is_externally_driven(symbol_id, component_node_id, ctx);
            }
            visited_symbol_ids.push(symbol_id);
            let is_render_known =
                no_adjust_symbol_value_expression(symbol_id, ctx).is_some_and(|value| {
                    no_adjust_expression_is_render_known_with_context(
                        value,
                        component_node_id,
                        ctx,
                        visited_symbol_ids,
                        substitutions,
                        remaining_call_frames,
                    )
                });
            visited_symbol_ids.pop();
            is_render_known
        }
        _ => false,
    }
}

fn no_adjust_identifier_is_allowed_updater_spread(
    identifier_node: &AstNode<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    if !no_adjust_symbol_is_state_updater_parameter(symbol_id, ctx) {
        return false;
    }
    let spread_node = ctx.nodes().parent_node(identifier_node.id());
    if !matches!(spread_node.kind(), AstKind::SpreadElement(spread)
        if spread.argument.span() == identifier_node.span())
    {
        return false;
    }
    matches!(
        ctx.nodes().parent_node(spread_node.id()).kind(),
        AstKind::ObjectExpression(_)
    )
}

fn no_adjust_symbol_value_expression<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return None;
    };
    let write_references = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| {
            if !reference.is_write() {
                return false;
            }
            let reference_node = ctx.nodes().get_node(reference.node_id());
            matches!(ctx.nodes().parent_node(reference_node.id()).kind(),
                AstKind::AssignmentExpression(assignment)
                    if assignment.left.span() == reference_node.span()
            ) || matches!(ctx.nodes().parent_node(reference_node.id()).kind(),
                AstKind::UpdateExpression(update)
                    if update.argument.span() == reference_node.span()
            )
        })
        .collect::<Vec<_>>();
    if write_references.is_empty() {
        return declarator.init.as_ref();
    }
    let [write_reference] = write_references.as_slice() else {
        return None;
    };
    let reference_node = ctx.nodes().get_node(write_reference.node_id());
    let AstKind::AssignmentExpression(assignment) =
        ctx.nodes().parent_node(reference_node.id()).kind()
    else {
        return None;
    };
    (assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign
        && assignment.left.span() == reference_node.span())
    .then_some(&assignment.right)
}

fn no_adjust_is_pure_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            NO_ADJUST_PURE_DIRECT_CALLS.contains(&identifier.name.as_str())
                && no_adjust_identifier_is_global(identifier, ctx)
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            member.static_property_name().is_some_and(|property_name| {
                NO_ADJUST_PURE_MEMBER_CALLS.contains(&property_name)
                    || no_adjust_is_pure_namespace_member_call(member.object(), property_name, ctx)
            })
        }),
    }
}

fn no_adjust_is_pure_constructor(
    new_expression: &oxc_ast::ast::NewExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(
        new_expression.callee.get_inner_expression(),
        Expression::Identifier(identifier)
            if matches!(identifier.name.as_str(), "Date" | "Set")
                && no_adjust_identifier_is_global(identifier, ctx)
    )
}

fn no_adjust_is_pure_namespace_member_call(
    object: &Expression<'_>,
    property_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = object.get_inner_expression() else {
        return false;
    };
    if !no_adjust_identifier_is_global(identifier, ctx) {
        return false;
    }
    match identifier.name.as_str() {
        "Array" => property_name == "from",
        "JSON" => matches!(
            property_name,
            "isRawJSON" | "parse" | "rawJSON" | "stringify"
        ),
        "Math" => matches!(
            property_name,
            "abs"
                | "acos"
                | "acosh"
                | "asin"
                | "asinh"
                | "atan"
                | "atan2"
                | "atanh"
                | "cbrt"
                | "ceil"
                | "clz32"
                | "cos"
                | "cosh"
                | "exp"
                | "floor"
                | "fround"
                | "hypot"
                | "imul"
                | "log"
                | "log10"
                | "log1p"
                | "log2"
                | "max"
                | "min"
                | "pow"
                | "round"
                | "sign"
                | "sin"
                | "sinh"
                | "sqrt"
                | "tan"
                | "tanh"
                | "trunc"
        ),
        "Object" => property_name == "assign",
        _ => false,
    }
}

fn no_adjust_identifier_is_global(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_none()
}
