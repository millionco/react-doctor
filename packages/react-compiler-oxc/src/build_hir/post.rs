//! Post-lowering CFG passes run by `HIRBuilder.build()`
//! (`HIRBuilder.ts`): reverse-postorder reordering, pruning of
//! unreachable for-updates / dead do-while / unnecessary try-catch, instruction
//! numbering, and predecessor marking. Ported faithfully so the printed block
//! order and `[id]` instruction numbers match the parity oracle.

use std::collections::{BTreeMap, BTreeSet};

use crate::hir::ids::{BlockId, InstructionId};
use crate::hir::model::{BasicBlock, Hir};
use crate::hir::place::SourceLocation;
use crate::hir::terminal::{GotoVariant, Terminal};
use crate::hir::value::InstructionValue;

/// `HIRBuilder.build()`: build the final [`Hir`] from the `completed` block map,
/// in reverse-postorder, with the cleanup passes applied. Also returns the
/// recoverable error `HIRBuilder.build()` records for a function with unreachable
/// code that may contain hoisted declarations (see
/// [`unreachable_hoisted_function_loc`]); the caller surfaces it as a
/// per-function bailout (`recordError` in the TS), leaving the source untouched.
pub fn build_hir(
    entry: BlockId,
    blocks: BTreeMap<BlockId, BasicBlock>,
) -> (Hir, Option<SourceLocation>) {
    let ordered = reverse_postordered_blocks(entry, &blocks);
    // `HIRBuilder.build()` checks for unreachable blocks (those dropped by the
    // reverse-postorder pruning) that contain a `FunctionExpression` instruction —
    // a hoisted function declaration in unreachable code — and records a Todo
    // error. We compute the same condition against the *pre-pruned* `blocks` map
    // and the kept (RPO) block ids before discarding the unreachable blocks.
    let hoisting_error = unreachable_hoisted_function_loc(&blocks, &ordered);
    let mut ir = into_hir(entry, ordered);
    remove_unreachable_for_updates(&mut ir);
    remove_dead_do_while_statements(&mut ir);
    remove_unnecessary_try_catch(&mut ir);
    mark_instruction_ids(&mut ir);
    mark_predecessors(&mut ir);
    (ir, hoisting_error)
}

/// `HIRBuilder.build()` lines 379-396: for every completed block that was pruned
/// by the reverse-postorder traversal (i.e. is unreachable) and that contains a
/// `FunctionExpression` instruction (a hoisted function declaration), the compiler
/// records the recoverable Todo `Support functions with unreachable code that may
/// contain hoisted declarations`. Returns the location to attach the error to (the
/// first such block's first instruction, else its terminal), or `None` if there is
/// no such block.
///
/// `ordered` is the kept (reachable + used-fallthrough) block set; a block is
/// considered unreachable exactly when it is absent from `ordered` — mirroring the
/// TS `!rpoBlocks.has(id)` check (used-fallthrough blocks are present in `rpoBlocks`
/// as empty `unreachable` blocks, so they never trip this).
fn unreachable_hoisted_function_loc(
    blocks: &BTreeMap<BlockId, BasicBlock>,
    ordered: &[BasicBlock],
) -> Option<SourceLocation> {
    let kept: BTreeSet<BlockId> = ordered.iter().map(|b| b.id).collect();
    for (id, block) in blocks {
        if kept.contains(id) {
            continue;
        }
        if block
            .instructions
            .iter()
            .any(|instr| matches!(instr.value, InstructionValue::FunctionExpression { .. }))
        {
            return Some(
                block
                    .instructions
                    .first()
                    .map(|instr| instr.loc.clone())
                    .unwrap_or_else(|| block.terminal.loc()),
            );
        }
    }
    None
}

