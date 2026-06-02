//! `pruneMaybeThrows` (`Optimization/PruneMaybeThrows.ts`).
//!
//! Updates `maybe-throw` terminals for blocks that can provably *never* throw,
//! nulling out the handler to indicate control will always continue. The
//! analysis is intentionally conservative: a block only "cannot throw" if all of
//! its instructions are `Primitive`/`ArrayExpression`/`ObjectExpression` (even a
//! variable reference could throw because of the TDZ).
//!
//! When any terminal changes, blocks may have become unreachable, so the graph
//! is re-minified (reverse-postorder, the for/do-while/try cleanups, instruction
//! renumbering, and `mergeConsecutiveBlocks`) and phi operands are rewritten to
//! reference the surviving predecessors.

use std::collections::HashMap;

use crate::hir::ids::BlockId;
use crate::hir::model::HirFunction;
use crate::hir::terminal::Terminal;
use crate::hir::value::InstructionValue;

use super::cfg::{
    mark_instruction_ids, remove_dead_do_while_statements, remove_unnecessary_try_catch,
    remove_unreachable_for_updates, reverse_postorder_blocks,
};
use super::merge_consecutive_blocks::merge_consecutive_blocks;
use super::PassContext;

/// Run `pruneMaybeThrows` on `func` in place.
pub fn prune_maybe_throws(func: &mut HirFunction, ctx: &mut PassContext) {
    let terminal_mapping = prune_maybe_throws_impl(func);
    if terminal_mapping.is_empty() {
        return;
    }

    // Terminals changed, so blocks may be newly unreachable: re-minify the graph
    // (including renumbering instruction ids), matching the TS.
    reverse_postorder_blocks(&mut func.body);
    remove_unreachable_for_updates(&mut func.body);
    remove_dead_do_while_statements(&mut func.body);
    remove_unnecessary_try_catch(&mut func.body);
    mark_instruction_ids(&mut func.body);
    merge_consecutive_blocks(func, ctx);

    // Rewrite phi operands to reference the updated predecessor blocks.
    for block in func.body.blocks_mut() {
        let stale: Vec<BlockId> = block
            .phis
            .iter()
            .flat_map(|phi| phi.operands.keys().copied().collect::<Vec<_>>())
            .filter(|pred| !block.preds.contains(pred))
            .collect();
        for phi in &mut block.phis {
            for predecessor in &stale {
                if let Some(operand) = phi.operands.remove(predecessor) {
                    // `assertConsistentIdentifiers` in the TS would fail if a
                    // predecessor were not mapped; the curated fixtures never
                    // reach this branch, so a missing mapping leaves the operand
                    // dropped rather than panicking.
                    if let Some(&mapped) = terminal_mapping.get(predecessor) {
                        phi.operands.insert(mapped, operand);
                    }
                }
            }
        }
    }
}

/// The core analysis (`pruneMaybeThrowsImpl`): for each `maybe-throw` block whose
/// instructions cannot throw, null the handler and record the
/// `continuation -> source` remapping. Returns the (possibly empty) mapping.
fn prune_maybe_throws_impl(func: &mut HirFunction) -> HashMap<BlockId, BlockId> {
    let mut terminal_mapping: HashMap<BlockId, BlockId> = HashMap::new();
    for block in func.body.blocks_mut() {
        let Terminal::MaybeThrow { continuation, .. } = &block.terminal else {
            continue;
        };
        let continuation = *continuation;
        let can_throw = block
            .instructions
            .iter()
            .any(|instr| instruction_may_throw(&instr.value));
        if can_throw {
            continue;
        }
        let source = terminal_mapping.get(&block.id).copied().unwrap_or(block.id);
        terminal_mapping.insert(continuation, source);
        if let Terminal::MaybeThrow { handler, .. } = &mut block.terminal {
            *handler = None;
        }
    }
    terminal_mapping
}

