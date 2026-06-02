//! `PruneUnusedLabels`, ported from
//! `packages/react-compiler/src/ReactiveScopes/PruneUnusedLabels.ts`.
//!
//! Flattens labeled terminals where the label is not reachable, and nulls out
//! (marks `implicit`) labels for other terminals where the label is unused.
//!
//! The TS pass uses a `ReactiveFunctionTransform<Set<BlockId>>` whose
//! `transformTerminal` first traverses (so inner labels are collected before the
//! outer decision), then:
//! - records `break`/`continue` targets with `targetKind === 'labeled'` into the
//!   live-label set, and
//! - for a `label` terminal whose label id is *not* in the set, replaces the
//!   labeled terminal with its inner block (a `replace-many`), popping a trailing
//!   `break` whose `target === null` (the reactive break's `target` is always a
//!   `BlockId`, so this pop never fires here);
//! - otherwise, when the label is unreachable, marks `label.implicit = true`.
//!
//! Crucially the TS `traverseBlock` collects targets from inner terminals *before*
//! the enclosing terminal is transformed (depth-first, last-to-outer), so we run
//! the same post-order: recurse into children, mutate the live set, then decide.

use std::collections::HashSet;

use crate::hir::ids::BlockId;

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveStatement, ReactiveTerminal, ReactiveTerminalStatement,
    ReactiveTerminalTargetKind,
};

/// `pruneUnusedLabels(fn)`: flatten/strip unnecessary terminal labels.
pub fn prune_unused_labels(func: &mut ReactiveFunction) {
    let mut labels: HashSet<BlockId> = HashSet::new();
    transform_block(&mut func.body, &mut labels);
}

/// Port of `ReactiveFunctionTransform.traverseBlock` specialized to this pass:
/// each statement is transformed (recursing into nested blocks first), and the
/// result may keep / replace-many the statement.
fn transform_block(block: &mut ReactiveBlock, labels: &mut HashSet<BlockId>) {
    let mut next: Vec<ReactiveStatement> = Vec::with_capacity(block.len());
    for stmt in block.drain(..) {
        match stmt {
            ReactiveStatement::Terminal(term_stmt) => {
                transform_terminal(*term_stmt, labels, &mut next);
            }
            ReactiveStatement::Scope(mut scope) => {
                transform_block(&mut scope.instructions, labels);
                next.push(ReactiveStatement::Scope(scope));
            }
            ReactiveStatement::PrunedScope(mut scope) => {
                transform_block(&mut scope.instructions, labels);
                next.push(ReactiveStatement::PrunedScope(scope));
            }
            ReactiveStatement::Instruction(instruction) => {
                next.push(ReactiveStatement::Instruction(instruction));
            }
        }
    }
    *block = next;
}

/// `transformTerminal(stmt, state)`: traverse first, record labeled break/continue
/// targets, then either flatten an unreachable `label` (replace-many) or mark its
/// label implicit; appends the result(s) to `out`.
fn transform_terminal(
    mut stmt: ReactiveTerminalStatement,
    labels: &mut HashSet<BlockId>,
    out: &mut Vec<ReactiveStatement>,
) {
    // `this.traverseTerminal(stmt, state)` — recurse into nested blocks so their
    // labeled break/continue targets are recorded before this terminal decides.
    traverse_terminal_blocks(&mut stmt.terminal, labels);

    // Record this terminal's own labeled break/continue target.
    match &stmt.terminal {
        ReactiveTerminal::Break {
            target,
            target_kind: ReactiveTerminalTargetKind::Labeled,
            ..
        }
        | ReactiveTerminal::Continue {
            target,
            target_kind: ReactiveTerminalTargetKind::Labeled,
            ..
        } => {
            labels.insert(*target);
        }
        _ => {}
    }

    // Is this terminal reachable via a break/continue to its label?
    let is_reachable_label = stmt
        .label
        .as_ref()
        .is_some_and(|label| labels.contains(&label.id));

    if matches!(stmt.terminal, ReactiveTerminal::Label { .. }) && !is_reachable_label {
        // Flatten labeled terminals where the label isn't necessary.
        let ReactiveTerminal::Label { block, .. } = stmt.terminal else {
            unreachable!("just matched a label terminal");
        };
        // The TS pops a trailing `break` whose `target === null`. In the reactive
        // IR a `break`'s `target` is always a `BlockId` (never null), so that pop
        // never fires; the inner block is inlined verbatim.
        out.extend(block);
    } else {
        if !is_reachable_label {
            if let Some(label) = &mut stmt.label {
                label.implicit = true;
            }
        }
        out.push(ReactiveStatement::Terminal(Box::new(stmt)));
    }
}

/// Recurse into each nested [`ReactiveBlock`] of a terminal (the `traverseTerminal`
/// block walk), applying [`transform_block`] in place.
fn traverse_terminal_blocks(terminal: &mut ReactiveTerminal, labels: &mut HashSet<BlockId>) {
    match terminal {
        ReactiveTerminal::Break { .. }
        | ReactiveTerminal::Continue { .. }
        | ReactiveTerminal::Return { .. }
        | ReactiveTerminal::Throw { .. } => {}
        ReactiveTerminal::For { loop_, .. }
        | ReactiveTerminal::ForOf { loop_, .. }
        | ReactiveTerminal::ForIn { loop_, .. }
        | ReactiveTerminal::DoWhile { loop_, .. }
        | ReactiveTerminal::While { loop_, .. } => transform_block(loop_, labels),
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            transform_block(consequent, labels);
            if let Some(alternate) = alternate {
                transform_block(alternate, labels);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &mut case.block {
                    transform_block(block, labels);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => transform_block(block, labels),
        ReactiveTerminal::Try { block, handler, .. } => {
            transform_block(block, labels);
            transform_block(handler, labels);
        }
    }
}