/// The standard control-flow successors of a terminal, in order
/// (`eachTerminalSuccessor`). Fallthroughs are *not* included.
pub fn each_terminal_successor(terminal: &Terminal) -> Vec<BlockId> {
    match terminal {
        Terminal::Goto { block, .. } => vec![*block],
        Terminal::If {
            consequent,
            alternate,
            ..
        }
        | Terminal::Branch {
            consequent,
            alternate,
            ..
        } => vec![*consequent, *alternate],
        Terminal::Switch { cases, .. } => cases.iter().map(|c| c.block).collect(),
        Terminal::Optional { test, .. }
        | Terminal::Ternary { test, .. }
        | Terminal::Logical { test, .. } => vec![*test],
        Terminal::Return { .. } | Terminal::Throw { .. } => vec![],
        Terminal::DoWhile { loop_block, .. } => vec![*loop_block],
        Terminal::While { test, .. } => vec![*test],
        Terminal::For { init, .. } => vec![*init],
        Terminal::ForOf { init, .. } => vec![*init],
        Terminal::ForIn { init, .. } => vec![*init],
        Terminal::Label { block, .. } => vec![*block],
        Terminal::Sequence { block, .. } => vec![*block],
        Terminal::MaybeThrow {
            continuation,
            handler,
            ..
        } => match handler {
            Some(handler) => vec![*continuation, *handler],
            None => vec![*continuation],
        },
        Terminal::Try { block, .. } => vec![*block],
        Terminal::Scope { block, .. } | Terminal::PrunedScope { block, .. } => vec![*block],
        Terminal::Unreachable { .. } | Terminal::Unsupported { .. } => vec![],
    }
}

/// Remap a terminal's successor block ids in place (`mapTerminalSuccessors`).
///
/// Currently only used by the disabled `_shrink` pass (also disabled in the TS),
/// retained for the later stages that will need terminal remapping.
#[allow(dead_code)]
pub(crate) fn map_terminal_successors(terminal: &mut Terminal, mut f: impl FnMut(BlockId) -> BlockId) {
    match terminal {
        Terminal::Goto { block, .. } => *block = f(*block),
        Terminal::If {
            consequent,
            alternate,
            fallthrough,
            ..
        }
        | Terminal::Branch {
            consequent,
            alternate,
            fallthrough,
            ..
        } => {
            *consequent = f(*consequent);
            *alternate = f(*alternate);
            *fallthrough = f(*fallthrough);
        }
        Terminal::Switch {
            cases, fallthrough, ..
        } => {
            for case in cases.iter_mut() {
                case.block = f(case.block);
            }
            *fallthrough = f(*fallthrough);
        }
        Terminal::Logical {
            test, fallthrough, ..
        }
        | Terminal::Ternary {
            test, fallthrough, ..
        }
        | Terminal::Optional {
            test, fallthrough, ..
        } => {
            *test = f(*test);
            *fallthrough = f(*fallthrough);
        }
        Terminal::DoWhile {
            loop_block,
            test,
            fallthrough,
            ..
        } => {
            *loop_block = f(*loop_block);
            *test = f(*test);
            *fallthrough = f(*fallthrough);
        }
        Terminal::While {
            test,
            loop_block,
            fallthrough,
            ..
        } => {
            *test = f(*test);
            *loop_block = f(*loop_block);
            *fallthrough = f(*fallthrough);
        }
        Terminal::For {
            init,
            test,
            update,
            loop_block,
            fallthrough,
            ..
        } => {
            *init = f(*init);
            *test = f(*test);
            if let Some(update) = update {
                *update = f(*update);
            }
            *loop_block = f(*loop_block);
            *fallthrough = f(*fallthrough);
        }
        Terminal::ForOf {
            init,
            test,
            loop_block,
            fallthrough,
            ..
        } => {
            *init = f(*init);
            *test = f(*test);
            *loop_block = f(*loop_block);
            *fallthrough = f(*fallthrough);
        }
        Terminal::ForIn {
            init,
            loop_block,
            fallthrough,
            ..
        } => {
            *init = f(*init);
            *loop_block = f(*loop_block);
            *fallthrough = f(*fallthrough);
        }
        Terminal::Label {
            block, fallthrough, ..
        }
        | Terminal::Sequence {
            block, fallthrough, ..
        } => {
            *block = f(*block);
            *fallthrough = f(*fallthrough);
        }
        Terminal::Try {
            block,
            handler,
            fallthrough,
            ..
        } => {
            *block = f(*block);
            *handler = f(*handler);
            *fallthrough = f(*fallthrough);
        }
        Terminal::MaybeThrow {
            continuation,
            handler,
            ..
        } => {
            *continuation = f(*continuation);
            if let Some(handler) = handler {
                *handler = f(*handler);
            }
        }
        Terminal::Scope {
            block, fallthrough, ..
        }
        | Terminal::PrunedScope {
            block, fallthrough, ..
        } => {
            *block = f(*block);
            *fallthrough = f(*fallthrough);
        }
        Terminal::Return { .. }
        | Terminal::Throw { .. }
        | Terminal::Unreachable { .. }
        | Terminal::Unsupported { .. } => {}
    }
}

