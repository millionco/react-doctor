//! Shared helpers for the HIR-level reactive-scope passes
//! (`AlignMethodCallScopes`, `AlignObjectMethodScopes`,
//! `AlignReactiveScopesToBlockScopesHIR`, …).
//!
//! ## The scope/range duality
//!
//! In the TS compiler each `Identifier` holds `scope: ReactiveScope | null`,
//! where the `ReactiveScope` is a *shared mutable object* with a `range` field.
//! `PrintHIR.printMutableRange` prints `identifier.scope?.range ?? mutableRange`,
//! so the rendered `[a:b]` range is the scope's range when the identifier is in a
//! scope. `inferReactiveScopeVariables` sets `identifier.mutableRange = scope.range`
//! (the *same object*) for every member, so the two stay in sync until the scope
//! object is detached.
//!
//! Our model collapses this: `Identifier { scope: Option<ScopeId>, mutable_range }`
//! and clones identifiers into each `Place`. We therefore mirror the TS by keeping
//! the per-identifier `mutable_range` equal to the (current) scope range across all
//! members, and treat the `(ScopeId -> range)` association as a side-table rebuilt
//! from the function body whenever a pass needs it.
//!
//! - [`collect_scope_ranges`] reads the current `ScopeId -> range` association from
//!   the function body (every member of a scope carries the same range, so the
//!   first occurrence wins).
//! - [`for_each_place_mut`] walks every `Place` in **this** function (params,
//!   context, returns, instruction lvalues/operands, the effect lines that carry
//!   their own `Place` copies, terminal operands), *not* recursing into nested
//!   functions (scopes are disjoint across functions). This is the workhorse for
//!   writing scope/range changes back.

use std::collections::HashMap;

use crate::hir::ids::ScopeId;
use crate::hir::model::{FunctionParam, HirFunction};
use crate::hir::place::{MutableRange, Place};
use crate::hir::terminal::Terminal;

use super::cfg::{
    each_instruction_lvalue_mut, each_instruction_value_operand_mut, each_terminal_operand_mut,
};

/// Walk every `Place` in `func`'s header and body (not nested-function bodies),
/// calling `f` on each, in a stable order. Mirrors the set of places
/// `inferReactiveScopeVariables`'s write-back touches, minus the nested recursion.
pub fn for_each_place_mut(func: &mut HirFunction, mut f: impl FnMut(&mut Place)) {
    for param in &mut func.params {
        match param {
            FunctionParam::Place(place) => f(place),
            FunctionParam::Spread(spread) => f(&mut spread.place),
        }
    }
    for ctx in &mut func.context {
        f(ctx);
    }
    f(&mut func.returns);
    if let Some(effects) = &mut func.aliasing_effects {
        for effect in effects {
            for p in effect.places_mut() {
                f(p);
            }
        }
    }

    let block_ids: Vec<_> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        let block = func.body.block_mut(block_id).expect("block exists");
        for phi in &mut block.phis {
            f(&mut phi.place);
            for operand in phi.operands.values_mut() {
                f(operand);
            }
        }
        for instr in &mut block.instructions {
            for p in each_instruction_lvalue_mut(instr) {
                f(p);
            }
            for p in each_instruction_value_operand_mut(&mut instr.value) {
                f(p);
            }
            if let Some(effects) = &mut instr.effects {
                for effect in effects {
                    for p in effect.places_mut() {
                        f(p);
                    }
                }
            }
        }
        for p in each_terminal_operand_mut(&mut block.terminal) {
            f(p);
        }
        if let Terminal::Return { value, .. } = &mut block.terminal {
            f(value);
        }
        if let Some(effects) = block.terminal.effects_mut() {
            for effect in effects {
                for p in effect.places_mut() {
                    f(p);
                }
            }
        }
    }
}

/// Read the current `ScopeId -> range` association from `func`'s body. Keyed by
/// `range_scope` (the scope whose range an identifier's `mutable_range` mirrors),
/// which — unlike `scope` — survives an `AlignMethodCallScopes` scope clear, so a
/// detached method-property still tracks its former scope's range. Every member
/// of a scope carries the same `mutable_range`, so the first occurrence wins.
pub fn collect_scope_ranges(func: &HirFunction) -> HashMap<ScopeId, MutableRange> {
    let mut ranges: HashMap<ScopeId, MutableRange> = HashMap::new();
    let mut record = |place: &Place| {
        if let Some(scope) = place.identifier.range_scope {
            ranges.entry(scope).or_insert(place.identifier.mutable_range);
        }
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

/// Write `ranges` back onto every `Place` in `func` whose identifier's
/// `range_scope` is a key. Keyed by `range_scope` (not `scope`) so a method
/// property whose `scope` was cleared still has its printed `[a:b]` follow its
/// former scope's range — mirroring the shared range-object aliasing in the TS.
pub fn write_scope_ranges(func: &mut HirFunction, ranges: &HashMap<ScopeId, MutableRange>) {
    for_each_place_mut(func, |place| {
        if let Some(scope) = place.identifier.range_scope {
            if let Some(range) = ranges.get(&scope) {
                place.identifier.mutable_range = *range;
            }
        }
    });
}
