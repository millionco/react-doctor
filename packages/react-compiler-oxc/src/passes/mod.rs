//! The post-lowering optimization/transform pipeline, ported pass-by-pass from
//! `Entrypoint/Pipeline.ts::runWithEnvironment` (the portion after `lower`).
//!
//! Each pass mutates the [`HirFunction`] in place, matching the TS. Passes that
//! synthesize new blocks or temporaries (currently only
//! [`inline_iife::inline_immediately_invoked_function_expressions`]) draw fresh
//! ids from the [`PassContext`], which continues the id sequences the lowering
//! [`Environment`](crate::environment::Environment) left off at.
//!
//! [`run_to_stage`] is the driver: it applies the passes in pipeline order up to
//! and including a named stage and is the structure later stages (type
//! inference, …) extend. The implemented chain is
//! `PruneMaybeThrows -> InlineIIFE -> MergeConsecutiveBlocks -> enterSSA ->
//! eliminateRedundantPhi -> constantPropagation`; the `MergeConsecutiveBlocks`
//! stage is the result of the first three, `SSA` adds [`enter_ssa`],
//! `EliminateRedundantPhi` adds [`eliminate_redundant_phi`], and
//! `ConstantPropagation` adds [`constant_propagation`] (which re-runs the
//! redundant-phi + block-merge cleanup internally across its SCCP fixpoint).

pub mod align_method_call_scopes;
pub mod align_object_method_scopes;
pub mod align_reactive_scopes_to_block_scopes_hir;
pub mod analyse_functions;
pub mod build_reactive_scope_terminals_hir;
pub mod cfg;
pub mod constant_propagation;
pub mod control_dominators;
pub mod dead_code_elimination;
pub mod disjoint_set;
pub mod drop_manual_memoization;
pub mod eliminate_redundant_phi;
pub mod enter_ssa;
pub mod find_disjoint_mutable_values;
pub mod flatten_reactive_loops_hir;
pub mod flatten_scopes_with_hooks_or_use_hir;
pub mod infer_mutation_aliasing_effects;
pub mod infer_mutation_aliasing_ranges;
pub mod infer_reactive_places;
pub mod infer_reactive_scope_variables;
pub mod inline_iife;
pub mod memoize_fbt_and_macro_operands_in_same_scope;
pub mod merge_consecutive_blocks;
pub mod merge_overlapping_reactive_scopes_hir;
pub mod name_anonymous_functions;
pub mod optimize_props_method_calls;
pub mod outline_functions;
pub mod outline_jsx;
pub mod propagate_scope_dependencies_hir;
pub mod prune_maybe_throws;
pub mod prune_unused_labels_hir;
pub mod reactive_scope_util;
pub mod rewrite_instruction_kinds;
pub mod validate_hooks_usage;

use crate::hir::ids::{BlockId, IdAllocator, IdentifierId};
use crate::hir::model::HirFunction;

/// Shared id state for the post-lowering passes, continuing the lowering
/// environment's `nextBlockId` / `nextIdentifierId` counters. Passes that create
/// new blocks or temporaries (e.g. IIFE inlining) draw fresh ids from here so the
/// `bbN` / `$N` numbering stays consistent with stage-1 output.
///
/// `next_scope` mirrors `env.nextScopeId`: it starts at `0` per top-level
/// function (each function lowers with its own `Environment`) and is the single
/// monotonic counter shared by the outer function's
/// `inferReactiveScopeVariables` and every nested function analysed earlier by
/// `AnalyseFunctions`. Nested functions are analysed first and consume the low
/// scope ids; the outer function continues from there — so the `_@N` suffixes
/// match the oracle's allocation order.
#[derive(Clone, Debug)]
pub struct PassContext {
    next_block: IdAllocator,
    next_identifier: IdAllocator,
    next_scope: IdAllocator,
}

impl PassContext {
    /// A context seeded so the next allocated block/identifier ids are
    /// `next_block_id` / `next_identifier_id` respectively (the peeked counters
    /// from the lowering [`Environment`](crate::environment::Environment)). The
    /// scope counter starts at `0` (no scopes are allocated during lowering).
    pub fn new(next_block_id: u32, next_identifier_id: u32) -> Self {
        PassContext {
            next_block: IdAllocator::starting_at(next_block_id),
            next_identifier: IdAllocator::starting_at(next_identifier_id),
            next_scope: IdAllocator::new(),
        }
    }