/// `getReversePostorderedBlocks`: returns the block ids in reverse-postorder,
/// pruning unreachable blocks (but retaining used-fallthrough blocks as empty
/// `unreachable` blocks).
fn reverse_postordered_blocks(
    entry: BlockId,
    blocks: &BTreeMap<BlockId, BasicBlock>,
) -> Vec<BasicBlock> {
    let mut visited: BTreeSet<BlockId> = BTreeSet::new();
    let mut used: BTreeSet<BlockId> = BTreeSet::new();
    let mut used_fallthroughs: BTreeSet<BlockId> = BTreeSet::new();
    let mut postorder: Vec<BlockId> = Vec::new();

    // Iterative DFS replicating the recursive TS `visit(blockId, isUsed)`.
    enum Step {
        Enter(BlockId, bool),
        Post(BlockId),
    }
    let mut stack = vec![Step::Enter(entry, true)];
    while let Some(step) = stack.pop() {
        match step {
            Step::Post(block_id) => postorder.push(block_id),
            Step::Enter(block_id, is_used) => {
                let was_used = used.contains(&block_id);
                let was_visited = visited.contains(&block_id);
                visited.insert(block_id);
                if is_used {
                    used.insert(block_id);
                }
                if was_visited && (was_used || !is_used) {
                    continue;
                }

                let block = blocks
                    .get(&block_id)
                    .expect("[HIRBuilder] Unexpected null block");
                let successors = each_terminal_successor(&block.terminal);
                let fallthrough = block.terminal.fallthrough();

                // Push the post-order marker first (only on first visit) so it
                // pops after all children, mirroring `if (!wasVisited) push`.
                if !was_visited {
                    stack.push(Step::Post(block_id));
                }

                // The TS visits successors in reverse so the final reversal
                // restores program order. Visiting fallthrough first means it
                // must be pushed last here (LIFO), so successors are pushed
                // first (in forward order), then the fallthrough.
                for &successor in successors.iter() {
                    stack.push(Step::Enter(successor, is_used));
                }
                if let Some(fallthrough) = fallthrough {
                    if is_used {
                        used_fallthroughs.insert(fallthrough);
                    }
                    stack.push(Step::Enter(fallthrough, false));
                }
            }
        }
    }

    postorder.reverse();
    let mut result = Vec::new();
    for block_id in postorder {
        let block = blocks.get(&block_id).expect("block exists");
        if used.contains(&block_id) {
            result.push(block.clone());
        } else if used_fallthroughs.contains(&block_id) {
            result.push(BasicBlock {
                kind: block.kind,
                id: block.id,
                instructions: Vec::new(),
                terminal: Terminal::Unreachable {
                    id: block.terminal.id(),
                    loc: block.terminal.loc(),
                },
                preds: Default::default(),
                phis: Vec::new(),
            });
        }
        // otherwise this block is unreachable, drop it
    }
    result
}

