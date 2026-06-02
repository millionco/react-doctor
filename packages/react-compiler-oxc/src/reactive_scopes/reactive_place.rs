//! Shared mutable-place traversal for the `ReactiveFunction` tree, plus the
//! scope-range aliasing sync the stage-6 passes need.
//!
//! ## The scope/range aliasing (recap)
//!
//! In the TS compiler `identifier.mutableRange` and `identifier.scope.range` are
//! the *same object*: extending a scope's `range.end` is instantly visible on every
//! member identifier's printed `[a:b]`. Our model collapses `scope` to an opaque
//! [`ScopeId`](crate::hir::ids::ScopeId) and clones identifiers into each `Place`,
//! so we mirror the aliasing by keeping every member's `mutable_range` equal to its
//! scope's range, keyed by `range_scope`. [`sync_scope_ranges`] re-establishes that
//! invariant after a pass (e.g. `MergeReactiveScopesThatInvalidateTogether`) extends
//! a scope's range on the scope object alone.

use std::collections::HashMap;

use crate::hir::ids::ScopeId;
use crate::hir::model::FunctionParam;
use crate::hir::place::{MutableRange, Place};
use crate::hir::terminal::ReactiveScope;

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveStatement, ReactiveTerminal,
    ReactiveValue,
};

/// Write each surviving scope block's `scope.range` onto every identifier whose
/// `range_scope` matches that scope id. Scopes with no surviving block (e.g. ones
/// merged away) are absent from the table, so their members keep their existing
/// (still-correct) ranges.
pub fn sync_scope_ranges(func: &mut ReactiveFunction) {
    let mut ranges: HashMap<ScopeId, MutableRange> = HashMap::new();
    collect_scope_ranges(&func.body, &mut ranges);
    if ranges.is_empty() {
        return;
    }
    for_each_reactive_place_mut(func, &mut |place: &mut Place| {
        if let Some(scope) = place.identifier.range_scope {
            if let Some(range) = ranges.get(&scope) {
                place.identifier.mutable_range = *range;
            }
        }
    });
}

/// Record the `ScopeId -> range` association from every `scope`/`pruned-scope`
/// block in the tree (the authoritative range lives on the scope object).
fn collect_scope_ranges(block: &ReactiveBlock, ranges: &mut HashMap<ScopeId, MutableRange>) {
    for stmt in block {
        match stmt {
            ReactiveStatement::Scope(scope) | ReactiveStatement::PrunedScope(scope) => {
                ranges.insert(scope.scope.id, scope.scope.range);
                collect_scope_ranges(&scope.instructions, ranges);
            }
            ReactiveStatement::Terminal(stmt) => {
                collect_scope_ranges_terminal(&stmt.terminal, ranges)
            }
            // Instruction statements (and their nested sequences) carry no scope
            // blocks, so there are no ranges to collect from them.
            ReactiveStatement::Instruction(_) => {}
        }
    }
}

