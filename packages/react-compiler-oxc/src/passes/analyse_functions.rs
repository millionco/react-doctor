//! `AnalyseFunctions` — port of `Inference/AnalyseFunctions.ts`.
//!
//! Recursively runs the mutation/aliasing sub-pipeline on every nested
//! `FunctionExpression`/`ObjectMethod` so the outer
//! [`infer_mutation_aliasing_effects`] knows their effects/signatures.
//!
//! The TS `lowerWithMutationAliasing` runs, in order: `analyseFunctions`
//! (recursive), `inferMutationAliasingEffects(isFunctionExpression: true)`,
//! `deadCodeElimination`, `inferMutationAliasingRanges`,
//! `rewriteInstructionKindsBasedOnReassignment`, `inferReactiveScopeVariables`,
//! then sets `fn.aliasingEffects` and populates each context operand's `Effect`.
//!
//! This port implements the recursive analysis + effect inference on the inner
//! function (so the inner body's instruction `effects` are populated, matching
//! the oracle for functions without their own nested fns), plus the inner
//! `inferReactiveScopeVariables` (reactive-scope construction): the inner body's
//! identifiers get their `_@<scopeId>` suffix and scope-merged `mutableRange`s,
//! drawing scope ids from the pipeline's shared `nextScopeId` counter (passed as
//! `next_scope`). The function-level `aliasingEffects` summary and the context
//! operand `Effect` (Read/Capture) are approximated from the inferred effects so
//! the outer `CreateFunction` capture set is computed correctly.

use std::collections::HashSet;

use crate::hir::ids::{IdAllocator, IdentifierId};
use crate::hir::instruction::AliasingEffect;
use crate::hir::model::HirFunction;
use crate::hir::place::{Effect, MutableRange};
use crate::hir::value::InstructionValue;

use super::dead_code_elimination::dead_code_elimination;
use super::infer_mutation_aliasing_effects::infer_mutation_aliasing_effects;
use super::infer_mutation_aliasing_ranges::infer_mutation_aliasing_ranges;
use super::infer_reactive_scope_variables::infer_reactive_scope_variables;
use super::rewrite_instruction_kinds::rewrite_instruction_kinds_based_on_reassignment;

/// `analyseFunctions(func)`.
///
/// `next_scope` is the shared `nextScopeId` allocator threaded through the
/// pipeline, so nested-function `inferReactiveScopeVariables` draws scope ids
/// from the same monotonic sequence as the eventual outer call.
pub fn analyse_functions(
    func: &mut HirFunction,
    next_scope: &mut IdAllocator,
    enable_preserve: bool,
    transitively_freeze_fn_exprs: bool,
) {
    for block in func.body.blocks_mut() {
        for instr in &mut block.instructions {
            match &mut instr.value {
                InstructionValue::ObjectMethod { lowered_func, .. }
                | InstructionValue::FunctionExpression { lowered_func, .. } => {
                    lower_with_mutation_aliasing(
                        &mut lowered_func.func,
                        next_scope,
                        enable_preserve,
                        transitively_freeze_fn_exprs,
                    );

                    // Reset mutable range / scope for the outer inference. In the
                    // TS the `Identifier` is shared by reference, so this reset is
                    // observed by every body reference of the context var; we clone
                    // identifiers into places, so propagate the reset to all body
                    // references too (`props$16[1:8]` -> `props$16`).
                    let reset_ids: Vec<IdentifierId> = lowered_func
                        .func
                        .context
                        .iter()
                        .map(|operand| operand.identifier.id)
                        .collect();
                    for operand in &mut lowered_func.func.context {
                        operand.identifier.mutable_range = MutableRange::default();
                        operand.identifier.scope = None;
                        operand.identifier.range_scope = None;
                    }
                    reset_context_references(&mut lowered_func.func, &reset_ids);
                }
                _ => {}
            }
        }
    }
}

