//! `mergeOverlappingReactiveScopesHIR(fn)` — port of
//! `HIR/MergeOverlappingReactiveScopesHIR.ts`.
//!
//! Merges reactive scopes that overlap (so they form valid nested if-blocks) and
//! scopes whose instructions mutate an outer scope. The TS operates on
//! `ReactiveScope` objects by identity; our model keeps the scope as an opaque
//! [`ScopeId`] on each [`Place`]'s identifier, with the scope's range mirrored on
//! every member's `mutable_range`. We therefore:
//!
//! 1. reconstruct the `ScopeId -> range` side-table (every member of a scope
//!    carries the same range, so the first occurrence wins);
//! 2. run the same disjoint-set traversal over [`ScopeId`]s; and
//! 3. expand each group root's range (min start, max end) and remap every place
//!    whose `scope` is a non-root onto the root — setting its printed `[a:b]`
//!    range to the *root's* (post-expansion) range, exactly as the TS does (a
//!    merged member's printed range follows `identifier.scope.range`, while a
//!    scope-cleared place keeps its own `mutable_range` object untouched).
//!
//! Crucially, places with no `scope` (e.g. an `AlignMethodCallScopes`-cleared
//! method property that still carries a `range_scope`) are left entirely alone:
//! in the TS their `mutableRange` is a distinct object that the group-root range
//! expansion never touches.

use std::collections::HashMap;

use crate::hir::ids::{InstructionId, ScopeId};
use crate::hir::model::HirFunction;
use crate::hir::place::{MutableRange, Place};

use super::cfg::{each_instruction_value_operand, each_terminal_operand};
use super::disjoint_set::DisjointSet;
use super::reactive_scope_util::for_each_place_mut;

/// Collected `scope -> range` plus the per-instruction scope start/end queues
/// (sorted descending by id, so the traversal can `pop()` the next-lowest).
struct ScopeInfo {
    /// Each scope's range.
    ranges: HashMap<ScopeId, MutableRange>,
    /// `(instrId, scopes)` entries where the scopes start, sorted by id descending.
    scope_starts: Vec<(InstructionId, Vec<ScopeId>)>,
    /// `(instrId, scopes)` entries where the scopes end, sorted by id descending.
    scope_ends: Vec<(InstructionId, Vec<ScopeId>)>,
}

/// `mergeOverlappingReactiveScopesHIR(fn)`.
pub fn merge_overlapping_reactive_scopes_hir(func: &mut HirFunction) {
    let info = collect_scope_info(func);
    let mut joined = get_overlapping_reactive_scopes(func, &info);

    // Expand each group root's range to span all merged members, then build the
    // final `scope -> root` and `root -> merged range` maps.
    let mut group_of: HashMap<ScopeId, ScopeId> = HashMap::new();
    let mut merged_range: HashMap<ScopeId, MutableRange> = HashMap::new();
    // Seed every root with its own range.
    for (&scope, &range) in &info.ranges {
        let group = joined.find(scope).unwrap_or(scope);
        group_of.insert(scope, group);
        let entry = merged_range.entry(group).or_insert(range);
        // min start / max end across the group (mirrors the TS Math.min/Math.max).
        entry.start = InstructionId::new(entry.start.as_u32().min(range.start.as_u32()));
        entry.end = InstructionId::new(entry.end.as_u32().max(range.end.as_u32()));
    }

    // Rewrite every place that carries a `scope`: point it at the group root and
    // set its printed range to the root's (post-expansion) range. Places with no
    // `scope` (cleared method properties) keep their own range untouched.
    for_each_place_mut(func, |place| {
        if let Some(scope) = place.identifier.scope {
            if let Some(&group) = group_of.get(&scope) {
                place.identifier.scope = Some(group);
                place.identifier.range_scope = Some(group);
                if let Some(range) = merged_range.get(&group) {
                    place.identifier.mutable_range = *range;
                }
            }
        }
    });
}

