use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str =
    "`get()` runs before Zustand installs the initial state, so it returns `undefined` here.";

#[derive(Debug, Default, Clone)]
pub struct ZustandNoGetDuringInitialization;

declare_oxc_lint!(
    /// Warns when a Zustand store creator eagerly reads from get().
    ZustandNoGetDuringInitialization,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Zustand get() called during store initialization.",
);

impl Rule for ZustandNoGetDuringInitialization {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut creator_function_ids = Vec::new();
        let mut seen_creator_function_ids = FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if let Some(creator) =
                resolve_zustand_store_creator(call_expression, ctx, &mut resolution_cache)
                && seen_creator_function_ids.insert(creator.creator_function_id)
            {
                creator_function_ids.push(creator.creator_function_id);
            }
        }
        if creator_function_ids.is_empty() {
            return;
        }

        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let suspension_analysis = zustand_build_async_suspension_analysis(ctx);
        for creator_function_id in creator_function_ids {
            let Some(get_parameter_symbol_id) =
                zustand_get_parameter_symbol_id(creator_function_id, ctx)
            else {
                continue;
            };
            let mut visited_function_ids = FxHashSet::default();
            zustand_report_eager_get_calls(
                creator_function_id,
                get_parameter_symbol_id,
                &node_index,
                &suspension_analysis,
                ctx,
                &mut resolution_cache,
                &mut visited_function_ids,
            );
        }
    }
}

struct ZustandAsyncSuspensionAnalysis {
    suspensions_by_function_id: FxHashMap<NodeId, Vec<(NodeId, oxc_cfg::BlockNodeId)>>,
}

fn zustand_build_async_suspension_analysis(
    ctx: &LintContext<'_>,
) -> ZustandAsyncSuspensionAnalysis {
    let mut suspensions_by_function_id = FxHashMap::default();
    for node in ctx.nodes().iter() {
        let suspension_block = match node.kind() {
            AstKind::AwaitExpression(_) => ctx.nodes().cfg_id(node.id()),
            AstKind::ForOfStatement(statement) if statement.r#await => {
                ctx.nodes().cfg_id(statement.right.node_id())
            }
            _ => continue,
        };
        let Some(function_id) = local_callback_nearest_function_id(node.id(), ctx) else {
            continue;
        };
        suspensions_by_function_id
            .entry(function_id)
            .or_insert_with(Vec::new)
            .push((node.id(), suspension_block));
    }
    ZustandAsyncSuspensionAnalysis {
        suspensions_by_function_id,
    }
}

fn zustand_get_parameter_symbol_id(
    creator_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let function_node = ctx.nodes().get_node(creator_function_id);
    let (parameters, is_generator) = match function_node.kind() {
        AstKind::Function(function) => (&function.params, function.generator),
        AstKind::ArrowFunctionExpression(function) => (&function.params, false),
        _ => return None,
    };
    if is_generator {
        return None;
    }
    let parameter_pattern = &parameters.items.get(1)?.pattern;
    match parameter_pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
        BindingPattern::AssignmentPattern(assignment) => assignment
            .left
            .get_binding_identifier()
            .map(oxc_ast::ast::BindingIdentifier::symbol_id),
        _ => None,
    }
}

fn zustand_report_eager_get_calls<'a>(
    function_id: NodeId,
    get_parameter_symbol_id: SymbolId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    suspension_analysis: &ZustandAsyncSuspensionAnalysis,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    visited_function_ids: &mut FxHashSet<NodeId>,
) {
    if !visited_function_ids.insert(function_id) {
        return;
    }
    for &candidate_id in node_index.node_ids(function_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        if zustand_is_get_parameter_call(&call_expression.callee, get_parameter_symbol_id, ctx) {
            if zustand_can_execute_before_async_suspension(
                candidate,
                function_id,
                suspension_analysis,
                ctx,
            ) {
                ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(call_expression.span));
            }
            continue;
        }
        if !zustand_can_execute_before_async_suspension(
            candidate,
            function_id,
            suspension_analysis,
            ctx,
        ) {
            continue;
        }
        let Some(called_function_id) = exact_local_function_id(
            &call_expression.callee,
            ctx,
            &mut Vec::new(),
            resolution_cache,
        ) else {
            continue;
        };
        if called_function_id != function_id {
            zustand_report_eager_get_calls(
                called_function_id,
                get_parameter_symbol_id,
                node_index,
                suspension_analysis,
                ctx,
                resolution_cache,
                visited_function_ids,
            );
        }
    }
}