fn collect_scope_ranges_terminal(
    terminal: &ReactiveTerminal,
    ranges: &mut HashMap<ScopeId, MutableRange>,
) {
    match terminal {
        ReactiveTerminal::Break { .. }
        | ReactiveTerminal::Continue { .. }
        | ReactiveTerminal::Return { .. }
        | ReactiveTerminal::Throw { .. } => {}
        ReactiveTerminal::For { loop_, .. }
        | ReactiveTerminal::ForOf { loop_, .. }
        | ReactiveTerminal::ForIn { loop_, .. }
        | ReactiveTerminal::DoWhile { loop_, .. }
        | ReactiveTerminal::While { loop_, .. } => collect_scope_ranges(loop_, ranges),
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            collect_scope_ranges(consequent, ranges);
            if let Some(alternate) = alternate {
                collect_scope_ranges(alternate, ranges);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &case.block {
                    collect_scope_ranges(block, ranges);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => collect_scope_ranges(block, ranges),
        ReactiveTerminal::Try { block, handler, .. } => {
            collect_scope_ranges(block, ranges);
            collect_scope_ranges(handler, ranges);
        }
    }
}

/// Walk every `Place` (and the cloned identifiers carried on scope
/// declarations/reassignments/dependencies) in the reactive tree, calling `f` on
/// each. Mirrors the full set of identifier copies the TS shared-range object would
/// keep in sync.
pub fn for_each_reactive_place_mut(func: &mut ReactiveFunction, f: &mut impl FnMut(&mut Place)) {
    for param in &mut func.params {
        match param {
            FunctionParam::Place(place) => f(place),
            FunctionParam::Spread(spread) => f(&mut spread.place),
        }
    }
    block_places_mut(&mut func.body, f);
}

fn block_places_mut(block: &mut ReactiveBlock, f: &mut impl FnMut(&mut Place)) {
    for stmt in block.iter_mut() {
        match stmt {
            ReactiveStatement::Instruction(instruction) => instruction_places_mut(instruction, f),
            ReactiveStatement::Scope(scope) | ReactiveStatement::PrunedScope(scope) => {
                scope_identifier_places_mut(&mut scope.scope, f);
                block_places_mut(&mut scope.instructions, f);
            }
            ReactiveStatement::Terminal(stmt) => terminal_places_mut(&mut stmt.terminal, f),
        }
    }
}

/// The cloned identifiers carried on a scope's metadata also alias the shared
/// range, so the declaration/reassignment/dependency identifiers must be synced.
/// They are not [`Place`]s, so wrap them in a throwaway place for `f`.
fn scope_identifier_places_mut(scope: &mut ReactiveScope, f: &mut impl FnMut(&mut Place)) {
    use crate::hir::place::{Effect, SourceLocation};
    let mut apply = |identifier: &mut crate::hir::place::Identifier| {
        let mut place = Place {
            identifier: identifier.clone(),
            effect: Effect::Read,
            reactive: false,
            loc: SourceLocation::Generated,
        };
        f(&mut place);
        *identifier = place.identifier;
    };
    for (_, decl) in scope.declarations.iter_mut() {
        apply(&mut decl.identifier);
    }
    for reassign in scope.reassignments.iter_mut() {
        apply(reassign);
    }
    for dep in scope.dependencies.iter_mut() {
        apply(&mut dep.identifier);
    }
    if let Some(early) = &mut scope.early_return_value {
        apply(&mut early.value);
    }
}

fn instruction_places_mut(instruction: &mut ReactiveInstruction, f: &mut impl FnMut(&mut Place)) {
    if let Some(lvalue) = &mut instruction.lvalue {
        f(lvalue);
    }
    value_places_mut(&mut instruction.value, f);
}

fn value_places_mut(value: &mut ReactiveValue, f: &mut impl FnMut(&mut Place)) {
    match value {
        ReactiveValue::Instruction(instr_value) => {
            for place in crate::passes::cfg::each_instruction_value_operand_mut(instr_value) {
                f(place);
            }
            for place in crate::passes::cfg::each_instruction_value_lvalue_mut(instr_value) {
                f(place);
            }
        }
        ReactiveValue::Logical(logical) => {
            value_places_mut(&mut logical.left, f);
            value_places_mut(&mut logical.right, f);
        }
        ReactiveValue::Ternary(ternary) => {
            value_places_mut(&mut ternary.test, f);
            value_places_mut(&mut ternary.consequent, f);
            value_places_mut(&mut ternary.alternate, f);
        }
        ReactiveValue::Sequence(seq) => {
            for instr in seq.instructions.iter_mut() {
                instruction_places_mut(instr, f);
            }
            value_places_mut(&mut seq.value, f);
        }
        ReactiveValue::OptionalCall(optional) => {
            value_places_mut(&mut optional.value, f);
        }
    }
}

fn terminal_places_mut(terminal: &mut ReactiveTerminal, f: &mut impl FnMut(&mut Place)) {
    match terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { value, .. } | ReactiveTerminal::Throw { value, .. } => f(value),
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_,
            ..
        } => {
            value_places_mut(init, f);
            value_places_mut(test, f);
            if let Some(update) = update {
                value_places_mut(update, f);
            }
            block_places_mut(loop_, f);
        }
        ReactiveTerminal::ForOf {
            init, test, loop_, ..
        } => {
            value_places_mut(init, f);
            value_places_mut(test, f);
            block_places_mut(loop_, f);
        }
        ReactiveTerminal::ForIn { init, loop_, .. } => {
            value_places_mut(init, f);
            block_places_mut(loop_, f);
        }
        ReactiveTerminal::DoWhile { loop_, test, .. } => {
            block_places_mut(loop_, f);
            value_places_mut(test, f);
        }
        ReactiveTerminal::While { test, loop_, .. } => {
            value_places_mut(test, f);
            block_places_mut(loop_, f);
        }
        ReactiveTerminal::If {
            test,
            consequent,
            alternate,
            ..
        } => {
            f(test);
            block_places_mut(consequent, f);
            if let Some(alternate) = alternate {
                block_places_mut(alternate, f);
            }
        }
        ReactiveTerminal::Switch { test, cases, .. } => {
            f(test);
            for case in cases {
                if let Some(case_test) = &mut case.test {
                    f(case_test);
                }
                if let Some(block) = &mut case.block {
                    block_places_mut(block, f);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => block_places_mut(block, f),
        ReactiveTerminal::Try {
            block,
            handler_binding,
            handler,
            ..
        } => {
            block_places_mut(block, f);
            if let Some(binding) = handler_binding {
                f(binding);
            }
            block_places_mut(handler, f);
        }
    }
}
