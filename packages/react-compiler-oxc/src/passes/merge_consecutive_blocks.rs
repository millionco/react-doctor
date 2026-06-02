//! `mergeConsecutiveBlocks` (`HIR/MergeConsecutiveBlocks.ts`).
//!
//! Merges sequences of blocks that always execute consecutively: where the
//! predecessor ends in a `goto` to the successor and is the successor's *only*
//! predecessor. Value/loop blocks are left alone (merging them would break the
//! structure of the high-level terminals that reference them), and fallthrough
//! targets are never merged.

use std::collections::HashMap;

use crate::hir::ids::BlockId;
use crate::hir::instruction::Instruction;
use crate::hir::model::{BlockKind, HirFunction};
use crate::hir::place::{Effect, SourceLocation};
use crate::hir::terminal::Terminal;
use crate::hir::value::InstructionValue;

use super::cfg::{mark_predecessors, terminal_fallthrough};
use super::PassContext;

/// Run `mergeConsecutiveBlocks` on `func` in place, recursing into nested
/// function expressions / object methods first.
///
/// `ctx` is threaded purely to keep the uniform `(func, ctx)` pass signature and
/// to recurse into nested functions; this pass allocates no fresh ids itself.
#[allow(clippy::only_used_in_recursion)]
pub fn merge_consecutive_blocks(func: &mut HirFunction, ctx: &mut PassContext) {
    let mut merged = MergedBlocks::new();

    // Collect fallthrough targets and recurse into nested functions, matching
    // the TS single pass over the blocks.
    let mut fallthrough_blocks: Vec<BlockId> = Vec::new();
    for block in func.body.blocks_mut() {
        if let Some(fallthrough) = terminal_fallthrough(&block.terminal)
            && !fallthrough_blocks.contains(&fallthrough)
        {
            fallthrough_blocks.push(fallthrough);
        }
        for instr in &mut block.instructions {
            match &mut instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    merge_consecutive_blocks(&mut lowered_func.func, ctx);
                }
                _ => {}
            }
        }
    }

    // Iterate the original block ids. The TS iterates the live `Map`; deleting a
    // block mid-iteration simply skips it, which collecting the ids up front and
    // re-resolving merged predecessors reproduces.
    let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        let Some(block) = func.body.block(block_id) else {
            continue;
        };

        if block.preds.len() != 1
            || block.kind != BlockKind::Block
            || fallthrough_blocks.contains(&block_id)
        {
            continue;
        }

        let original_predecessor_id = *block
            .preds
            .iter()
            .next()
            .expect("block has exactly one predecessor");
        let predecessor_id = merged.get(original_predecessor_id);
        let predecessor = func
            .body
            .block(predecessor_id)
            .expect("predecessor should exist");

        // The predecessor must unconditionally transfer control here.
        if !matches!(predecessor.terminal, Terminal::Goto { .. })
            || predecessor.kind != BlockKind::Block
        {
            continue;
        }

        // Move the successor's phis (as canonical LoadLocal assignments to the
        // single operand), instructions, and terminal into the predecessor.
        let block = func.body.block(block_id).expect("successor exists").clone();
        let terminal_id = predecessor.terminal.id();

        let predecessor = func
            .body
            .block_mut(predecessor_id)
            .expect("predecessor exists");
        for phi in &block.phis {
            debug_assert_eq!(
                phi.operands.len(),
                1,
                "single-predecessor block should have single-operand phis"
            );
            let operand = phi
                .operands
                .values()
                .next()
                .expect("phi has a single operand");
            let mut lvalue = phi.place.clone();
            lvalue.effect = Effect::ConditionallyMutate;
            lvalue.reactive = false;
            lvalue.loc = SourceLocation::Generated;
            predecessor.instructions.push(Instruction {
                id: terminal_id,
                lvalue,
                value: InstructionValue::LoadLocal {
                    place: operand.clone(),
                    loc: SourceLocation::Generated,
                },
                loc: SourceLocation::Generated,
                effects: None,
            });
        }
        predecessor.instructions.extend(block.instructions.clone());
        predecessor.terminal = block.terminal.clone();

        merged.merge(block_id, predecessor_id);
        func.body.delete_block(block_id);
    }

    // Remap phi operand predecessors through any merges.
    for block in func.body.blocks_mut() {
        for phi in &mut block.phis {
            let preds: Vec<BlockId> = phi.operands.keys().copied().collect();
            for predecessor_id in preds {
                let mapped = merged.get(predecessor_id);
                if mapped != predecessor_id
                    && let Some(operand) = phi.operands.remove(&predecessor_id)
                {
                    phi.operands.insert(mapped, operand);
                }
            }
        }
    }

    mark_predecessors(&mut func.body);

    // Remap any fallthrough targets that were merged away.
    for block in func.body.blocks_mut() {
        if let Some(fallthrough) = block.terminal.fallthrough_mut() {
            *fallthrough = merged.get(*fallthrough);
        }
    }
}

/// Tracks block merges, resolving transitively (`MergedBlocks` in the TS).
struct MergedBlocks {
    map: HashMap<BlockId, BlockId>,
}

impl MergedBlocks {
    fn new() -> Self {
        MergedBlocks {
            map: HashMap::new(),
        }
    }