/// Build an [`Hir`] from blocks already in iteration order.
fn into_hir(entry: BlockId, blocks: Vec<BasicBlock>) -> Hir {
    let mut ir = Hir::new(entry);
    for block in blocks {
        ir.push_block(block);
    }
    ir
}

/// `reversePostorderBlocks(fn.body)`: reorder the blocks of `ir` into
/// reverse-postorder in place, pruning unreachable blocks (used-fallthrough
/// blocks are retained as empty `unreachable` blocks). Used by the post-lowering
/// optimization passes, which re-run minification after rewriting terminals.
pub fn reverse_postorder_blocks(ir: &mut Hir) {
    let entry = ir.entry;
    let blocks: BTreeMap<BlockId, BasicBlock> =
        ir.blocks().iter().map(|b| (b.id, b.clone())).collect();
    let ordered = reverse_postordered_blocks(entry, &blocks);
    ir.set_blocks(ordered);
}

/// `removeUnreachableForUpdates`: clear the `update` of a `for` terminal whose
/// update block was pruned.
pub fn remove_unreachable_for_updates(ir: &mut Hir) {
    let present: BTreeSet<BlockId> = ir.blocks().iter().map(|b| b.id).collect();
    for block in ir.blocks_mut() {
        if let Terminal::For { update, .. } = &mut block.terminal {
            if let Some(update_id) = update {
                if !present.contains(update_id) {
                    *update = None;
                }
            }
        }
    }
}

/// `removeDeadDoWhileStatements`: replace a `do-while` whose test block is
/// unreachable with a `goto` to the loop body.
pub fn remove_dead_do_while_statements(ir: &mut Hir) {
    let present: BTreeSet<BlockId> = ir.blocks().iter().map(|b| b.id).collect();
    for block in ir.blocks_mut() {
        if let Terminal::DoWhile {
            loop_block,
            test,
            id,
            loc,
            ..
        } = &block.terminal
        {
            if !present.contains(test) {
                block.terminal = Terminal::Goto {
                    block: *loop_block,
                    variant: GotoVariant::Break,
                    id: *id,
                    loc: loc.clone(),
                };
            }
        }
    }
}

/// `removeUnnecessaryTryCatch`: convert a `try` whose handler block is
/// unreachable into a plain `goto`, dropping or trimming the fallthrough.
pub fn remove_unnecessary_try_catch(ir: &mut Hir) {
    let present: BTreeSet<BlockId> = ir.blocks().iter().map(|b| b.id).collect();
    let mut deletes: Vec<BlockId> = Vec::new();
    let mut pred_removals: Vec<(BlockId, BlockId)> = Vec::new();

    for block in ir.blocks_mut() {
        if let Terminal::Try {
            block: try_block,
            handler,
            fallthrough,
            id,
            loc,
            ..
        } = &block.terminal
        {
            if !present.contains(handler) {
                let handler_id = *handler;
                let fallthrough_id = *fallthrough;
                let new_terminal = Terminal::Goto {
                    block: *try_block,
                    variant: GotoVariant::Break,
                    id: *id,
                    loc: loc.clone(),
                };
                block.terminal = new_terminal;
                pred_removals.push((fallthrough_id, handler_id));
            }
        }
    }

    for (fallthrough_id, handler_id) in pred_removals {
        if let Some(fallthrough) = ir.block_mut(fallthrough_id) {
            if fallthrough.preds.len() == 1 && fallthrough.preds.contains(&handler_id) {
                deletes.push(fallthrough_id);
            } else {
                fallthrough.preds.remove(&handler_id);
            }
        }
    }

    if !deletes.is_empty() {
        let keep: Vec<BasicBlock> = ir
            .blocks()
            .iter()
            .filter(|b| !deletes.contains(&b.id))
            .cloned()
            .collect();
        let entry = ir.entry;
        *ir = into_hir(entry, keep);
    }
}

