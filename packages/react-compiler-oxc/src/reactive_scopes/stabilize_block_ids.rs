//! `stabilizeBlockIds`, ported from
//! `packages/react-compiler/src/ReactiveScopes/StabilizeBlockIds.ts`.
//!
//! Renumbers the block ids referenced by labels / break-continue targets /
//! scope early-return labels to a stable sequential `0, 1, 2, …` based on the
//! order they are first *referenced* in source traversal order (so codegen is
//! deterministic across runs). Two passes:
//! 1. `CollectReferencedLabels` — gathers every explicitly-referenced block id
//!    (non-implicit terminal labels + scope `earlyReturnValue.label`).
//! 2. `RewriteBlockIds` — assigns each a fresh sequential id via
//!    `getOrInsertDefault(map, oldId, map.len())` and rewrites the labels +
//!    break/continue targets in place.
//!
//! Only block-id *values* change; control flow is untouched.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::BlockId;

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveScopeBlock, ReactiveStatement, ReactiveTerminal,
    ReactiveTerminalStatement,
};

/// `stabilizeBlockIds(fn)`.
pub fn stabilize_block_ids(func: &mut ReactiveFunction) {
    let mut referenced: HashSet<BlockId> = HashSet::new();
    let mut order: Vec<BlockId> = Vec::new();
    collect_block(&func.body, &mut referenced, &mut order);

    let mut mappings: HashMap<BlockId, BlockId> = HashMap::new();
    for block_id in order {
        let size = mappings.len() as u32;
        mappings.insert(block_id, BlockId::new(size));
    }

    rewrite_block(&mut func.body, &mut mappings);
}

/// `getOrInsertDefault(map, key, map.size)` then return the mapped id.
fn get_or_insert(mappings: &mut HashMap<BlockId, BlockId>, key: BlockId) -> BlockId {
    let size = mappings.len() as u32;
    *mappings.entry(key).or_insert_with(|| BlockId::new(size))
}

// ---- pass 1: CollectReferencedLabels ----

fn collect_block(block: &ReactiveBlock, referenced: &mut HashSet<BlockId>, order: &mut Vec<BlockId>) {
    for stmt in block {
        match stmt {
            ReactiveStatement::Instruction(_) => {}
            ReactiveStatement::Scope(scope) => {
                if let Some(early) = &scope.scope.early_return_value {
                    add(referenced, order, early.label);
                }
                collect_block(&scope.instructions, referenced, order);
            }
            ReactiveStatement::PrunedScope(scope) => {
                // `traversePrunedScope` (base): only the body, no early-return read.
                collect_block(&scope.instructions, referenced, order);
            }
            ReactiveStatement::Terminal(stmt) => collect_terminal(stmt, referenced, order),
        }
    }
}

fn add(referenced: &mut HashSet<BlockId>, order: &mut Vec<BlockId>, id: BlockId) {
    if referenced.insert(id) {
        order.push(id);
    }
}

fn collect_terminal(
    stmt: &ReactiveTerminalStatement,
    referenced: &mut HashSet<BlockId>,
    order: &mut Vec<BlockId>,
) {
    if let Some(label) = &stmt.label {
        if !label.implicit {
            add(referenced, order, label.id);
        }
    }
    collect_terminal_inner(&stmt.terminal, referenced, order);
}

fn collect_terminal_inner(
    terminal: &ReactiveTerminal,
    referenced: &mut HashSet<BlockId>,
    order: &mut Vec<BlockId>,
) {
    match terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { .. } | ReactiveTerminal::Throw { .. } => {}
        ReactiveTerminal::For { loop_, .. }
        | ReactiveTerminal::ForOf { loop_, .. }
        | ReactiveTerminal::ForIn { loop_, .. }
        | ReactiveTerminal::DoWhile { loop_, .. }
        | ReactiveTerminal::While { loop_, .. } => collect_block(loop_, referenced, order),
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            collect_block(consequent, referenced, order);
            if let Some(alternate) = alternate {
                collect_block(alternate, referenced, order);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &case.block {
                    collect_block(block, referenced, order);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => collect_block(block, referenced, order),
        ReactiveTerminal::Try { block, handler, .. } => {
            collect_block(block, referenced, order);
            collect_block(handler, referenced, order);
        }
    }
}

// ---- pass 2: RewriteBlockIds ----

fn rewrite_block(block: &mut ReactiveBlock, mappings: &mut HashMap<BlockId, BlockId>) {
    for stmt in block.iter_mut() {
        match stmt {
            ReactiveStatement::Instruction(_) => {}
            ReactiveStatement::Scope(scope) => {
                rewrite_scope_early_return(scope, mappings);
                rewrite_block(&mut scope.instructions, mappings);
            }
            ReactiveStatement::PrunedScope(scope) => {
                rewrite_block(&mut scope.instructions, mappings);
            }
            ReactiveStatement::Terminal(stmt) => rewrite_terminal(stmt, mappings),
        }
    }
}

fn rewrite_scope_early_return(
    scope: &mut ReactiveScopeBlock,
    mappings: &mut HashMap<BlockId, BlockId>,
) {
    if let Some(early) = &mut scope.scope.early_return_value {
        let id = get_or_insert(mappings, early.label);
        early.label = id;
    }
}

fn rewrite_terminal(stmt: &mut ReactiveTerminalStatement, mappings: &mut HashMap<BlockId, BlockId>) {
    if let Some(label) = &mut stmt.label {
        let id = get_or_insert(mappings, label.id);
        label.id = id;
    }
    match &mut stmt.terminal {
        ReactiveTerminal::Break { target, .. } | ReactiveTerminal::Continue { target, .. } => {
            let id = get_or_insert(mappings, *target);
            *target = id;
        }
        _ => {}
    }
    rewrite_terminal_inner(&mut stmt.terminal, mappings);
}

fn rewrite_terminal_inner(terminal: &mut ReactiveTerminal, mappings: &mut HashMap<BlockId, BlockId>) {
    match terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { .. } | ReactiveTerminal::Throw { .. } => {}
        ReactiveTerminal::For { loop_, .. }
        | ReactiveTerminal::ForOf { loop_, .. }
        | ReactiveTerminal::ForIn { loop_, .. }
        | ReactiveTerminal::DoWhile { loop_, .. }
        | ReactiveTerminal::While { loop_, .. } => rewrite_block(loop_, mappings),
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            rewrite_block(consequent, mappings);
            if let Some(alternate) = alternate {
                rewrite_block(alternate, mappings);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &mut case.block {
                    rewrite_block(block, mappings);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => rewrite_block(block, mappings),
        ReactiveTerminal::Try { block, handler, .. } => {
            rewrite_block(block, mappings);
            rewrite_block(handler, mappings);
        }
    }
}