/// `collectScopeInfo(fn)`: the `scope -> range` side-table plus the descending
/// scope-start / scope-end queues. Mirrors the TS exactly, including the
/// `range.start !== range.end` guard before recording a scope.
fn collect_scope_info(func: &HirFunction) -> ScopeInfo {
    let mut ranges: HashMap<ScopeId, MutableRange> = HashMap::new();
    // Insertion-ordered scope sets per start/end id (to match the JS `Set`/`Map`).
    let mut starts: Vec<(InstructionId, Vec<ScopeId>)> = Vec::new();
    let mut ends: Vec<(InstructionId, Vec<ScopeId>)> = Vec::new();

    fn add(list: &mut Vec<(InstructionId, Vec<ScopeId>)>, id: InstructionId, scope: ScopeId) {
        if let Some(entry) = list.iter_mut().find(|(eid, _)| *eid == id) {
            if !entry.1.contains(&scope) {
                entry.1.push(scope);
            }
        } else {
            list.push((id, vec![scope]));
        }
    }

    let collect = |place: &Place,
                   ranges: &mut HashMap<ScopeId, MutableRange>,
                       starts: &mut Vec<(InstructionId, Vec<ScopeId>)>,
                       ends: &mut Vec<(InstructionId, Vec<ScopeId>)>| {
        if let Some(scope) = place.identifier.scope {
            let range = place.identifier.mutable_range;
            ranges.entry(scope).or_insert(range);
            if range.start != range.end {
                add(starts, range.start, scope);
                add(ends, range.end, scope);
            }
        }
    };

    for block in func.body.blocks() {
        for instr in &block.instructions {
            collect(&instr.lvalue, &mut ranges, &mut starts, &mut ends);
            for operand in each_instruction_value_operand(&instr.value) {
                collect(operand, &mut ranges, &mut starts, &mut ends);
            }
        }
        for operand in each_terminal_operand(&block.terminal) {
            collect(operand, &mut ranges, &mut starts, &mut ends);
        }
    }

    // Sort descending by id so the traversal pops the next-lowest off the back.
    starts.sort_by(|a, b| b.0.as_u32().cmp(&a.0.as_u32()));
    ends.sort_by(|a, b| b.0.as_u32().cmp(&a.0.as_u32()));

    ScopeInfo {
        ranges,
        scope_starts: starts,
        scope_ends: ends,
    }
}

/// Traversal state mirroring the TS `TraversalState`.
struct TraversalState {
    joined: DisjointSet<ScopeId>,
    active_scopes: Vec<ScopeId>,
}

/// `getOverlappingReactiveScopes(fn, context)`: walk instructions/terminals in
/// program order, maintaining the active-scope stack and unioning overlapping
/// scopes / outer-scope mutations.
fn get_overlapping_reactive_scopes(func: &HirFunction, info: &ScopeInfo) -> DisjointSet<ScopeId> {
    let mut state = TraversalState {
        joined: DisjointSet::new(),
        active_scopes: Vec::new(),
    };
    // Working (mutable) copies of the descending queues we pop from.
    let mut scope_ends = info.scope_ends.clone();
    let mut scope_starts = info.scope_starts.clone();

    for block in func.body.blocks() {
        for instr in &block.instructions {
            visit_instruction_id(instr.id, info, &mut scope_ends, &mut scope_starts, &mut state);
            // `FunctionExpression`/`ObjectMethod` primitive operands are skipped.
            let is_fn = matches!(
                instr.value,
                crate::hir::value::InstructionValue::FunctionExpression { .. }
                    | crate::hir::value::InstructionValue::ObjectMethod { .. }
            );
            for place in each_instruction_value_operand(&instr.value) {
                if is_fn
                    && matches!(place.identifier.type_, crate::hir::place::Type::Primitive)
                {
                    continue;
                }
                visit_place(instr.id, place, info, &mut state);
            }
            // Instruction lvalue.
            visit_place(instr.id, &instr.lvalue, info, &mut state);
        }
        let terminal_id = block.terminal.id();
        visit_instruction_id(
            terminal_id,
            info,
            &mut scope_ends,
            &mut scope_starts,
            &mut state,
        );
        for place in each_terminal_operand(&block.terminal) {
            visit_place(terminal_id, place, info, &mut state);
        }
    }

    state.joined
}