    /// Record that `block` was merged into `into`.
    fn merge(&mut self, block: BlockId, into: BlockId) {
        let target = self.get(into);
        self.map.insert(block, target);
    }

    /// The id of the block that `block` was ultimately merged into (following
    /// the chain transitively).
    fn get(&self, block: BlockId) -> BlockId {
        let mut current = block;
        while let Some(&target) = self.map.get(&current) {
            current = target;
        }
        current
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::ids::{IdentifierId, InstructionId, TypeId};
    use crate::hir::instruction::Instruction;
    use crate::hir::model::{BasicBlock, Hir, ReactFunctionType};
    use crate::hir::place::{Identifier, Place, SourceLocation};
    use crate::hir::terminal::{GotoVariant, ReturnVariant};
    use crate::hir::value::PrimitiveValue;
    use crate::passes::PassContext;

    fn temp(id: u32) -> Place {
        Place {
            identifier: Identifier::make_temporary(
                IdentifierId::new(id),
                TypeId::new(0),
                SourceLocation::Generated,
            ),
            effect: Effect::Unknown,
            reactive: false,
            loc: SourceLocation::Generated,
        }
    }

    fn primitive(lvalue: Place, n: f64) -> Instruction {
        Instruction {
            id: InstructionId::new(0),
            lvalue,
            value: InstructionValue::Primitive {
                value: PrimitiveValue::Number(n),
                loc: SourceLocation::Generated,
            },
            loc: SourceLocation::Generated,
            effects: None,
        }
    }

    fn goto(target: BlockId) -> Terminal {
        Terminal::Goto {
            block: target,
            variant: GotoVariant::Break,
            id: InstructionId::new(0),
            loc: SourceLocation::Generated,
        }
    }

    fn block(id: BlockId, instrs: Vec<Instruction>, terminal: Terminal) -> BasicBlock {
        BasicBlock {
            kind: BlockKind::Block,
            id,
            instructions: instrs,
            terminal,
            preds: Default::default(),
            phis: Vec::new(),
        }
    }

    fn func(body: Hir) -> HirFunction {
        HirFunction {
            loc: SourceLocation::Generated,
            id: Some("f".to_string()),
            name_hint: None,
            fn_type: ReactFunctionType::Other,
            params: Vec::new(),
            return_type_annotation: None,
            returns: temp(99),
            context: Vec::new(),
            body,
            generator: false,
            async_: false,
            directives: Vec::new(),
            aliasing_effects: None,
            outlined: Vec::new(),
        }
    }

    /// A chain `bb0 -goto-> bb1 -goto-> bb2(return)` where each successor has a
    /// single predecessor collapses transitively into `bb0`.
    #[test]
    fn merges_goto_chain_transitively() {
        let b0 = BlockId::new(0);
        let b1 = BlockId::new(1);
        let b2 = BlockId::new(2);

        let mut body = Hir::new(b0);
        body.push_block(block(b0, vec![primitive(temp(0), 1.0)], goto(b1)));
        body.push_block(block(b1, vec![primitive(temp(1), 2.0)], goto(b2)));
        body.push_block(block(
            b2,
            vec![primitive(temp(2), 3.0)],
            Terminal::Return {
                return_variant: ReturnVariant::Explicit,
                value: temp(2),
                id: InstructionId::new(0),
                effects: None,
                loc: SourceLocation::Generated,
            },
        ));

        let mut f = func(body);
        // Predecessors must be computed before the pass.
        mark_predecessors(&mut f.body);

        let mut ctx = PassContext::new(3, 100);
        merge_consecutive_blocks(&mut f, &mut ctx);

        assert_eq!(f.body.len(), 1, "chain collapses to a single block");
        let entry = f.body.block(b0).expect("entry survives");
        assert_eq!(entry.instructions.len(), 3, "all instructions merged in");
        assert!(
            matches!(entry.terminal, Terminal::Return { .. }),
            "predecessor takes the successor's terminal"
        );
    }

    /// A block with two predecessors is not merged.
    #[test]
    fn does_not_merge_multi_predecessor_block() {
        let b0 = BlockId::new(0);
        let b1 = BlockId::new(1);
        let join = BlockId::new(2);

        let mut body = Hir::new(b0);
        body.push_block(block(
            b0,
            vec![primitive(temp(0), 0.0)],
            Terminal::If {
                test: temp(0),
                consequent: b1,
                alternate: join,
                fallthrough: join,
                id: InstructionId::new(0),
                loc: SourceLocation::Generated,
            },
        ));
        body.push_block(block(b1, Vec::new(), goto(join)));
        body.push_block(block(
            join,
            Vec::new(),
            Terminal::Return {
                return_variant: ReturnVariant::Void,
                value: temp(1),
                id: InstructionId::new(0),
                effects: None,
                loc: SourceLocation::Generated,
            },
        ));

        let mut f = func(body);
        mark_predecessors(&mut f.body);
        let mut ctx = PassContext::new(3, 100);
        merge_consecutive_blocks(&mut f, &mut ctx);

        // The join block has two predecessors (bb0 via alternate, bb1 via goto)
        // and is a fallthrough target, so it must not be merged.
        assert!(
            f.body.block(join).is_some(),
            "multi-predecessor fallthrough block must survive"
        );
    }
}
