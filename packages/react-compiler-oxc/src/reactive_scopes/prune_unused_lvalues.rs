//! `pruneUnusedLValues`, ported from
//! `packages/react-compiler/src/ReactiveScopes/PruneTemporaryLValues.ts`.
//!
//! Nulls out the `lvalue` of any instruction whose lvalue is an *unnamed*
//! temporary (`identifier.name === null`) that is never read later. This only
//! clears the lvalue — the instruction (and its value) stay so the value still
//! executes; the printer simply omits the `<lvalue> = ` prefix once `lvalue` is
//! `None`.
//!
//! Single traversal (matching the TS `ReactiveFunctionVisitor`):
//! - `visitPlace` (every operand / terminal-operand read) removes that place's
//!   `DeclarationId` from the candidate map — it is "used".
//! - `visitInstruction`, *after* recursing into its value/operands
//!   (`traverseInstruction`), records its lvalue's `DeclarationId` as a candidate
//!   if the lvalue is an unnamed temporary.
//!
//! Keyed by `DeclarationId` (not `IdentifierId`) because the lvalue id of a
//! compound reactive value (ternary/logical/optional) may differ from the phi
//! id that is read later; keying by declaration avoids nulling a used lvalue.

use std::collections::HashMap;

use crate::hir::ids::{DeclarationId, InstructionId};
use crate::hir::place::Place;

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveScopeBlock, ReactiveStatement,
    ReactiveTerminal, ReactiveValue,
};

/// `pruneUnusedLValues(fn)`.
pub fn prune_unused_lvalues(func: &mut ReactiveFunction) {
    // Map of candidate (unused, unnamed-temporary) lvalues keyed by their
    // declaration id, recording the instruction id whose lvalue to null. A later
    // read of the same declaration removes it from the map.
    let mut lvalues: HashMap<DeclarationId, InstructionId> = HashMap::new();
    visit_block(&func.body, &mut lvalues);

    let to_null: std::collections::HashSet<InstructionId> = lvalues.into_values().collect();
    if !to_null.is_empty() {
        null_block(&mut func.body, &to_null);
    }
}

/// `visitPlace`: a read removes the place's declaration from the candidate map.
fn visit_place(place: &Place, state: &mut HashMap<DeclarationId, InstructionId>) {
    state.remove(&place.identifier.declaration_id);
}

fn visit_value(value: &ReactiveValue, state: &mut HashMap<DeclarationId, InstructionId>) {
    // `traverseValue` (`ReactiveScopes/visitors.ts`): a `switch` on the value kind
    // that recurses `visitValue` into compound members and *only* falls through to
    // `eachInstructionValueOperand` for the leaf (`default`) case. Each branch
    // `break`s, so a compound value's operands are reached *only* via its members'
    // own `visitValue`, never via a flattened operand list.
    //
    // The earlier implementation collapsed this into a single
    // `each_reactive_value_operand` call (which itself flattens nested sequences),
    // which meant the nested instructions inside a compound value's branches were
    // *not* run through `visit_instruction` — so their unnamed-temporary lvalues
    // were never recorded as prune candidates. That left e.g. a `StoreLocal
    // Reassign` temp inside a ternary branch's sequence un-pruned, so codegen
    // captured the reassignment into a (never-read) temp and dropped it from the
    // emitted `(x = [], x.push(...))` sequence.
    match value {
        ReactiveValue::OptionalCall(optional) => {
            visit_value(&optional.value, state);
        }
        ReactiveValue::Logical(logical) => {
            visit_value(&logical.left, state);
            visit_value(&logical.right, state);
        }
        ReactiveValue::Ternary(ternary) => {
            visit_value(&ternary.test, state);
            visit_value(&ternary.consequent, state);
            visit_value(&ternary.alternate, state);
        }
        ReactiveValue::Sequence(seq) => {
            for instr in &seq.instructions {
                visit_instruction(instr, state);
            }
            visit_value(&seq.value, state);
        }
        ReactiveValue::Instruction(iv) => {
            for place in crate::passes::cfg::each_instruction_value_operand(iv) {
                visit_place(place, state);
            }
        }
    }
}

fn visit_instruction(
    instruction: &ReactiveInstruction,
    state: &mut HashMap<DeclarationId, InstructionId>,
) {
    // `traverseInstruction` runs first (visit the value's operands + nested
    // sequence instructions). `visitLValue` is a no-op, so nested value lvalues are
    // *not* treated as reads.
    visit_value(&instruction.value, state);

    // Then `visitInstruction`: record an unnamed-temporary lvalue as a candidate.
    if let Some(lvalue) = &instruction.lvalue {
        if lvalue.identifier.name.is_none() {
            state.insert(lvalue.identifier.declaration_id, instruction.id);
        }
    }
}