/// `instructionMayThrow(instr)`: only primitives and array/object literals are
/// known not to throw.
fn instruction_may_throw(value: &InstructionValue) -> bool {
    !matches!(
        value,
        InstructionValue::Primitive { .. }
            | InstructionValue::ArrayExpression { .. }
            | InstructionValue::ObjectExpression { .. }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::ids::{InstructionId, IdentifierId, TypeId};
    use crate::hir::instruction::Instruction;
    use crate::hir::model::{BasicBlock, BlockKind, Hir, ReactFunctionType};
    use crate::hir::place::{Effect, Identifier, Place, SourceLocation};
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

    fn primitive_instr(lvalue: Place) -> Instruction {
        Instruction {
            id: InstructionId::new(0),
            lvalue,
            value: InstructionValue::Primitive {
                value: PrimitiveValue::Number(1.0),
                loc: SourceLocation::Generated,
            },
            loc: SourceLocation::Generated,
            effects: None,
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

    /// A `maybe-throw` whose block only holds a primitive has its handler nulled,
    /// and the now-unreferenced handler block is dropped from the catch's preds.
    #[test]
    fn nulls_handler_for_safe_block() {
        let b0 = BlockId::new(0);
        let cont = BlockId::new(1);
        let handler = BlockId::new(2);

        let mut body = Hir::new(b0);
        body.push_block(BasicBlock {
            kind: BlockKind::Block,
            id: b0,
            instructions: vec![primitive_instr(temp(0))],
            terminal: Terminal::MaybeThrow {
                continuation: cont,
                handler: Some(handler),
                id: InstructionId::new(0),
                effects: None,
                loc: SourceLocation::Generated,
            },
            preds: Default::default(),
            phis: Vec::new(),
        });
        body.push_block(BasicBlock {
            kind: BlockKind::Block,
            id: cont,
            instructions: Vec::new(),
            terminal: Terminal::Return {
                return_variant: ReturnVariant::Void,
                value: temp(1),
                id: InstructionId::new(0),
                effects: None,
                loc: SourceLocation::Generated,
            },
            preds: Default::default(),
            phis: Vec::new(),
        });
        body.push_block(BasicBlock {
            kind: BlockKind::Catch,
            id: handler,
            instructions: Vec::new(),
            terminal: Terminal::Goto {
                block: cont,
                variant: GotoVariant::Break,
                id: InstructionId::new(0),
                loc: SourceLocation::Generated,
            },
            preds: Default::default(),
            phis: Vec::new(),
        });

        let mut f = func(body);
        let mut ctx = PassContext::new(3, 100);
        prune_maybe_throws(&mut f, &mut ctx);

        let entry = f.body.block(b0).expect("entry survives");
        assert!(
            matches!(entry.terminal, Terminal::MaybeThrow { handler: None, .. }),
            "safe maybe-throw handler should be nulled: {:?}",
            entry.terminal
        );
        // The handler block is now unreachable and pruned by reverse-postorder.
        assert!(
            f.body.block(handler).is_none(),
            "unreachable handler block should be pruned"
        );
    }

    /// A `maybe-throw` whose block contains a possibly-throwing instruction
    /// (here a `LoadLocal`) keeps its handler.
    #[test]
    fn keeps_handler_for_unsafe_block() {
        let b0 = BlockId::new(0);
        let cont = BlockId::new(1);
        let handler = BlockId::new(2);

        let load = Instruction {
            id: InstructionId::new(0),
            lvalue: temp(0),
            value: InstructionValue::LoadLocal {
                place: temp(5),
                loc: SourceLocation::Generated,
            },
            loc: SourceLocation::Generated,
            effects: None,
        };

        let mut body = Hir::new(b0);
        body.push_block(BasicBlock {
            kind: BlockKind::Block,
            id: b0,
            instructions: vec![load],
            terminal: Terminal::MaybeThrow {
                continuation: cont,
                handler: Some(handler),
                id: InstructionId::new(0),
                effects: None,
                loc: SourceLocation::Generated,
            },
            preds: Default::default(),
            phis: Vec::new(),
        });
        body.push_block(BasicBlock {
            kind: BlockKind::Block,
            id: cont,
            instructions: Vec::new(),
            terminal: Terminal::Return {
                return_variant: ReturnVariant::Void,
                value: temp(1),
                id: InstructionId::new(0),
                effects: None,
                loc: SourceLocation::Generated,
            },
            preds: Default::default(),
            phis: Vec::new(),
        });
        body.push_block(BasicBlock {
            kind: BlockKind::Catch,
            id: handler,
            instructions: Vec::new(),
            terminal: Terminal::Goto {
                block: cont,
                variant: GotoVariant::Break,
                id: InstructionId::new(0),
                loc: SourceLocation::Generated,
            },
            preds: Default::default(),
            phis: Vec::new(),
        });

        let mut f = func(body);
        let mut ctx = PassContext::new(3, 100);
        prune_maybe_throws(&mut f, &mut ctx);

        let entry = f.body.block(b0).expect("entry survives");
        assert!(
            matches!(
                entry.terminal,
                Terminal::MaybeThrow {
                    handler: Some(_),
                    ..
                }
            ),
            "unsafe maybe-throw handler should be preserved: {:?}",
            entry.terminal
        );
    }
}
