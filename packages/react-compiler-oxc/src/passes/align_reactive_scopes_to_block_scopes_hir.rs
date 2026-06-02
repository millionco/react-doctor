//! `alignReactiveScopesToBlockScopesHIR(fn)` — port of
//! `ReactiveScopes/AlignReactiveScopesToBlockScopesHIR.ts`.
//!
//! Reactive scopes assigned by `inferReactiveScopeVariables` end at arbitrary
//! instructions in the CFG. To codegen a memo block around each scope, the scope
//! must align to control-flow boundaries (you can't memoize half a loop). This
//! pass walks the blocks in definition order, tracking which scopes are active
//! and the block-fallthrough ranges, and extends each scope's `range` backward to
//! its block-scope start and forward to its block-scope end.
//!
//! ## Scope/range model
//!
//! As elsewhere, our `Identifier` holds `scope: Option<ScopeId>` plus a per-place
//! `mutable_range` kept equal to the shared scope range. The TS mutates the shared
//! `scope.range`; we maintain a `ScopeId -> range` side-table (seeded from the
//! current body via [`collect_scope_ranges`]), run the algorithm against it, then
//! write the final ranges back onto every scope member ([`write_scope_ranges`]).
//!
//! ## ValueBlockNode
//!
//! The TS builds a `ValueBlockNode` tree, but the only field ever *read* during
//! the alignment is `valueRange` (the `children` array is consumed only by the
//! unused `_debug`). We therefore model a node as just its `valueRange`, keyed by
//! the block it governs.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::{BlockId, InstructionId, ScopeId};
use crate::hir::model::{BlockKind, HirFunction};
use crate::hir::place::{MutableRange, Place};
use crate::hir::terminal::Terminal;

use super::cfg::{
    each_instruction_value_lvalue, each_instruction_value_operand, each_terminal_operand,
    terminal_fallthrough,
};
use super::reactive_scope_util::{collect_scope_ranges, write_scope_ranges};

/// A `ValueBlockNode`, reduced to the only field the alignment reads.
#[derive(Clone, Copy)]
struct ValueBlockNode {
    value_range: MutableRange,
}

struct FallthroughRange {
    range: MutableRange,
    fallthrough: BlockId,
}