    /// `env.nextBlockId`: the next [`BlockId`] (post-increment).
    pub fn next_block_id(&mut self) -> BlockId {
        BlockId::new(self.next_block.alloc())
    }

    /// Advance the block-id counter by `n` without using the ids. The oracle's
    /// `env.nextBlockId` is bumped once per post-dominator computation
    /// (`buildReverseGraph` allocates a synthetic exit-block id). Several
    /// pre-`BuildReactiveScopeTerminalsHIR` passes — `validateHooksUsage`,
    /// `validateNoSetStateInRender` (recursing into setState-referencing nested
    /// functions), and `inferReactivePlaces` — compute post-dominators, so the
    /// counter is higher than the surviving block count by exactly that many.
    /// `BuildReactiveScopeTerminalsHIR` allocates its new scope blocks from this
    /// counter, so it must be pre-advanced to match the oracle's block ids.
    pub fn bump_block_id(&mut self, n: u32) {
        for _ in 0..n {
            self.next_block.alloc();
        }
    }

    /// `env.nextIdentifierId`: the next [`IdentifierId`] (post-increment).
    pub fn next_identifier_id(&mut self) -> IdentifierId {
        IdentifierId::new(self.next_identifier.alloc())
    }

    /// Mutable access to the shared scope-id allocator (`env.nextScopeId`),
    /// threaded into `AnalyseFunctions` (for nested functions) and the outer
    /// `inferReactiveScopeVariables`.
    pub fn scope_allocator(&mut self) -> &mut IdAllocator {
        &mut self.next_scope
    }
}

/// The uniquely-named pipeline stages that can be requested. `Hir` is the raw
/// lowering output (no passes run); the rest are the snapshots logged by
/// `runWithEnvironment` after the correspondingly-named pass. The
/// `PruneMaybeThrows` / `InlineImmediatelyInvokedFunctionExpressions` snapshots
/// are intentionally not exposed: the oracle logs `PruneMaybeThrows` twice, and
/// inline-IIFE is validated transitively via `MergeConsecutiveBlocks` (which is
/// the result of the inline + merge passes). `DropManualMemoization` *is*
/// exposed — it is the snapshot after `pruneMaybeThrows` + the manual-memo
/// rewrite, before inline-IIFE.
const STAGE_ORDER: &[&str] = &[
    "HIR",
    "DropManualMemoization",
    "MergeConsecutiveBlocks",
    "SSA",
    "EliminateRedundantPhi",
    "ConstantPropagation",
    "InferTypes",
    "OptimizePropsMethodCalls",
    "AnalyseFunctions",
    "InferMutationAliasingEffects",
    "DeadCodeElimination",
    "InferMutationAliasingRanges",
    "InferReactivePlaces",
    "RewriteInstructionKindsBasedOnReassignment",
    "InferReactiveScopeVariables",
    "MemoizeFbtAndMacroOperandsInSameScope",
    "OutlineFunctions",
    "AlignMethodCallScopes",
    "AlignObjectMethodScopes",
    "PruneUnusedLabelsHIR",
    "AlignReactiveScopesToBlockScopesHIR",
    "MergeOverlappingReactiveScopesHIR",
    "BuildReactiveScopeTerminalsHIR",
    "FlattenReactiveLoopsHIR",
    "FlattenScopesWithHooksOrUseHIR",
    "PropagateScopeDependenciesHIR",
    "BuildReactiveFunction",
    // Stage 6: the post-`BuildReactiveFunction` ReactiveFunction passes. These
    // run in `compile.rs` (they operate on the `ReactiveFunction` tree, not the
    // HIR `run_to_stage` chain), but are listed here so `is_known_stage` /
    // `stage_at_least` recognize them and order them correctly.
    "PruneUnusedLabels",
    "PruneNonEscapingScopes",
    "PruneNonReactiveDependencies",
    "PruneUnusedScopes",
    "MergeReactiveScopesThatInvalidateTogether",
    "PruneAlwaysInvalidatingScopes",
    "PropagateEarlyReturns",
    "PruneUnusedLValues",
    "PromoteUsedTemporaries",
    "ExtractScopeDeclarationsFromDestructuring",
    "StabilizeBlockIds",
    "RenameVariables",
    "PruneHoistedContexts",
];

