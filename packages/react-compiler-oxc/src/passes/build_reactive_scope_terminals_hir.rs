//! `buildReactiveScopeTerminalsHIR(fn)` — port of
//! `HIR/BuildReactiveScopeTerminalsHIR.ts`.
//!
//! Given a function whose reactive-scope ranges have been aligned + merged, this
//! rewrites blocks to introduce `scope` terminals (a `ReactiveScopeTerminal`) and
//! their fallthrough blocks: a scope `[s:e]` becomes a `scope` terminal at the
//! instruction with id `s` whose body block holds the scope's instructions and
//! whose fallthrough block holds the rest, closed by a `goto(Break)` to that
//! fallthrough at id `e`.
//!
//! Our scope model is per-identifier (`scope: Option<ScopeId>` + a `mutable_range`
//! mirroring the scope range), so we first materialize a
//! [`ReactiveScope`](crate::hir::terminal::ReactiveScope) per scope id (its range
//! from the merged `mutable_range`s), build the same `StartScope`/`EndScope`
//! rewrite queue, split blocks, repoint phis, restore RPO, mark predecessors,
//! renumber instruction ids, then `fixScopeAndIdentifierRanges` — which sets each
//! terminal scope's range to `[terminal.id : first id of fallthrough]`. Finally we
//! propagate those fixed ranges back onto every member identifier's
//! `mutable_range` (the TS shares one range object; we re-sync explicitly).

use std::collections::HashMap;

use crate::hir::ids::{BlockId, InstructionId, ScopeId};
use crate::hir::model::{BasicBlock, BlockSet, HirFunction, Phi};
use crate::hir::place::{Identifier, MutableRange, Place, SourceLocation, Type};
use crate::hir::terminal::{GotoVariant, ReactiveScope, Terminal};
use crate::hir::value::InstructionValue;

use super::PassContext;
use super::cfg::{
    each_instruction_value_operand, each_terminal_operand, mark_instruction_ids, mark_predecessors,
    reverse_postorder_blocks,
};
use super::reactive_scope_util::write_scope_ranges;

/// The number of post-dominator computations (`buildReverseGraph` calls, each of
/// which advances `env.nextBlockId` by one) that the oracle performs between
/// `ConstantPropagation` and `BuildReactiveScopeTerminalsHIR`. The block ids
/// `BuildReactiveScopeTerminalsHIR` allocates continue from `env.nextBlockId`, so
/// the [`PassContext`] block counter must be pre-advanced by exactly this many to
/// produce matching `bbN` ids.
///
/// The contributing passes (all enabled by the default `client`-mode config) are:
///   - `validateHooksUsage`: `computeUnconditionalBlocks` on the top function (+1);
///   - `validateNoSetStateInRender`: `computeUnconditionalBlocks` on the top
///     function (+1) and, recursively, on every nested `FunctionExpression` /
///     `ObjectMethod` that references a `setState`-typed operand (+1 each);
///   - `inferReactivePlaces`: post-dominators on the top function (+1).
pub fn count_pre_build_postdominator_allocations(func: &HirFunction) -> u32 {
    // validateHooksUsage (top fn) + inferReactivePlaces (top fn).
    let mut count = 2;
    // validateNoSetStateInRender (top fn + setState-referencing nested fns).
    count += count_no_set_state_in_render(func);
    count
}

/// `validateNoSetStateInRenderImpl`'s `computeUnconditionalBlocks` calls: one for
/// `func` plus one for each nested `FunctionExpression`/`ObjectMethod` whose
/// captured operands include a `setState`-typed value (the short-circuit guard
/// before the recursive call).
fn count_no_set_state_in_render(func: &HirFunction) -> u32 {
    let mut count = 1;
    for block in func.body.blocks() {
        for instr in &block.instructions {
            if let InstructionValue::FunctionExpression { lowered_func, .. }
            | InstructionValue::ObjectMethod { lowered_func, .. } = &instr.value
            {
                let references_set_state = each_instruction_value_operand(&instr.value)
                    .iter()
                    .any(|operand| is_set_state_type(&operand.identifier));
                if references_set_state {
                    count += count_no_set_state_in_render(&lowered_func.func);
                }
            }
        }
    }
    count
}

/// `isSetStateType(id)`: a `BuiltInSetState`-shaped function.
fn is_set_state_type(id: &Identifier) -> bool {
    matches!(&id.type_, Type::Function { shape_id: Some(s), .. } if s == "BuiltInSetState")
}

