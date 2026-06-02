//! `flattenReactiveLoopsHIR(fn)` — port of
//! `ReactiveScopes/FlattenReactiveLoopsHIR.ts`.
//!
//! Prunes any reactive scope contained within a loop (`for`/`while`/`do-while`/
//! `for-in`/`for-of`) by converting its `scope` terminal to a `pruned-scope`
//! terminal (preserving all other fields). Memoization inside loops is not
//! supported, so we memoize *around* the loop instead.
//!
//! A single pass through blocks in program order maintains a stack of active loop
//! fallthrough block ids: a loop terminal pushes its fallthrough; reaching a block
//! whose id is on the stack pops it. While the stack is non-empty, any `scope`
//! terminal encountered is rewritten to `pruned-scope`.

use crate::hir::ids::BlockId;
use crate::hir::model::HirFunction;
use crate::hir::terminal::Terminal;

/// `flattenReactiveLoopsHIR(fn)`.
pub fn flatten_reactive_loops_hir(func: &mut HirFunction) {
    let mut active_loops: Vec<BlockId> = Vec::new();
    let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        // `retainWhere(activeLoops, id => id !== block.id)`.
        active_loops.retain(|id| *id != block_id);
        let block = func.body.block_mut(block_id).expect("block exists");
        match &block.terminal {
            Terminal::DoWhile { fallthrough, .. }
            | Terminal::For { fallthrough, .. }
            | Terminal::ForIn { fallthrough, .. }
            | Terminal::ForOf { fallthrough, .. }
            | Terminal::While { fallthrough, .. } => {
                active_loops.push(*fallthrough);
            }
            Terminal::Scope {
                block: body,
                fallthrough,
                scope,
                id,
                loc,
            } => {
                if !active_loops.is_empty() {
                    block.terminal = Terminal::PrunedScope {
                        block: *body,
                        fallthrough: *fallthrough,
                        scope: scope.clone(),
                        id: *id,
                        loc: loc.clone(),
                    };
                }
            }
            _ => {}
        }
    }
}