/// `alignReactiveScopesToBlockScopesHIR(fn)`.
///
/// This pass does **not** recurse into nested functions: a nested function only
/// runs the reactive-scope pipeline up to `inferReactiveScopeVariables` (inside
/// `analyseFunctions`), so its scope ranges are intentionally left un-aligned.
pub fn align_reactive_scopes_to_block_scopes_hir(func: &mut HirFunction) {
    let mut scope_ranges = collect_scope_ranges(func);

    let mut active_block_fallthrough_ranges: Vec<FallthroughRange> = Vec::new();
    // Insertion-ordered active-scope set (order is irrelevant for the min/max
    // mutations, but we keep it stable for determinism).
    let mut active_scopes: Vec<ScopeId> = Vec::new();
    let mut seen: HashSet<ScopeId> = HashSet::new();
    let mut value_block_nodes: HashMap<BlockId, ValueBlockNode> = HashMap::new();

    let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();

    for block_id in block_ids {
        let block = func.body.block(block_id).expect("block exists");
        let starting_id = block
            .instructions
            .first()
            .map(|i| i.id)
            .unwrap_or_else(|| block.terminal.id());

        // Prune scopes that have ended (`scope.range.end > startingId`).
        active_scopes.retain(|scope| {
            scope_ranges
                .get(scope)
                .map(|r| r.end.as_u32() > starting_id.as_u32())
                .unwrap_or(false)
        });

        // Entering a block-fallthrough range: extend active scopes' starts back.
        if active_block_fallthrough_ranges
            .last()
            .map(|t| t.fallthrough == block_id)
            .unwrap_or(false)
        {
            let top = active_block_fallthrough_ranges.pop().expect("non-empty");
            for scope in &active_scopes {
                if let Some(range) = scope_ranges.get_mut(scope) {
                    range.start = InstructionId::new(
                        range.start.as_u32().min(top.range.start.as_u32()),
                    );
                }
            }
        }

        let node = value_block_nodes.get(&block_id).copied();

        // Record every lvalue / operand / terminal operand place.
        // Snapshot (id, scope) pairs to avoid borrow conflicts with scope_ranges.
        let mut records: Vec<(InstructionId, ScopeId)> = Vec::new();
        {
            let block = func.body.block(block_id).expect("block exists");
            for instr in &block.instructions {
                // `eachInstructionLValue`: the instruction's own lvalue, then the
                // value's lvalues (e.g. the `StoreLocal`/`DeclareLocal` stored-to
                // place — which is where a scope-carrying local like `x_@1` lives).
                collect_record(instr.id, &instr.lvalue, &mut records);
                for lvalue in each_instruction_value_lvalue(&instr.value) {
                    collect_record(instr.id, lvalue, &mut records);
                }
                for operand in each_instruction_value_operand(&instr.value) {
                    collect_record(instr.id, operand, &mut records);
                }
            }
            let terminal_id = block.terminal.id();
            for operand in each_terminal_operand(&block.terminal) {
                collect_record(terminal_id, operand, &mut records);
            }
        }
        for (id, scope) in records {
            record_place(
                id,
                scope,
                node.as_ref(),
                &mut scope_ranges,
                &mut active_scopes,
                &mut seen,
            );
        }

        // Terminal fallthrough / goto handling.
        let block = func.body.block(block_id).expect("block exists");
        let terminal = &block.terminal;
        let terminal_id = terminal.id();
        let fallthrough = terminal_fallthrough(terminal);
        let is_branch = matches!(terminal, Terminal::Branch { .. });
        let is_goto = matches!(terminal, Terminal::Goto { .. });
        let goto_target = if let Terminal::Goto { block, .. } = terminal {
            Some(*block)
        } else {
            None
        };

        if let (Some(fallthrough), false) = (fallthrough, is_branch) {
            let next_id = first_id_of(func, fallthrough);
            for scope in &active_scopes {
                if let Some(range) = scope_ranges.get_mut(scope) {
                    if range.end.as_u32() > terminal_id.as_u32() {
                        range.end = InstructionId::new(
                            range.end.as_u32().max(next_id.as_u32()),
                        );
                    }
                }
            }
            active_block_fallthrough_ranges.push(FallthroughRange {
                fallthrough,
                range: MutableRange {
                    start: terminal_id,
                    end: next_id,
                },
            });
            // `Expect hir blocks to have unique fallthroughs` — node propagation.
            if let Some(node) = node {
                value_block_nodes.insert(fallthrough, node);
            }
        } else if is_goto {
            let goto_target = goto_target.expect("goto has a target");
            // Find the fallthrough-range entry targeting the goto's block, that is
            // not the topmost entry.
            let found_idx = active_block_fallthrough_ranges
                .iter()
                .position(|r| r.fallthrough == goto_target);
            let is_topmost = found_idx
                .map(|idx| idx + 1 == active_block_fallthrough_ranges.len())
                .unwrap_or(false);
            if let Some(idx) = found_idx {
                if !is_topmost {
                    let start_range = active_block_fallthrough_ranges[idx].range;
                    let first_id = first_id_of(func, active_block_fallthrough_ranges[idx].fallthrough);
                    for scope in &active_scopes {
                        if let Some(range) = scope_ranges.get_mut(scope) {
                            if range.end.as_u32() <= terminal_id.as_u32() {
                                continue;
                            }
                            range.start = InstructionId::new(
                                start_range.start.as_u32().min(range.start.as_u32()),
                            );
                            range.end = InstructionId::new(
                                first_id.as_u32().max(range.end.as_u32()),
                            );
                        }
                    }
                }
            }
        }

        // Visit all successors (mapTerminalSuccessors order, including fallthrough)
        // to set value-block nodes where needed.
        let block = func.body.block(block_id).expect("block exists");
        let terminal = &block.terminal;
        let is_value_terminal = matches!(
            terminal,
            Terminal::Ternary { .. } | Terminal::Logical { .. } | Terminal::Optional { .. }
        );
        let successors = successors_in_map_order(terminal);
        for successor in successors {
            if value_block_nodes.contains_key(&successor) {
                continue;
            }
            let successor_kind = func
                .body
                .block(successor)
                .map(|b| b.kind)
                .expect("successor exists");
            if successor_kind == BlockKind::Block || successor_kind == BlockKind::Catch {
                // do..while / try successors are statement blocks: no node.
            } else if node.is_none() || is_value_terminal {
                // Transition into a (new) value block.
                let value_range = match node {
                    // block -> value block: derive the outer block range.
                    None => {
                        let fallthrough = fallthrough.expect("value block has a fallthrough");
                        let next_id = first_id_of(func, fallthrough);
                        MutableRange {
                            start: terminal_id,
                            end: next_id,
                        }
                    }
                    // value -> value via a ternary/logical/optional: reuse the range.
                    Some(node) => node.value_range,
                };
                value_block_nodes.insert(successor, ValueBlockNode { value_range });
            } else if let Some(node) = node {
                // value -> value transition: reuse the node.
                value_block_nodes.insert(successor, node);
            }
        }
    }

    write_scope_ranges(func, &scope_ranges);
}