/// `visitInstructionId`: process scope ends then scope starts at `id`.
fn visit_instruction_id(
    id: InstructionId,
    info: &ScopeInfo,
    scope_ends: &mut Vec<(InstructionId, Vec<ScopeId>)>,
    scope_starts: &mut Vec<(InstructionId, Vec<ScopeId>)>,
    state: &mut TraversalState,
) {
    // Scopes that end at this instruction.
    if let Some(top) = scope_ends.last() {
        if top.0.as_u32() <= id.as_u32() {
            let (_, scopes) = scope_ends.pop().expect("non-empty");
            // Sort descending by start id.
            let mut sorted = scopes;
            sorted.sort_by(|a, b| {
                scope_start(info, *b)
                    .as_u32()
                    .cmp(&scope_start(info, *a).as_u32())
            });
            for scope in sorted {
                if let Some(idx) = state.active_scopes.iter().position(|s| *s == scope) {
                    if idx != state.active_scopes.len() - 1 {
                        let mut group = vec![scope];
                        group.extend_from_slice(&state.active_scopes[idx + 1..]);
                        state.joined.union(&group);
                    }
                    state.active_scopes.remove(idx);
                }
            }
        }
    }

    // Scopes that begin at this instruction.
    if let Some(top) = scope_starts.last() {
        if top.0.as_u32() <= id.as_u32() {
            let (_, scopes) = scope_starts.pop().expect("non-empty");
            // Sort descending by end id.
            let mut sorted = scopes;
            sorted.sort_by(|a, b| {
                scope_end(info, *b)
                    .as_u32()
                    .cmp(&scope_end(info, *a).as_u32())
            });
            state.active_scopes.extend(sorted.iter().copied());
            // Merge all identical scopes (same end).
            for i in 1..sorted.len() {
                if scope_end(info, sorted[i - 1]) == scope_end(info, sorted[i]) {
                    state.joined.union(&[sorted[i - 1], sorted[i]]);
                }
            }
        }
    }
}

/// `visitPlace`: if the place mutates an outer active scope, flatten everything
/// between that scope and the top of the stack.
fn visit_place(id: InstructionId, place: &Place, info: &ScopeInfo, state: &mut TraversalState) {
    let Some(scope) = place.identifier.scope else {
        return;
    };
    // `getPlaceScope`: scope must be active at `id` (start <= id < end).
    let range = info
        .ranges
        .get(&scope)
        .copied()
        .unwrap_or(MutableRange::default());
    let scope_active = id.as_u32() >= range.start.as_u32() && id.as_u32() < range.end.as_u32();
    if !scope_active {
        return;
    }
    // `isMutable({id}, place)`: id within the identifier's mutable range.
    let mr = place.identifier.mutable_range;
    let mutable = id.as_u32() >= mr.start.as_u32() && id.as_u32() < mr.end.as_u32();
    if !mutable {
        return;
    }
    if let Some(idx) = state.active_scopes.iter().position(|s| *s == scope) {
        if idx != state.active_scopes.len() - 1 {
            let mut group = vec![scope];
            group.extend_from_slice(&state.active_scopes[idx + 1..]);
            state.joined.union(&group);
        }
    }
}

fn scope_start(info: &ScopeInfo, scope: ScopeId) -> InstructionId {
    info.ranges
        .get(&scope)
        .map(|r| r.start)
        .unwrap_or(InstructionId::new(0))
}

fn scope_end(info: &ScopeInfo, scope: ScopeId) -> InstructionId {
    info.ranges
        .get(&scope)
        .map(|r| r.end)
        .unwrap_or(InstructionId::new(0))
}