fn visit_terminal(terminal: &ReactiveTerminal, state: &mut HashMap<DeclarationId, InstructionId>) {
    match terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { value, .. } | ReactiveTerminal::Throw { value, .. } => {
            visit_place(value, state);
        }
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_,
            ..
        } => {
            visit_value(init, state);
            visit_value(test, state);
            if let Some(update) = update {
                visit_value(update, state);
            }
            visit_block(loop_, state);
        }
        ReactiveTerminal::ForOf {
            init, test, loop_, ..
        } => {
            visit_value(init, state);
            visit_value(test, state);
            visit_block(loop_, state);
        }
        ReactiveTerminal::ForIn { init, loop_, .. } => {
            visit_value(init, state);
            visit_block(loop_, state);
        }
        ReactiveTerminal::DoWhile { loop_, test, .. } => {
            visit_block(loop_, state);
            visit_value(test, state);
        }
        ReactiveTerminal::While { test, loop_, .. } => {
            visit_value(test, state);
            visit_block(loop_, state);
        }
        ReactiveTerminal::If {
            test,
            consequent,
            alternate,
            ..
        } => {
            visit_place(test, state);
            visit_block(consequent, state);
            if let Some(alternate) = alternate {
                visit_block(alternate, state);
            }
        }
        ReactiveTerminal::Switch { test, cases, .. } => {
            visit_place(test, state);
            for case in cases {
                if let Some(case_test) = &case.test {
                    visit_place(case_test, state);
                }
                if let Some(block) = &case.block {
                    visit_block(block, state);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => visit_block(block, state),
        ReactiveTerminal::Try {
            block,
            handler_binding,
            handler,
            ..
        } => {
            visit_block(block, state);
            if let Some(binding) = handler_binding {
                visit_place(binding, state);
            }
            visit_block(handler, state);
        }
    }
}

fn visit_block(block: &ReactiveBlock, state: &mut HashMap<DeclarationId, InstructionId>) {
    for stmt in block {
        match stmt {
            ReactiveStatement::Instruction(instruction) => visit_instruction(instruction, state),
            ReactiveStatement::Scope(scope) | ReactiveStatement::PrunedScope(scope) => {
                visit_scope(scope, state)
            }
            ReactiveStatement::Terminal(stmt) => visit_terminal(&stmt.terminal, state),
        }
    }
}

fn visit_scope(scope: &ReactiveScopeBlock, state: &mut HashMap<DeclarationId, InstructionId>) {
    visit_block(&scope.instructions, state);
}

// ---- post-pass: null out the surviving candidate lvalues ----

fn null_block(block: &mut ReactiveBlock, to_null: &std::collections::HashSet<InstructionId>) {
    for stmt in block.iter_mut() {
        match stmt {
            ReactiveStatement::Instruction(instruction) => null_instruction(instruction, to_null),
            ReactiveStatement::Scope(scope) | ReactiveStatement::PrunedScope(scope) => {
                null_block(&mut scope.instructions, to_null)
            }
            ReactiveStatement::Terminal(stmt) => null_terminal(&mut stmt.terminal, to_null),
        }
    }
}

fn null_instruction(
    instruction: &mut ReactiveInstruction,
    to_null: &std::collections::HashSet<InstructionId>,
) {
    // Recurse into the value's nested instructions first (a sequence member's
    // lvalue — or one nested inside a compound value — may also be an unused
    // temporary).
    null_value(&mut instruction.value, to_null);
    if instruction.lvalue.is_some() && to_null.contains(&instruction.id) {
        instruction.lvalue = None;
    }
}

/// Recurse into compound values to null nested instruction lvalues (sequences may
/// appear inside ternaries/logicals/optionals and inside terminal value operands
/// like a `for` loop's `init`/`test`/`update`).
fn null_value(value: &mut ReactiveValue, to_null: &std::collections::HashSet<InstructionId>) {
    match value {
        ReactiveValue::Instruction(_) => {}
        ReactiveValue::Logical(logical) => {
            null_value(&mut logical.left, to_null);
            null_value(&mut logical.right, to_null);
        }
        ReactiveValue::Ternary(ternary) => {
            null_value(&mut ternary.test, to_null);
            null_value(&mut ternary.consequent, to_null);
            null_value(&mut ternary.alternate, to_null);
        }
        ReactiveValue::Sequence(seq) => {
            for instr in seq.instructions.iter_mut() {
                null_instruction(instr, to_null);
            }
            null_value(&mut seq.value, to_null);
        }
        ReactiveValue::OptionalCall(optional) => {
            null_value(&mut optional.value, to_null);
        }
    }
}

fn null_terminal(
    terminal: &mut ReactiveTerminal,
    to_null: &std::collections::HashSet<InstructionId>,
) {
    match terminal {
        ReactiveTerminal::Break { .. }
        | ReactiveTerminal::Continue { .. }
        | ReactiveTerminal::Return { .. }
        | ReactiveTerminal::Throw { .. } => {}
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_,
            ..
        } => {
            null_value(init, to_null);
            null_value(test, to_null);
            if let Some(update) = update {
                null_value(update, to_null);
            }
            null_block(loop_, to_null);
        }
        ReactiveTerminal::ForOf {
            init, test, loop_, ..
        } => {
            null_value(init, to_null);
            null_value(test, to_null);
            null_block(loop_, to_null);
        }
        ReactiveTerminal::ForIn { init, loop_, .. } => {
            null_value(init, to_null);
            null_block(loop_, to_null);
        }
        ReactiveTerminal::DoWhile { loop_, test, .. } => {
            null_block(loop_, to_null);
            null_value(test, to_null);
        }
        ReactiveTerminal::While { test, loop_, .. } => {
            null_value(test, to_null);
            null_block(loop_, to_null);
        }
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            null_block(consequent, to_null);
            if let Some(alternate) = alternate {
                null_block(alternate, to_null);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &mut case.block {
                    null_block(block, to_null);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => null_block(block, to_null),
        ReactiveTerminal::Try { block, handler, .. } => {
            null_block(block, to_null);
            null_block(handler, to_null);
        }
    }
}
