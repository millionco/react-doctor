//! `pruneAlwaysInvalidatingScopes`, ported from
//! `packages/react-compiler/src/ReactiveScopes/PruneAlwaysInvalidatingScopes.ts`.
//!
//! Some instructions *always* produce a fresh value (array/object/JSX/new
//! expressions). When such a value is not itself memoized, any downstream reactive
//! scope that depends on it will always invalidate — so memoizing that scope is
//! wasted work. This pass converts those scopes to `pruned-scope` blocks.
//!
//! Function calls are deliberately excluded: a call *may* return a primitive, so
//! optimistically it is treated as possibly-stable and does not force pruning.
//!
//! Forward transform with a `within_scope` flag:
//! - On Array/Object/Jsx/JsxFragment/New: the lvalue is "always-invalidating",
//!   and if produced outside a scope it is also "unmemoized".
//! - `StoreLocal`/`LoadLocal` propagate both sets value -> lvalue.
//! - On each scope (visited with `within_scope = true`): if any dependency is in
//!   `unmemoized`, prune the scope, and seed `unmemoized` with the scope's
//!   always-invalidating declarations/reassignments for downstream propagation.

use std::collections::HashSet;

use crate::hir::ids::IdentifierId;
use crate::hir::value::InstructionValue;

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveScopeBlock, ReactiveStatement,
    ReactiveTerminal, ReactiveValue,
};

/// `pruneAlwaysInvalidatingScopes(fn)`.
pub fn prune_always_invalidating_scopes(func: &mut ReactiveFunction) {
    let mut state = State::default();
    transform_block(&mut func.body, false, &mut state);
}

#[derive(Default)]
struct State {
    /// Values guaranteed to produce a fresh identity each evaluation.
    always_invalidating: HashSet<IdentifierId>,
    /// The subset of `always_invalidating` produced outside any reactive scope.
    unmemoized: HashSet<IdentifierId>,
}

fn transform_block(block: &mut ReactiveBlock, within_scope: bool, state: &mut State) {
    // Rebuild the block so a `scope` can be replaced by a `pruned-scope` in place.
    let mut next: Vec<ReactiveStatement> = Vec::with_capacity(block.len());
    for stmt in block.drain(..) {
        match stmt {
            ReactiveStatement::Instruction(mut instruction) => {
                transform_instruction(&mut instruction, within_scope, state);
                next.push(ReactiveStatement::Instruction(instruction));
            }
            ReactiveStatement::Scope(mut scope) => {
                let prune = transform_scope(&mut scope, state);
                if prune {
                    next.push(ReactiveStatement::PrunedScope(scope));
                } else {
                    next.push(ReactiveStatement::Scope(scope));
                }
            }
            ReactiveStatement::PrunedScope(mut scope) => {
                // `transformPrunedScope` is *not* overridden by this pass, so the
                // base visitor traverses the body with the parent's `within_scope`
                // unchanged (it does not force a scope context like `transformScope`
                // does).
                transform_block(&mut scope.instructions, within_scope, state);
                next.push(ReactiveStatement::PrunedScope(scope));
            }
            ReactiveStatement::Terminal(mut term_stmt) => {
                transform_terminal(&mut term_stmt.terminal, within_scope, state);
                next.push(ReactiveStatement::Terminal(term_stmt));
            }
        }
    }
    *block = next;
}

fn transform_instruction(
    instruction: &mut ReactiveInstruction,
    within_scope: bool,
    state: &mut State,
) {
    // `visitInstruction` first: recurse into nested sequence instructions.
    if let ReactiveValue::Sequence(seq) = &mut instruction.value {
        for instr in seq.instructions.iter_mut() {
            transform_instruction(instr, within_scope, state);
        }
    }

    let lvalue_id = instruction.lvalue.as_ref().map(|p| p.identifier.id);
    let ReactiveValue::Instruction(value) = &instruction.value else {
        return;
    };
    match value.as_ref() {
        InstructionValue::ArrayExpression { .. }
        | InstructionValue::ObjectExpression { .. }
        | InstructionValue::JsxExpression { .. }
        | InstructionValue::JsxFragment { .. }
        | InstructionValue::NewExpression { .. } => {
            if let Some(lid) = lvalue_id {
                state.always_invalidating.insert(lid);
                if !within_scope {
                    state.unmemoized.insert(lid);
                }
            }
        }
        InstructionValue::StoreLocal { lvalue, value, .. } => {
            let value_id = value.identifier.id;
            let target = lvalue.place.identifier.id;
            if state.always_invalidating.contains(&value_id) {
                state.always_invalidating.insert(target);
            }
            if state.unmemoized.contains(&value_id) {
                state.unmemoized.insert(target);
            }
        }
        InstructionValue::LoadLocal { place, .. } => {
            let place_id = place.identifier.id;
            if let Some(lid) = lvalue_id {
                if state.always_invalidating.contains(&place_id) {
                    state.always_invalidating.insert(lid);
                }
                if state.unmemoized.contains(&place_id) {
                    state.unmemoized.insert(lid);
                }
            }
        }
        _ => {}
    }
}

/// `transformScope`: returns `true` if the scope should be pruned.
fn transform_scope(scope: &mut ReactiveScopeBlock, state: &mut State) -> bool {
    // `visitScope(scopeBlock, true)`: traverse the body within a scope context.
    transform_block(&mut scope.instructions, true, state);

    for dep in &scope.scope.dependencies {
        if state.unmemoized.contains(&dep.identifier.id) {
            // The scope depends on an always-invalidating, unmemoized value, so it
            // will always invalidate. Seed `unmemoized` with the scope's
            // always-invalidating outputs for downstream propagation, then prune.
            for (_, decl) in &scope.scope.declarations {
                if state.always_invalidating.contains(&decl.identifier.id) {
                    state.unmemoized.insert(decl.identifier.id);
                }
            }
            for reassign in &scope.scope.reassignments {
                if state.always_invalidating.contains(&reassign.id) {
                    state.unmemoized.insert(reassign.id);
                }
            }
            return true;
        }
    }
    false
}

fn transform_terminal(terminal: &mut ReactiveTerminal, within_scope: bool, state: &mut State) {
    // Terminals only carry operands (no lvalues to classify); the only behavior we
    // need is to recurse into nested blocks (the visitor's `traverseTerminal`). The
    // operand reads (`visitPlace`) are no-ops for this pass.
    match terminal {
        ReactiveTerminal::Break { .. }
        | ReactiveTerminal::Continue { .. }
        | ReactiveTerminal::Return { .. }
        | ReactiveTerminal::Throw { .. } => {}
        ReactiveTerminal::For { loop_, .. }
        | ReactiveTerminal::ForOf { loop_, .. }
        | ReactiveTerminal::ForIn { loop_, .. }
        | ReactiveTerminal::DoWhile { loop_, .. }
        | ReactiveTerminal::While { loop_, .. } => transform_block(loop_, within_scope, state),
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            transform_block(consequent, within_scope, state);
            if let Some(alternate) = alternate {
                transform_block(alternate, within_scope, state);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &mut case.block {
                    transform_block(block, within_scope, state);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => transform_block(block, within_scope, state),
        ReactiveTerminal::Try { block, handler, .. } => {
            transform_block(block, within_scope, state);
            transform_block(handler, within_scope, state);
        }
    }
}