fn zustand_is_get_parameter_call<'a>(
    callee: &Expression<'a>,
    get_parameter_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = callee.get_inner_expression() else {
        return false;
    };
    resolve_const_identifier_root_symbol(identifier, ctx) == Some(get_parameter_symbol_id)
}

fn zustand_function_is_async(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn zustand_can_execute_before_async_suspension(
    candidate: &crate::AstNode<'_>,
    function_id: NodeId,
    suspension_analysis: &ZustandAsyncSuspensionAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    if !is_node_reachable_within_function(candidate, function_node, ctx) {
        return false;
    }
    if !zustand_function_is_async(function_id, ctx) {
        return true;
    }
    if zustand_is_inside_for_await_post_suspension_region(candidate, function_id, ctx) {
        return false;
    }

    let target_block = ctx.nodes().cfg_id(candidate.id());
    let mut suspension_blocks = FxHashSet::default();
    for &(suspension_id, suspension_block) in suspension_analysis
        .suspensions_by_function_id
        .get(&function_id)
        .into_iter()
        .flatten()
    {
        let suspension = ctx.nodes().get_node(suspension_id);
        if suspension_block == target_block {
            if zustand_suspension_occurs_before_candidate(suspension, candidate, ctx) {
                return false;
            }
        } else {
            suspension_blocks.insert(suspension_block);
        }
    }

    zustand_cfg_block_can_reach_without_suspension(
        ctx.nodes().cfg_id(function_id),
        target_block,
        &suspension_blocks,
        ctx,
    )
}

fn zustand_is_inside_for_await_post_suspension_region(
    candidate: &crate::AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let candidate_span = candidate.span();
    let mut current_id = candidate.id();
    while current_id != function_id {
        let parent = ctx.nodes().parent_node(current_id);
        if let AstKind::ForOfStatement(statement) = parent.kind()
            && statement.r#await
            && (statement.left.span().contains_inclusive(candidate_span)
                || statement.body.span().contains_inclusive(candidate_span))
        {
            return true;
        }
        if parent.id() == current_id {
            return false;
        }
        current_id = parent.id();
    }
    false
}

fn zustand_suspension_occurs_before_candidate(
    suspension: &crate::AstNode<'_>,
    candidate: &crate::AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let candidate_span = candidate.span();
    match suspension.kind() {
        AstKind::AwaitExpression(await_expression) => {
            if await_expression
                .argument
                .span()
                .contains_inclusive(candidate_span)
            {
                return false;
            }
            zustand_is_descendant_without_function_boundary(suspension, candidate, ctx)
                || suspension.span().start < candidate_span.start
        }
        AstKind::ForOfStatement(statement) if statement.r#await => {
            if statement.right.span().contains_inclusive(candidate_span) {
                return false;
            }
            zustand_is_descendant_without_function_boundary(suspension, candidate, ctx)
                || statement.right.span().start < candidate_span.start
        }
        _ => false,
    }
}

fn zustand_is_descendant_without_function_boundary(
    descendant: &crate::AstNode<'_>,
    ancestor: &crate::AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut current_id = descendant.id();
    while current_id != ancestor.id() {
        let parent = ctx.nodes().parent_node(current_id);
        if parent.id() == current_id
            || matches!(
                parent.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        {
            return false;
        }
        current_id = parent.id();
    }
    true
}

fn zustand_cfg_block_can_reach_without_suspension(
    source_block: oxc_cfg::BlockNodeId,
    target_block: oxc_cfg::BlockNodeId,
    suspension_blocks: &FxHashSet<oxc_cfg::BlockNodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    if source_block == target_block {
        return true;
    }
    if suspension_blocks.contains(&source_block) {
        return false;
    }
    let graph = ctx.cfg().graph();
    let mut visited_blocks = FxHashSet::default();
    let mut pending_blocks = vec![source_block];
    while let Some(current_block) = pending_blocks.pop() {
        if !visited_blocks.insert(current_block) {
            continue;
        }
        for edge in graph.edges_directed(current_block, oxc_cfg::graph::Direction::Outgoing) {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction
                    | oxc_cfg::EdgeType::Unreachable
                    | oxc_cfg::EdgeType::Error(_)
            ) {
                continue;
            }
            let next_block = oxc_cfg::graph::visit::EdgeRef::target(&edge);
            if suspension_blocks.contains(&next_block) {
                continue;
            }
            if next_block == target_block {
                return true;
            }
            pending_blocks.push(next_block);
        }
    }
    false
}