/// Reset the `mutableRange`/`scope` of every body reference to a context
/// identifier (after the outer `AnalyseFunctions` reset its `context` operands),
/// mirroring TS's shared-identifier reference semantics.
fn reset_context_references(func: &mut HirFunction, reset_ids: &[IdentifierId]) {
    use super::cfg::{
        each_instruction_lvalue_mut, each_instruction_value_operand_mut, each_terminal_operand_mut,
    };
    use crate::hir::terminal::Terminal;

    let reset: HashSet<IdentifierId> = reset_ids.iter().copied().collect();
    let apply = |place: &mut crate::hir::place::Place| {
        if reset.contains(&place.identifier.id) {
            place.identifier.mutable_range = MutableRange::default();
            place.identifier.scope = None;
            place.identifier.range_scope = None;
        }
    };

    let block_ids: Vec<_> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        let block = func.body.block_mut(block_id).expect("block exists");
        for phi in &mut block.phis {
            apply(&mut phi.place);
            for operand in phi.operands.values_mut() {
                apply(operand);
            }
        }
        for instr in &mut block.instructions {
            for p in each_instruction_lvalue_mut(instr) {
                apply(p);
            }
            for p in each_instruction_value_operand_mut(&mut instr.value) {
                apply(p);
            }
            if let Some(effects) = &mut instr.effects {
                for effect in effects {
                    for p in effect.places_mut() {
                        apply(p);
                    }
                }
            }
        }
        for p in each_terminal_operand_mut(&mut block.terminal) {
            apply(p);
        }
        if let Terminal::Return { value, .. } = &mut block.terminal {
            apply(value);
        }
    }
}

/// `lowerWithMutationAliasing(fn)`.
fn lower_with_mutation_aliasing(
    func: &mut HirFunction,
    next_scope: &mut IdAllocator,
    enable_preserve: bool,
    transitively_freeze_fn_exprs: bool,
) {
    // Phase 1: the inner mutation/aliasing sub-pipeline, mirroring the TS order:
    //   analyseFunctions -> inferMutationAliasingEffects(isFunctionExpression)
    //   -> deadCodeElimination -> inferMutationAliasingRanges(isFunctionExpression)
    //   -> rewriteInstructionKindsBasedOnReassignment -> inferReactiveScopeVariables
    analyse_functions(func, next_scope, enable_preserve, transitively_freeze_fn_exprs);
    infer_mutation_aliasing_effects(func, true, enable_preserve, transitively_freeze_fn_exprs);
    dead_code_elimination(func);
    let function_effects = infer_mutation_aliasing_ranges(func, true);
    rewrite_instruction_kinds_based_on_reassignment(func);
    infer_reactive_scope_variables(func, next_scope);
    func.aliasing_effects = Some(function_effects.clone());

    // Phase 2: populate the Effect of each context variable for the outer
    // inference (capture detection of the function value's captures).
    let mut captured_or_mutated: HashSet<IdentifierId> = HashSet::new();
    for effect in &function_effects {
        match effect {
            AliasingEffect::Assign { from, .. }
            | AliasingEffect::Alias { from, .. }
            | AliasingEffect::Capture { from, .. }
            | AliasingEffect::CreateFrom { from, .. }
            | AliasingEffect::MaybeAlias { from, .. } => {
                captured_or_mutated.insert(from.identifier.id);
            }
            AliasingEffect::Mutate { value, .. }
            | AliasingEffect::MutateConditionally { value }
            | AliasingEffect::MutateTransitive { value }
            | AliasingEffect::MutateTransitiveConditionally { value } => {
                captured_or_mutated.insert(value.identifier.id);
            }
            _ => {}
        }
    }
    for operand in &mut func.context {
        if captured_or_mutated.contains(&operand.identifier.id)
            || operand.effect == Effect::Capture
        {
            operand.effect = Effect::Capture;
        } else {
            operand.effect = Effect::Read;
        }
    }
}
