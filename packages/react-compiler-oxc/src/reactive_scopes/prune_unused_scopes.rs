//! `PruneUnusedScopes`, ported from
//! `packages/react-compiler/src/ReactiveScopes/PruneUnusedScopes.ts`.
//!
//! Converts scopes without outputs into `pruned-scope` blocks. A `scope` block is
//! kept iff it (a) contains a `return` statement anywhere within (an early return
//! that `PropagateEarlyReturns` will handle), (b) reassigns ≥1 variable, or (c)
//! declares ≥1 value of its *own* (a declaration whose `scope.id` equals the
//! block's scope id — declarations bubbled up from inner scopes do not count).
//! Otherwise the `scope` becomes a `pruned-scope` carrying the same metadata.

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveScopeBlock, ReactiveStatement, ReactiveTerminal,
};

/// `pruneUnusedScopes(fn)`.
pub fn prune_unused_scopes(func: &mut ReactiveFunction) {
    transform_block(&mut func.body);
}

fn transform_block(block: &mut ReactiveBlock) {
    let mut next: Vec<ReactiveStatement> = Vec::with_capacity(block.len());
    for stmt in block.drain(..) {
        match stmt {
            ReactiveStatement::Scope(mut scope) => {
                // `transformScope`: visit the scope (recursing) before deciding.
                transform_block(&mut scope.instructions);
                if keep_scope(&scope) {
                    next.push(ReactiveStatement::Scope(scope));
                } else {
                    next.push(ReactiveStatement::PrunedScope(scope));
                }
            }
            ReactiveStatement::PrunedScope(mut scope) => {
                transform_block(&mut scope.instructions);
                next.push(ReactiveStatement::PrunedScope(scope));
            }
            ReactiveStatement::Terminal(mut term_stmt) => {
                transform_terminal_blocks(&mut term_stmt.terminal);
                next.push(ReactiveStatement::Terminal(term_stmt));
            }
            ReactiveStatement::Instruction(instruction) => {
                next.push(ReactiveStatement::Instruction(instruction));
            }
        }
    }
    *block = next;
}

fn transform_terminal_blocks(terminal: &mut ReactiveTerminal) {
    match terminal {
        ReactiveTerminal::Break { .. }
        | ReactiveTerminal::Continue { .. }
        | ReactiveTerminal::Return { .. }
        | ReactiveTerminal::Throw { .. } => {}
        ReactiveTerminal::For { loop_, .. }
        | ReactiveTerminal::ForOf { loop_, .. }
        | ReactiveTerminal::ForIn { loop_, .. }
        | ReactiveTerminal::DoWhile { loop_, .. }
        | ReactiveTerminal::While { loop_, .. } => transform_block(loop_),
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            transform_block(consequent);
            if let Some(alternate) = alternate {
                transform_block(alternate);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &mut case.block {
                    transform_block(block);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => transform_block(block),
        ReactiveTerminal::Try { block, handler, .. } => {
            transform_block(block);
            transform_block(handler);
        }
    }
}

/// Whether the scope should be kept (vs. converted to `pruned-scope`).
fn keep_scope(scope_block: &ReactiveScopeBlock) -> bool {
    let scope = &scope_block.scope;
    block_has_return(&scope_block.instructions)
        || !scope.reassignments.is_empty()
        || (!scope.declarations.is_empty() && has_own_declaration(scope_block))
}

/// Does the scope's body (recursively, through nested blocks and scopes) contain a
/// `return` terminal? Mirrors the TS `visitScope` with a per-scope state that the
/// `visitTerminal` sets on encountering a `return`.
fn block_has_return(block: &ReactiveBlock) -> bool {
    block.iter().any(|stmt| match stmt {
        ReactiveStatement::Terminal(term_stmt) => terminal_has_return(&term_stmt.terminal),
        ReactiveStatement::Scope(scope) | ReactiveStatement::PrunedScope(scope) => {
            block_has_return(&scope.instructions)
        }
        ReactiveStatement::Instruction(_) => false,
    })
}

fn terminal_has_return(terminal: &ReactiveTerminal) -> bool {
    match terminal {
        ReactiveTerminal::Return { .. } => true,
        ReactiveTerminal::Break { .. }
        | ReactiveTerminal::Continue { .. }
        | ReactiveTerminal::Throw { .. } => false,
        ReactiveTerminal::For { loop_, .. }
        | ReactiveTerminal::ForOf { loop_, .. }
        | ReactiveTerminal::ForIn { loop_, .. }
        | ReactiveTerminal::DoWhile { loop_, .. }
        | ReactiveTerminal::While { loop_, .. } => block_has_return(loop_),
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            block_has_return(consequent)
                || alternate.as_ref().is_some_and(|a| block_has_return(a))
        }
        ReactiveTerminal::Switch { cases, .. } => cases
            .iter()
            .any(|case| case.block.as_ref().is_some_and(|b| block_has_return(b))),
        ReactiveTerminal::Label { block, .. } => block_has_return(block),
        ReactiveTerminal::Try { block, handler, .. } => {
            block_has_return(block) || block_has_return(handler)
        }
    }
}

/// `hasOwnDeclaration(block)`: does the scope declare any value of its own (a
/// declaration whose declaring `scope.id` matches the block's scope id)?
fn has_own_declaration(block: &ReactiveScopeBlock) -> bool {
    block
        .scope
        .declarations
        .iter()
        .any(|(_, declaration)| declaration.scope == block.scope.id)
}
