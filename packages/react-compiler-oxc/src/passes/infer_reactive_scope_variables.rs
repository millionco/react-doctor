//! `inferReactiveScopeVariables(fn)` — port of
//! `ReactiveScopes/InferReactiveScopeVariables.ts`.
//!
//! The first of the reactive-scope passes: it groups identifiers that mutate
//! together (via [`find_disjoint_mutable_values`]) and assigns each group a
//! unique [`ScopeId`], merging the group members' `mutableRange`s into one shared
//! scope range. The printed effect is the `_@<scopeId>` suffix on every
//! identifier in a scope plus the merged `[start:end]` range.
//!
//! ## Scope-id allocation order
//!
//! The TS allocates a `ScopeId` (`fn.env.nextScopeId`) the first time it
//! encounters each disjoint set's representative while iterating
//! `scopeIdentifiers.forEach`, which walks the union-find's `#entries` in JS
//! `Map` insertion order. [`DisjointSet::for_each`] preserves that order, and the
//! scope counter is the single `nextScopeId` threaded through the whole pipeline
//! (nested functions, analysed first in `AnalyseFunctions`, consume the low ids;
//! the outer function continues from there) — see [`analyse_functions`] and the
//! pipeline driver.
//!
//! ## Range / scope write-back
//!
//! TS shares one `Identifier` object by reference, so writing
//! `identifier.scope = scope; identifier.mutableRange = scope.range` is observed
//! by every `Place` referencing it. Our model clones the identifier into each
//! place, so we instead build a per-`IdentifierId` `(ScopeId, MutableRange)` map
//! and write it back onto every place in **this** function's body/header. We do
//! *not* recurse into nested-function bodies: their scopes were already assigned
//! when `AnalyseFunctions` analysed them, and their identifier ids are not in
//! this function's scope map (so a recursive write-back would be a no-op anyway).
//!
//! [`analyse_functions`]: super::analyse_functions

use std::collections::HashMap;

use crate::hir::ids::{IdAllocator, IdentifierId, InstructionId, ScopeId};
use crate::hir::model::{FunctionParam, HirFunction};
use crate::hir::place::{MutableRange, Place};
use crate::hir::terminal::Terminal;
use crate::hir::value::InstructionValue;

use super::cfg::{
    each_instruction_lvalue_mut, each_instruction_value_operand_mut, each_terminal_operand_mut,
};
use super::find_disjoint_mutable_values::find_disjoint_mutable_values;

/// Per-scope accumulator while assigning scope ids and merging ranges.
struct ScopeData {
    id: ScopeId,
    range: MutableRange,
}

/// `inferReactiveScopeVariables(fn)`.
///
/// `next_scope` is the shared scope-id allocator (`fn.env.nextScopeId`),
/// threaded through the pipeline so nested and outer functions draw from one
/// monotonic sequence.
pub fn infer_reactive_scope_variables(func: &mut HirFunction, next_scope: &mut IdAllocator) {
    // Represents the set of reactive scopes as disjoint sets of identifiers that
    // mutate together.
    let mut scope_identifiers = find_disjoint_mutable_values(func);

    // Maps each scope (by its representative member) to its ScopeData.
    let mut scopes: HashMap<IdentifierId, ScopeData> = HashMap::new();
    // The order representatives were first seen (for deterministic range merge).
    // Maps each member identifier to its scope's representative.
    let mut member_to_group: HashMap<IdentifierId, IdentifierId> = HashMap::new();
    // Snapshot of each identifier's mutable range before any merge, so the
    // min/max accumulation reads original values (TS reads `identifier.mutableRange`,
    // which is reassigned to the shared `scope.range` only after the entry is
    // processed — but the *next* member of the same scope reads the pre-merge
    // range of its own identifier, never the running scope range). We capture
    // per-identifier ranges up front.
    let ranges = collect_identifier_ranges(func);

    // Iterate over all identifiers and assign a unique ScopeId per scope (keyed
    // by the set representative), in DisjointSet `#entries` insertion order. At
    // the same time, build the merged MutableRange spanning all members.
    scope_identifiers.for_each(|identifier, group_identifier| {
        let id_range = ranges
            .get(&identifier)
            .copied()
            .unwrap_or_else(MutableRange::default);
        member_to_group.insert(identifier, group_identifier);
        match scopes.get_mut(&group_identifier) {
            None => {
                scopes.insert(
                    group_identifier,
                    ScopeData {
                        id: ScopeId::new(next_scope.alloc()),
                        range: id_range,
                    },
                );
            }
            Some(scope) => {
                // Merge the member's range into the scope range.
                if scope.range.start.as_u32() == 0 {
                    scope.range.start = id_range.start;
                } else if id_range.start.as_u32() != 0 {
                    scope.range.start =
                        InstructionId::new(scope.range.start.as_u32().min(id_range.start.as_u32()));
                }
                scope.range.end =
                    InstructionId::new(scope.range.end.as_u32().max(id_range.end.as_u32()));
            }
        }
    });

    // Build the per-identifier `(ScopeId, MutableRange)` write-back map: every
    // member identifier gets its scope's id and the merged scope range.
    let mut assignment: HashMap<IdentifierId, (ScopeId, MutableRange)> = HashMap::new();
    for (member, group) in &member_to_group {
        let scope = scopes.get(group).expect("group has a scope");
        assignment.insert(*member, (scope.id, scope.range));
    }

    write_back(func, &assignment);
}