/// A queued terminal rewrite (`TerminalRewriteInfo`).
enum RewriteInfo {
    /// Open a scope: `scope` terminal at `instr_id` with body `block`/fallthrough.
    Start {
        block: BlockId,
        fallthrough: BlockId,
        instr_id: InstructionId,
        scope: ReactiveScope,
    },
    /// Close a scope: `goto(Break)` to `fallthrough` at `instr_id`.
    End {
        instr_id: InstructionId,
        fallthrough: BlockId,
    },
}

impl RewriteInfo {
    fn instr_id(&self) -> InstructionId {
        match self {
            RewriteInfo::Start { instr_id, .. } | RewriteInfo::End { instr_id, .. } => *instr_id,
        }
    }
}

/// `buildReactiveScopeTerminalsHIR(fn)`.
pub fn build_reactive_scope_terminals_hir(func: &mut HirFunction, ctx: &mut PassContext) {
    // Step 1: collect scopes, sort pre-order, build the rewrite queue.
    let scopes = get_scopes(func);
    let mut queued: Vec<RewriteInfo> = Vec::new();
    recursively_traverse_items(scopes, ctx, &mut queued);

    // Step 2: apply rewrites by slicing blocks. `queued` is in pre-order /
    // ascending-instr order; reverse it so we can `pop()` off the end as we walk
    // instructions in ascending order.
    queued.reverse();

    // `(originalBlockId -> finalBlockId)` for phi repointing.
    let mut rewritten_final: HashMap<BlockId, BlockId> = HashMap::new();
    // The new block list (replaces `fn.body.blocks`), in original-block order
    // with each split block's sub-blocks appended in creation order.
    let mut next_blocks: Vec<BasicBlock> = Vec::new();

    let original_blocks: Vec<BasicBlock> = func.body.blocks().to_vec();

    for block in &original_blocks {
        let mut context = RewriteContext {
            next_block_id: block.id,
            rewrites: Vec::new(),
            next_preds: block.preds.clone(),
            instr_slice_idx: 0,
            source_kind: block.kind,
            source_instructions: block.instructions.clone(),
            source_phis: block.phis.clone(),
        };

        // Walk every instruction slot plus the terminal slot, triggering queued
        // rewrites whose instr id is <= the slot's instr id.
        for i in 0..(block.instructions.len() + 1) {
            let instr_id = if i < block.instructions.len() {
                block.instructions[i].id
            } else {
                block.terminal.id()
            };
            while let Some(rewrite) = queued.last() {
                if rewrite.instr_id().as_u32() <= instr_id.as_u32() {
                    let rewrite = queued.pop().expect("non-empty");
                    handle_rewrite(rewrite, i, &mut context);
                } else {
                    break;
                }
            }
        }

        if !context.rewrites.is_empty() {
            // The final tail block reuses the source block's terminal and any
            // trailing instructions.
            let final_block = BasicBlock {
                id: context.next_block_id,
                kind: context.source_kind,
                preds: context.next_preds.clone(),
                terminal: block.terminal.clone(),
                instructions: context.source_instructions[context.instr_slice_idx..].to_vec(),
                phis: Vec::new(),
            };
            let final_id = final_block.id;
            for b in context.rewrites.drain(..) {
                next_blocks.push(b);
            }
            next_blocks.push(final_block);
            rewritten_final.insert(block.id, final_id);
        } else {
            next_blocks.push(block.clone());
        }
    }

    let entry = func.body.entry;
    let mut new_body = crate::hir::model::Hir::new(entry);
    for b in next_blocks {
        new_body.push_block(b);
    }
    func.body = new_body;

    // Step 3: repoint phi operands referencing a rewritten block. The phis live on
    // the surviving same-id block (the first sub-block keeps the source phis).
    let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in &block_ids {
        if let Some(block) = func.body.block_mut(*block_id) {
            for phi in &mut block.phis {
                let remaps: Vec<(BlockId, BlockId)> = phi
                    .operands
                    .keys()
                    .filter_map(|orig| rewritten_final.get(orig).map(|new| (*orig, *new)))
                    .collect();
                for (orig, new) in remaps {
                    if let Some(value) = phi.operands.remove(&orig) {
                        phi.operands.insert(new, value);
                    }
                }
            }
        }
    }

    // Step 4: restore RPO, mark predecessors, renumber instruction ids.
    reverse_postorder_blocks(&mut func.body);
    mark_predecessors(&mut func.body);
    mark_instruction_ids(&mut func.body);

    // Step 5: fix scope + identifier ranges to account for the renumbering.
    fix_scope_and_identifier_ranges(func);
}