/// `recordPlace`: mark a place's scope active and, the first time a scope is
/// seen inside a value block, extend its range to cover the node's value range.
fn record_place(
    id: InstructionId,
    scope: ScopeId,
    node: Option<&ValueBlockNode>,
    scope_ranges: &mut HashMap<ScopeId, MutableRange>,
    active_scopes: &mut Vec<ScopeId>,
    seen: &mut HashSet<ScopeId>,
) {
    // `getPlaceScope(id, place)`: only active when `start <= id < end` (current
    // side-table range).
    let active = scope_ranges
        .get(&scope)
        .map(|r| id.as_u32() >= r.start.as_u32() && id.as_u32() < r.end.as_u32())
        .unwrap_or(false);
    if !active {
        return;
    }
    if !active_scopes.contains(&scope) {
        active_scopes.push(scope);
    }
    if seen.contains(&scope) {
        return;
    }
    seen.insert(scope);
    if let Some(node) = node {
        if let Some(range) = scope_ranges.get_mut(&scope) {
            range.start = InstructionId::new(
                node.value_range.start.as_u32().min(range.start.as_u32()),
            );
            range.end =
                InstructionId::new(node.value_range.end.as_u32().max(range.end.as_u32()));
        }
    }
}

/// Snapshot a place's `(instruction id, scope id)` for the record pass, if it has
/// a scope. (The active check happens later against the live side-table.)
fn collect_record(id: InstructionId, place: &Place, out: &mut Vec<(InstructionId, ScopeId)>) {
    if let Some(scope) = place.identifier.scope {
        out.push((id, scope));
    }
}

/// The first instruction id of a block, or its terminal id if it has no
/// instructions (`block.instructions[0]?.id ?? block.terminal.id`).
fn first_id_of(func: &HirFunction, block_id: BlockId) -> InstructionId {
    let block = func.body.block(block_id).expect("block exists");
    block
        .instructions
        .first()
        .map(|i| i.id)
        .unwrap_or_else(|| block.terminal.id())
}

/// Successors in `mapTerminalSuccessors` visiting order (including the
/// fallthrough), matching the TS `mapTerminalSuccessors` closure-call order.
fn successors_in_map_order(terminal: &Terminal) -> Vec<BlockId> {
    match terminal {
        Terminal::Goto { block, .. } => vec![*block],
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
        } => vec![*consequent, *alternate, *fallthrough],
        Terminal::Switch {
            cases, fallthrough, ..
        } => {
            let mut out: Vec<BlockId> = cases.iter().map(|c| c.block).collect();
            out.push(*fallthrough);
            out
        }
        Terminal::Logical {
            test, fallthrough, ..
        }
        | Terminal::Ternary {
            test, fallthrough, ..
        }
        | Terminal::Optional {
            test, fallthrough, ..
        } => vec![*test, *fallthrough],
        Terminal::DoWhile {
            loop_block,
            test,
            fallthrough,
            ..
        } => vec![*loop_block, *test, *fallthrough],
        Terminal::While {
            test,
            loop_block,
            fallthrough,
            ..
        } => vec![*test, *loop_block, *fallthrough],
        Terminal::For {
            init,
            test,
            update,
            loop_block,
            fallthrough,
            ..
        } => {
            let mut out = vec![*init, *test];
            if let Some(update) = update {
                out.push(*update);
            }
            out.push(*loop_block);
            out.push(*fallthrough);
            out
        }
        Terminal::ForOf {
            init,
            test,
            loop_block,
            fallthrough,
            ..
        } => vec![*init, *loop_block, *test, *fallthrough],
        Terminal::ForIn {
            init,
            loop_block,
            fallthrough,
            ..
        } => vec![*init, *loop_block, *fallthrough],
        Terminal::Label {
            block, fallthrough, ..
        }
        | Terminal::Sequence {
            block, fallthrough, ..
        } => vec![*block, *fallthrough],
        Terminal::Try {
            block,
            handler,
            fallthrough,
            ..
        } => vec![*block, *handler, *fallthrough],
        Terminal::MaybeThrow {
            continuation,
            handler,
            ..
        } => match handler {
            Some(handler) => vec![*continuation, *handler],
            None => vec![*continuation],
        },
        Terminal::Scope {
            block, fallthrough, ..
        }
        | Terminal::PrunedScope {
            block, fallthrough, ..
        } => vec![*block, *fallthrough],
        Terminal::Return { .. }
        | Terminal::Throw { .. }
        | Terminal::Unreachable { .. }
        | Terminal::Unsupported { .. } => vec![],
    }
}