/// `markInstructionIds`: number every instruction and terminal sequentially
/// starting at `1`, in block iteration order.
pub fn mark_instruction_ids(ir: &mut Hir) {
    let mut id = 0u32;
    for block in ir.blocks_mut() {
        for instr in block.instructions.iter_mut() {
            id += 1;
            instr.id = InstructionId::new(id);
        }
        id += 1;
        set_terminal_id(&mut block.terminal, InstructionId::new(id));
    }
}

/// `markPredecessors`: recompute each block's predecessor set from the CFG
/// successors, starting from `entry`.
pub fn mark_predecessors(ir: &mut Hir) {
    for block in ir.blocks_mut() {
        block.preds.clear();
    }

    let mut visited: BTreeSet<BlockId> = BTreeSet::new();
    // (block to visit, predecessor that pointed at it)
    let mut stack: Vec<(BlockId, Option<BlockId>)> = vec![(ir.entry, None)];
    while let Some((block_id, prev)) = stack.pop() {
        let successors = {
            let Some(block) = ir.block_mut(block_id) else {
                continue;
            };
            if let Some(prev) = prev {
                block.preds.insert(prev);
            }
            if visited.contains(&block_id) {
                continue;
            }
            visited.insert(block_id);
            each_terminal_successor(&block.terminal)
        };
        for successor in successors.into_iter().rev() {
            stack.push((successor, Some(block_id)));
        }
    }
}

fn set_terminal_id(terminal: &mut Terminal, new_id: InstructionId) {
    match terminal {
        Terminal::Unsupported { id, .. }
        | Terminal::Unreachable { id, .. }
        | Terminal::Throw { id, .. }
        | Terminal::Return { id, .. }
        | Terminal::Goto { id, .. }
        | Terminal::If { id, .. }
        | Terminal::Branch { id, .. }
        | Terminal::Switch { id, .. }
        | Terminal::DoWhile { id, .. }
        | Terminal::While { id, .. }
        | Terminal::For { id, .. }
        | Terminal::ForOf { id, .. }
        | Terminal::ForIn { id, .. }
        | Terminal::Logical { id, .. }
        | Terminal::Ternary { id, .. }
        | Terminal::Optional { id, .. }
        | Terminal::Label { id, .. }
        | Terminal::Sequence { id, .. }
        | Terminal::Try { id, .. }
        | Terminal::MaybeThrow { id, .. }
        | Terminal::Scope { id, .. }
        | Terminal::PrunedScope { id, .. } => *id = new_id,
    }
}

/// The source location of any terminal (for synthesizing `unreachable`).
trait TerminalLoc {
    fn loc(&self) -> crate::hir::place::SourceLocation;
}

impl TerminalLoc for Terminal {
    fn loc(&self) -> crate::hir::place::SourceLocation {
        match self {
            Terminal::Unsupported { loc, .. }
            | Terminal::Unreachable { loc, .. }
            | Terminal::Throw { loc, .. }
            | Terminal::Return { loc, .. }
            | Terminal::Goto { loc, .. }
            | Terminal::If { loc, .. }
            | Terminal::Branch { loc, .. }
            | Terminal::Switch { loc, .. }
            | Terminal::DoWhile { loc, .. }
            | Terminal::While { loc, .. }
            | Terminal::For { loc, .. }
            | Terminal::ForOf { loc, .. }
            | Terminal::ForIn { loc, .. }
            | Terminal::Logical { loc, .. }
            | Terminal::Ternary { loc, .. }
            | Terminal::Optional { loc, .. }
            | Terminal::Label { loc, .. }
            | Terminal::Sequence { loc, .. }
            | Terminal::Try { loc, .. }
            | Terminal::MaybeThrow { loc, .. }
            | Terminal::Scope { loc, .. }
            | Terminal::PrunedScope { loc, .. } => loc.clone(),
        }
    }
}