/// `getScopes(fn)`: the set of materialized [`ReactiveScope`]s, keyed by id, with
/// `range.start != range.end`. Range comes from the member `mutable_range`s (all
/// equal post-merge); the first occurrence wins.
fn get_scopes(func: &HirFunction) -> Vec<ReactiveScope> {
    // Insertion-ordered (id -> range) to mirror the JS `Set` iteration order.
    let mut order: Vec<ScopeId> = Vec::new();
    let mut ranges: HashMap<ScopeId, MutableRange> = HashMap::new();
    let mut visit = |place: &Place| {
        if let Some(scope) = place.identifier.scope {
            let range = place.identifier.mutable_range;
            if range.start != range.end && !ranges.contains_key(&scope) {
                ranges.insert(scope, range);
                order.push(scope);
            }
        }
    };
    for block in func.body.blocks() {
        for instr in &block.instructions {
            visit(&instr.lvalue);
            for operand in each_instruction_value_operand(&instr.value) {
                visit(operand);
            }
        }
        for operand in each_terminal_operand(&block.terminal) {
            visit(operand);
        }
    }
    order
        .into_iter()
        .map(|id| ReactiveScope::new(id, ranges[&id]))
        .collect()
}

/// `recursivelyTraverseItems`: sort scopes by the pre-order range comparator,
/// then walk them maintaining an active stack, pushing a `StartScope` rewrite on
/// enter and an `EndScope` rewrite on exit. Fallthrough ids are pre-allocated on
/// enter and cached so the matching end uses the same one.
fn recursively_traverse_items(
    mut scopes: Vec<ReactiveScope>,
    ctx: &mut PassContext,
    queued: &mut Vec<RewriteInfo>,
) {
    // `rangePreOrderComparator`: ascending start, ties broken by descending end.
    scopes.sort_by(|a, b| {
        a.range
            .start
            .as_u32()
            .cmp(&b.range.start.as_u32())
            .then_with(|| b.range.end.as_u32().cmp(&a.range.end.as_u32()))
    });

    let mut fallthroughs: HashMap<ScopeId, BlockId> = HashMap::new();
    let mut active: Vec<ReactiveScope> = Vec::new();

    for curr in scopes {
        let curr_range = curr.range;
        // Exit active items disjoint from `curr` (start >= active.end).
        while let Some(parent) = active.last() {
            let parent_range = parent.range;
            let disjoint = curr_range.start.as_u32() >= parent_range.end.as_u32();
            if disjoint {
                let parent = active.pop().expect("non-empty");
                push_end_scope(&parent, &fallthroughs, queued);
            } else {
                break;
            }
        }
        push_start_scope(&curr, ctx, &mut fallthroughs, queued);
        active.push(curr);
    }

    while let Some(curr) = active.pop() {
        push_end_scope(&curr, &fallthroughs, queued);
    }
}

fn push_start_scope(
    scope: &ReactiveScope,
    ctx: &mut PassContext,
    fallthroughs: &mut HashMap<ScopeId, BlockId>,
    queued: &mut Vec<RewriteInfo>,
) {
    let block = ctx.next_block_id();
    let fallthrough = ctx.next_block_id();
    queued.push(RewriteInfo::Start {
        block,
        fallthrough,
        instr_id: scope.range.start,
        scope: scope.clone(),
    });
    fallthroughs.insert(scope.id, fallthrough);
}

fn push_end_scope(
    scope: &ReactiveScope,
    fallthroughs: &HashMap<ScopeId, BlockId>,
    queued: &mut Vec<RewriteInfo>,
) {
    let fallthrough = *fallthroughs
        .get(&scope.id)
        .expect("scope start allocated a fallthrough");
    queued.push(RewriteInfo::End {
        instr_id: scope.range.end,
        fallthrough,
    });
}

/// Per-block rewrite state (`RewriteContext`).
struct RewriteContext {
    next_block_id: BlockId,
    rewrites: Vec<BasicBlock>,
    next_preds: BlockSet,
    instr_slice_idx: usize,
    source_kind: crate::hir::model::BlockKind,
    source_instructions: Vec<crate::hir::instruction::Instruction>,
    source_phis: Vec<Phi>,
}

