//! `pruneUnusedLabelsHIR(fn)` — port of `HIR/PruneUnusedLabelsHIR.ts`.
//!
//! Eliminates vacuous `label`/`goto`-break patterns from the CFG: a `label`
//! terminal whose labeled block ends in a `goto Break` to the label's own
//! fallthrough is collapsed by concatenating the labeled block's and the
//! fallthrough block's instructions into the label block and transplanting the
//! fallthrough's terminal, deleting the two now-empty blocks. Predecessor sets
//! are then rewritten to point at the surviving block.
//!
//! This is a CFG cleanup with no scope mutation. No current fixture matches the
//! merge criteria, so it is a no-op in practice, but the full algorithm is ported
//! so later passes always see the cleaned CFG.

use std::collections::HashMap;

use crate::hir::ids::BlockId;
use crate::hir::model::{BlockKind, HirFunction};
use crate::hir::terminal::{GotoVariant, Terminal};

struct Merge {
    label: BlockId,
    next: BlockId,
    fallthrough: BlockId,
}

/// `pruneUnusedLabelsHIR(fn)`.
pub fn prune_unused_labels_hir(func: &mut HirFunction) {
    let mut merged: Vec<Merge> = Vec::new();

    // First pass: collect mergeable label/next/fallthrough triples.
    for block in func.body.blocks() {
        let label_id = block.id;
        if let Terminal::Label {
            block: next_id,
            fallthrough: fallthrough_id,
            ..
        } = &block.terminal
        {
            let (Some(next), Some(fallthrough)) =
                (func.body.block(*next_id), func.body.block(*fallthrough_id))
            else {
                continue;
            };
            if let Terminal::Goto { block, variant, .. } = &next.terminal {
                if *variant == GotoVariant::Break
                    && *block == *fallthrough_id
                    && next.kind == BlockKind::Block
                    && fallthrough.kind == BlockKind::Block
                {
                    merged.push(Merge {
                        label: label_id,
                        next: *next_id,
                        fallthrough: *fallthrough_id,
                    });
                }
            }
        }
    }

    if merged.is_empty() {
        return;
    }

    let mut rewrites: HashMap<BlockId, BlockId> = HashMap::new();

    for merge in &merged {
        let label_id = rewrites.get(&merge.label).copied().unwrap_or(merge.label);

        // Extract the next + fallthrough instructions and the fallthrough terminal.
        let next_instrs = func
            .body
            .block(merge.next)
            .expect("next block exists")
            .instructions
            .clone();
        let fallthrough_block = func
            .body
            .block(merge.fallthrough)
            .expect("fallthrough block exists");
        let fallthrough_instrs = fallthrough_block.instructions.clone();
        let fallthrough_terminal = fallthrough_block.terminal.clone();

        // Merge into the label block.
        let label = func.body.block_mut(label_id).expect("label block exists");
        label.instructions.extend(next_instrs);
        label.instructions.extend(fallthrough_instrs);
        label.terminal = fallthrough_terminal;

        func.body.delete_block(merge.next);
        func.body.delete_block(merge.fallthrough);
        rewrites.insert(merge.fallthrough, label_id);
    }

    // Rewrite predecessors that point at deleted (now-merged) blocks.
    let block_ids: Vec<_> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        let block = func.body.block_mut(block_id).expect("block exists");
        let to_rewrite: Vec<BlockId> = block
            .preds
            .iter()
            .filter(|pred| rewrites.contains_key(pred))
            .copied()
            .collect();
        for pred in to_rewrite {
            let rewritten = rewrites[&pred];
            block.preds.remove(&pred);
            block.preds.insert(rewritten);
        }
    }
}