/// Whether `stage` names a stage this driver can run to.
pub fn is_known_stage(stage: &str) -> bool {
    STAGE_ORDER.contains(&stage)
}

/// Whether `stage` is at or beyond `target` in pipeline order. Used by the
/// caller (`compile.rs`) to gate the post-`run_to_stage` passes it owns
/// (`InferTypes`, `OptimizePropsMethodCalls`) which need state `run_to_stage`
/// does not carry. Returns `false` if either name is unknown.
pub fn stage_at_least(stage: &str, target: &str) -> bool {
    match (
        STAGE_ORDER.iter().position(|s| *s == stage),
        STAGE_ORDER.iter().position(|s| *s == target),
    ) {
        (Some(have), Some(want)) => have >= want,
        _ => false,
    }
}

/// Run the pipeline on `func` in place, applying every pass up to and including
/// `stage`. `stage == "HIR"` is a no-op (the raw lowering output). Returns
/// `false` if `stage` is unknown (leaving `func` untouched).
///
/// The currently-supported chain is the cleanup passes; the `DropManualMemoization`
/// stage runs `PruneMaybeThrows -> DropManualMemoization`, and the
/// `MergeConsecutiveBlocks` stage continues with `InlineIIFE ->
/// MergeConsecutiveBlocks`. `is_validation_enabled` is the caller's
/// `EnvironmentConfig::is_memoization_validation_enabled` — it gates whether
/// `dropManualMemoization` inserts `StartMemoize`/`FinishMemoize` markers.
pub fn run_to_stage(
    func: &mut HirFunction,
    ctx: &mut PassContext,
    stage: &str,
    is_validation_enabled: bool,
) -> bool {
    let Some(target) = STAGE_ORDER.iter().position(|s| *s == stage) else {
        return false;
    };

    // `HIR` (index 0): nothing to do.
    // `DropManualMemoization` (index 1): prune-maybe-throws then rewrite manual
    // memoization. In the TS, `validateContextVariableLValues`/`validateUseMemo`
    // run between these two (they only record diagnostics, no IR change), so the
    // snapshot shape is unaffected.
    if target >= 1 {
        prune_maybe_throws::prune_maybe_throws(func, ctx);
        drop_manual_memoization::drop_manual_memoization(func, ctx, is_validation_enabled);
    }

    // `MergeConsecutiveBlocks` (index 2): the rest of the cleanup chain.
    // `mergeConsecutiveBlocks` runs both inside `inlineIIFE` (after its
    // re-minification) and once on its own, exactly as the TS pipeline sequences it.
    if target >= 2 {
        inline_iife::inline_immediately_invoked_function_expressions(func, ctx);
        merge_consecutive_blocks::merge_consecutive_blocks(func, ctx);
    }

    // `SSA` (index 3): rename into SSA form, inserting phis.
    if target >= 3 {
        enter_ssa::enter_ssa(func, ctx);
    }

    // `EliminateRedundantPhi` (index 4): drop trivial phis.
    if target >= 4 {
        eliminate_redundant_phi::eliminate_redundant_phi(func, ctx);
    }

    // `ConstantPropagation` (index 5): SCCP folding + conditional pruning, with
    // its own internal re-run of eliminateRedundantPhi/mergeConsecutiveBlocks.
    // (Also runs for `InferTypes`, which is the same HIR plus inferred types.)
    if target >= 5 {
        constant_propagation::constant_propagation(func, ctx);
    }

    // `InferTypes` (index 5): the type-inference pass is driven by the caller
    // (`compile.rs`) rather than here, because it needs the type provider built
    // from the lowering `Environment`; `run_to_stage` only owns the id-allocating
    // passes. Reaching here for `InferTypes` means the HIR is at the
    // `ConstantPropagation` fixpoint, ready for `type_inference::infer_types`.

    true
}