/// Collect each identifier's `mutableRange` as seen across the function body /
/// header (`infer_mutation_aliasing_ranges` has already written the final ranges
/// onto every place, so any occurrence carries the correct value).
fn collect_identifier_ranges(func: &HirFunction) -> HashMap<IdentifierId, MutableRange> {
    let mut ranges: HashMap<IdentifierId, MutableRange> = HashMap::new();
    let mut record = |place: &Place| {
        ranges
            .entry(place.identifier.id)
            .or_insert(place.identifier.mutable_range);
    };
    for param in &func.params {
        match param {
            FunctionParam::Place(place) => record(place),
            FunctionParam::Spread(spread) => record(&spread.place),
        }
    }
    for ctx in &func.context {
        record(ctx);
    }
    record(&func.returns);
    for block in func.body.blocks() {
        for phi in &block.phis {
            record(&phi.place);
            for operand in phi.operands.values() {
                record(operand);
            }
        }
        for instr in &block.instructions {
            record(&instr.lvalue);
            // Value-level lvalue places (DeclareLocal/StoreLocal/Destructure
            // targets, etc.). The TS shares one `Identifier` object per id, so the
            // declaration site's range (e.g. a `DeclareLocal x` whose lvalue
            // identifier `mutableRange.start` was set to its instruction id) is
            // always visible; here we must walk these explicitly so a member's
            // declaration-site range is folded into its scope's merged range.
            for lvalue in super::cfg::each_instruction_value_lvalue(&instr.value) {
                record(lvalue);
            }
            for operand in super::cfg::each_instruction_value_operand(&instr.value) {
                record(operand);
            }
        }
        for operand in super::cfg::each_terminal_operand(&block.terminal) {
            record(operand);
        }
        if let Terminal::Return { value, .. } = &block.terminal {
            record(value);
        }
    }
    ranges
}

/// Write the assigned `(scope, range)` onto every place in this function's body
/// and header whose identifier is a scope member.
///
/// Recurses into nested-function bodies (and their context/params/returns/effects
/// and function-level `aliasingEffects`). In the TS the `Identifier` is shared by
/// reference, so when the outer `inferReactiveScopeVariables` assigns a scope to
/// an outer local (e.g. a `DeclareContext` var `a$1`) that a nested function
/// captures, the nested body's `a$1` references observe the scope/range too. We
/// clone identifiers into places, so we walk the nested bodies and apply by id —
/// a no-op for the nested function's own scope members (their ids are not in this
/// function's `assignment` map), so it never clobbers their `_@N` suffixes.
fn write_back(func: &mut HirFunction, assignment: &HashMap<IdentifierId, (ScopeId, MutableRange)>) {
    write_back_fn(func, assignment);
}

fn write_back_fn(
    func: &mut HirFunction,
    assignment: &HashMap<IdentifierId, (ScopeId, MutableRange)>,
) {
    let apply = |place: &mut Place| {
        if let Some(&(scope, range)) = assignment.get(&place.identifier.id) {
            place.identifier.scope = Some(scope);
            // `range_scope` tracks the scope whose range this identifier's
            // `mutable_range` mirrors; set it in lock-step with `scope` so a later
            // `scope` clear (AlignMethodCallScopes) still leaves the range aliased.
            place.identifier.range_scope = Some(scope);
            place.identifier.mutable_range = range;
        }
    };

    for param in &mut func.params {
        match param {
            FunctionParam::Place(place) => apply(place),
            FunctionParam::Spread(spread) => apply(&mut spread.place),
        }
    }
    for ctx in &mut func.context {
        apply(ctx);
    }
    apply(&mut func.returns);
    // The function-level aliasing signature (`@aliasingEffects=[...]`).
    if let Some(effects) = &mut func.aliasing_effects {
        for effect in effects {
            for p in effect.places_mut() {
                apply(p);
            }
        }
    }

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
            // The aliasing-effect lines carry their own `Place` copies (printed
            // with the `_@<scope>` suffix); rewrite them too.
            if let Some(effects) = &mut instr.effects {
                for effect in effects {
                    for p in effect.places_mut() {
                        apply(p);
                    }
                }
            }
            // Recurse into nested function bodies (shared-identifier semantics).
            match &mut instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    write_back_fn(&mut lowered_func.func, assignment);
                }
                _ => {}
            }
        }
        for p in each_terminal_operand_mut(&mut block.terminal) {
            apply(p);
        }
        if let Terminal::Return { value, .. } = &mut block.terminal {
            apply(value);
        }
        // Terminal aliasing-effect lines (e.g. `Freeze $N jsx-captured` on a
        // `Return`) carry their own `Place` copies; rewrite them too.
        if let Some(effects) = block.terminal.effects_mut() {
            for effect in effects {
                for p in effect.places_mut() {
                    apply(p);
                }
            }
        }
    }
}