/// `handleRewrite`: slice `[instr_slice_idx, idx)` off the source into a new block
/// terminated by the rewrite's terminal, advancing the slice index / next ids.
fn handle_rewrite(info: RewriteInfo, idx: usize, context: &mut RewriteContext) {
    let terminal = match &info {
        RewriteInfo::Start {
            block,
            fallthrough,
            instr_id,
            scope,
        } => Terminal::Scope {
            fallthrough: *fallthrough,
            block: *block,
            scope: scope.clone(),
            id: *instr_id,
            loc: SourceLocation::Generated,
        },
        RewriteInfo::End {
            instr_id,
            fallthrough,
        } => Terminal::Goto {
            block: *fallthrough,
            variant: GotoVariant::Break,
            id: *instr_id,
            loc: SourceLocation::Generated,
        },
    };

    let curr_block_id = context.next_block_id;
    let phis = if context.rewrites.is_empty() {
        std::mem::take(&mut context.source_phis)
    } else {
        Vec::new()
    };
    context.rewrites.push(BasicBlock {
        kind: context.source_kind,
        id: curr_block_id,
        instructions: context.source_instructions[context.instr_slice_idx..idx].to_vec(),
        preds: context.next_preds.clone(),
        phis,
        terminal,
    });
    let mut next_preds = BlockSet::new();
    next_preds.insert(curr_block_id);
    context.next_preds = next_preds;
    context.next_block_id = match &info {
        RewriteInfo::Start { block, .. } => *block,
        RewriteInfo::End { fallthrough, .. } => *fallthrough,
    };
    context.instr_slice_idx = idx;
}

/// `fixScopeAndIdentifierRanges(fn.body)`: align each scope terminal's range to
/// `[terminal.id : first id of fallthrough]`, then re-sync the member identifiers'
/// printed ranges (which the TS gets for free via the shared range object).
fn fix_scope_and_identifier_ranges(func: &mut HirFunction) {
    // Collect each scope terminal's new range from the current block layout.
    let mut new_ranges: HashMap<ScopeId, MutableRange> = HashMap::new();
    let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in &block_ids {
        let (scope_id, terminal_id, fallthrough_id) = {
            let block = func.body.block(*block_id).expect("block");
            match &block.terminal {
                Terminal::Scope {
                    scope,
                    fallthrough,
                    id,
                    ..
                }
                | Terminal::PrunedScope {
                    scope,
                    fallthrough,
                    id,
                    ..
                } => (scope.id, *id, *fallthrough),
                _ => continue,
            }
        };
        let first_id = {
            let fallthrough = func.body.block(fallthrough_id).expect("fallthrough");
            fallthrough
                .instructions
                .first()
                .map(|i| i.id)
                .unwrap_or_else(|| fallthrough.terminal.id())
        };
        let range = MutableRange {
            start: terminal_id,
            end: first_id,
        };
        new_ranges.insert(scope_id, range);
        // Update the terminal's own scope object.
        if let Some(scope) = func.body.block_mut(*block_id).unwrap().terminal.scope_mut() {
            scope.range = range;
        }
    }

    // Re-sync every member identifier's `mutable_range` to its scope's new range.
    // `write_scope_ranges` keys by `range_scope`, so a scope-cleared method
    // property (carrying only `range_scope`) follows its former scope's range too.
    // We also recurse into nested function bodies: a context variable assigned a
    // top-level scope (e.g. `a$1_@0` captured by a closure) is one shared object in
    // the TS, so its nested-body references follow the same fixed range.
    write_scope_ranges(func, &new_ranges);
    let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        let block = func.body.block_mut(block_id).expect("block exists");
        for instr in &mut block.instructions {
            if let InstructionValue::FunctionExpression { lowered_func, .. }
            | InstructionValue::ObjectMethod { lowered_func, .. } = &mut instr.value
            {
                write_scope_ranges_recursive(&mut lowered_func.func, &new_ranges);
            }
        }
    }
}

/// Apply `ranges` (keyed by `range_scope`) to every place in `func` and, in turn,
/// every nested function body. Mirrors the shared-range-object aliasing the TS
/// gets for free for context variables captured by closures.
fn write_scope_ranges_recursive(func: &mut HirFunction, ranges: &HashMap<ScopeId, MutableRange>) {
    write_scope_ranges(func, ranges);
    let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        let block = func.body.block_mut(block_id).expect("block exists");
        for instr in &mut block.instructions {
            if let InstructionValue::FunctionExpression { lowered_func, .. }
            | InstructionValue::ObjectMethod { lowered_func, .. } = &mut instr.value
            {
                write_scope_ranges_recursive(&mut lowered_func.func, ranges);
            }
        }
    }
}
