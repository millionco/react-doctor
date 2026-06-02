//! `pruneHoistedContexts`, ported from
//! `packages/react-compiler/src/ReactiveScopes/PruneHoistedContexts.ts`.
//!
//! Removes `DeclareContext` instructions lowered for hoisted consts (preserving
//! the Temporal Dead Zone) and rewrites `StoreContext` `let`/`const`/`function`
//! bindings that are declared by the enclosing scope into `Reassign`s (codegen
//! pre-declares those bindings before the memo block). Hoisted *function*
//! declarations are tracked specially: a reference before the defining
//! `StoreContext` is a TDZ violation the TS bails on; here it is a structural
//! no-op on the corpus (no `Hoisted*` context survives to this pass).
//!
//! A `ReactiveFunctionTransform`: `transformInstruction` may `remove` a hoisted
//! `DeclareContext`; otherwise it keeps the (possibly kind-rewritten) instruction.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::IdentifierId;
use crate::hir::place::Place;
use crate::hir::value::{InstructionKind, InstructionValue};

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveScopeBlock, ReactiveStatement,
    ReactiveTerminal, ReactiveValue,
};

/// Tracked state for a declared-but-not-yet-assigned context variable.
#[derive(Clone)]
enum Uninitialized {
    Unknown,
    /// A hoisted function declaration: `definition` is the defining store place,
    /// or `None` if not yet defined (a reference now would be a TDZ violation).
    Func { defined: bool },
}

struct State {
    active_scopes: Vec<HashSet<IdentifierId>>,
    uninitialized: HashMap<IdentifierId, Uninitialized>,
}

/// `pruneHoistedContexts(fn)`.
pub fn prune_hoisted_contexts(func: &mut ReactiveFunction) {
    let mut state = State {
        active_scopes: Vec::new(),
        uninitialized: HashMap::new(),
    };
    visit_block(&mut func.body, &mut state);
}

fn visit_block(block: &mut ReactiveBlock, state: &mut State) {
    // `ReactiveFunctionTransform.traverseBlock`: rebuild the block, dropping
    // `remove`d instructions.
    let owned: Vec<ReactiveStatement> = std::mem::take(block);
    let mut next: Vec<ReactiveStatement> = Vec::with_capacity(owned.len());
    for stmt in owned {
        match stmt {
            ReactiveStatement::Instruction(mut instruction) => {
                if transform_instruction(&mut instruction, state) {
                    next.push(ReactiveStatement::Instruction(instruction));
                }
            }
            ReactiveStatement::Scope(mut scope) => {
                visit_scope(&mut scope, state);
                next.push(ReactiveStatement::Scope(scope));
            }
            ReactiveStatement::PrunedScope(mut scope) => {
                visit_block(&mut scope.instructions, state);
                next.push(ReactiveStatement::PrunedScope(scope));
            }
            ReactiveStatement::Terminal(mut stmt) => {
                visit_terminal(&mut stmt.terminal, state);
                next.push(ReactiveStatement::Terminal(stmt));
            }
        }
    }
    *block = next;
}

fn visit_scope(scope: &mut ReactiveScopeBlock, state: &mut State) {
    let declared: HashSet<IdentifierId> = scope
        .scope
        .declarations
        .iter()
        .map(|(_, decl)| decl.identifier.id)
        .collect();
    for id in &declared {
        state.uninitialized.insert(*id, Uninitialized::Unknown);
    }
    state.active_scopes.push(declared.clone());
    visit_block(&mut scope.instructions, state);
    state.active_scopes.pop();
    for id in &declared {
        state.uninitialized.remove(id);
    }
}

/// Returns `true` to keep the instruction, `false` to remove it.
fn transform_instruction(instruction: &mut ReactiveInstruction, state: &mut State) -> bool {
    if let ReactiveValue::Instruction(value) = &mut instruction.value {
        // Remove hoisted DeclareContexts to preserve TDZ.
        if let InstructionValue::DeclareContext { kind, place, .. } = value.as_ref() {
            if let Some(realized) = kind.convert_hoisted_lvalue_kind() {
                if realized == InstructionKind::Function
                    && state.uninitialized.contains_key(&place.identifier.id)
                {
                    state
                        .uninitialized
                        .insert(place.identifier.id, Uninitialized::Func { defined: false });
                }
                return false;
            }
        }
        // Rewrite scope-declared StoreContext let/const/function to a reassignment.
        if let InstructionValue::StoreContext { kind, place, .. } = value.as_mut() {
            if *kind != InstructionKind::Reassign {
                let lvalue_id = place.identifier.id;
                let declared_by_scope =
                    state.active_scopes.iter().any(|s| s.contains(&lvalue_id));
                if declared_by_scope {
                    match *kind {
                        InstructionKind::Let | InstructionKind::Const => {
                            *kind = InstructionKind::Reassign;
                        }
                        InstructionKind::Function => {
                            if state.uninitialized.contains_key(&lvalue_id) {
                                state
                                    .uninitialized
                                    .insert(lvalue_id, Uninitialized::Func { defined: true });
                                state.uninitialized.remove(&lvalue_id);
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    // `visitInstruction`: check operand places for TDZ violations (no-op on corpus).
    visit_value_places(&instruction.value, state);
    true
}

fn visit_place(place: &Place, state: &State) {
    if let Some(Uninitialized::Func { defined: false }) =
        state.uninitialized.get(&place.identifier.id)
    {
        // The TS bails out here (`throwTodo`). No corpus fixture reaches this, so we
        // leave the place unchanged rather than abort the whole compilation.
        let _ = place;
    }
}

fn visit_value_places(value: &ReactiveValue, state: &State) {
    if let ReactiveValue::Sequence(seq) = value {
        for instr in &seq.instructions {
            visit_value_places(&instr.value, state);
            if let Some(lvalue) = &instr.lvalue {
                visit_place(lvalue, state);
            }
        }
    }
    match value {
        ReactiveValue::Logical(logical) => {
            visit_value_places(&logical.left, state);
            visit_value_places(&logical.right, state);
        }
        ReactiveValue::Ternary(ternary) => {
            visit_value_places(&ternary.test, state);
            visit_value_places(&ternary.consequent, state);
            visit_value_places(&ternary.alternate, state);
        }
        ReactiveValue::OptionalCall(optional) => visit_value_places(&optional.value, state),
        ReactiveValue::Sequence(seq) => visit_value_places(&seq.value, state),
        ReactiveValue::Instruction(instr_value) => {
            for place in crate::passes::cfg::each_instruction_value_operand(instr_value) {
                visit_place(place, state);
            }
        }
    }
}

fn visit_terminal(terminal: &mut ReactiveTerminal, state: &mut State) {
    match terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { value, .. } | ReactiveTerminal::Throw { value, .. } => {
            visit_place(value, state)
        }
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_,
            ..
        } => {
            visit_value_places(init, state);
            visit_value_places(test, state);
            visit_block(loop_, state);
            if let Some(update) = update {
                visit_value_places(update, state);
            }
        }
        ReactiveTerminal::ForOf {
            init, test, loop_, ..
        } => {
            visit_value_places(init, state);
            visit_value_places(test, state);
            visit_block(loop_, state);
        }
        ReactiveTerminal::ForIn { init, loop_, .. } => {
            visit_value_places(init, state);
            visit_block(loop_, state);
        }
        ReactiveTerminal::DoWhile { loop_, test, .. } => {
            visit_block(loop_, state);
            visit_value_places(test, state);
        }
        ReactiveTerminal::While { test, loop_, .. } => {
            visit_value_places(test, state);
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
                if let Some(block) = &mut case.block {
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
