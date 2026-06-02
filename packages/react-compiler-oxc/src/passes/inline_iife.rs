//! `inlineImmediatelyInvokedFunctionExpressions`
//! (`Inference/InlineImmediatelyInvokedFunctionExpressions.ts`).
//!
//! Inlines immediately-invoked function expressions (zero-arg, non-async,
//! non-generator, no-param IIFEs) to allow finer-grained memoization of the
//! values they produce. Single-return lambdas are fully inlined; multi-return
//! lambdas are wrapped in a `label` terminal with their returns rewritten to
//! `StoreLocal` + `goto` the continuation block.
//!
//! After any inlining the graph is re-minified (reverse-postorder, instruction
//! renumbering, predecessor marking) and `mergeConsecutiveBlocks` is re-run,
//! matching the TS.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::{BlockId, IdentifierId, InstructionId};
use crate::hir::instruction::Instruction;
use crate::hir::model::{BasicBlock, HirFunction};
use crate::hir::place::{Effect, Identifier, IdentifierName, Place, SourceLocation};
use crate::hir::terminal::{GotoVariant, Terminal};
use crate::hir::value::{InstructionKind, InstructionValue, LValue, LoweredFunction};

use super::cfg::{
    each_instruction_value_operand, each_instruction_value_operand_mut, mark_instruction_ids,
    mark_predecessors, reverse_postorder_blocks, terminal_value_mut,
};
use super::merge_consecutive_blocks::merge_consecutive_blocks;
use super::PassContext;

/// Run the IIFE-inlining pass on `func` in place.
pub fn inline_immediately_invoked_function_expressions(
    func: &mut HirFunction,
    ctx: &mut PassContext,
) {
    // FunctionExpressions assigned to an (unnamed) temporary, by lvalue id.
    let mut functions: HashMap<IdentifierId, LoweredFunction> = HashMap::new();
    // The lvalue ids of functions that were inlined (their defining instructions
    // are pruned afterwards).
    let mut inlined_functions: HashSet<IdentifierId> = HashSet::new();

    // The work queue starts as the original blocks; continuation blocks created
    // while inlining are appended so sequential IIFEs are revisited. We process
    // by id (re-resolving against the live CFG) to match the TS, which iterates a
    // copied list of block references.
    let mut queue: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
    let mut qi = 0;
    while qi < queue.len() {
        let block_id = queue[qi];
        qi += 1;

        let Some(block) = func.body.block(block_id) else {
            continue;
        };
        if !block.kind.is_statement() {
            continue;
        }

        let mut ii = 0;
        while let Some(block) = func.body.block(block_id) {
            if ii >= block.instructions.len() {
                break;
            }
            let instr = &block.instructions[ii];
            match &instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. } => {
                    if instr.lvalue.identifier.name.is_none() {
                        functions
                            .insert(instr.lvalue.identifier.id, (**lowered_func).clone());
                    }
                    ii += 1;
                }
                InstructionValue::CallExpression { callee, args, .. } => {
                    if !args.is_empty() {
                        ii += 1;
                        continue;
                    }
                    let callee_id = callee.identifier.id;
                    let Some(body) = functions.get(&callee_id).cloned() else {
                        ii += 1;
                        continue;
                    };
                    if !body.func.params.is_empty() || body.func.async_ || body.func.generator {
                        ii += 1;
                        continue;
                    }

                    inlined_functions.insert(callee_id);
                    let continuation_block_id =
                        inline_call_site(func, ctx, block_id, ii, body);
                    queue.push(continuation_block_id);
                    // `continue queue;` in the TS: stop scanning this block.
                    break;
                }
                other => {
                    for place in each_instruction_value_operand(other) {
                        functions.remove(&place.identifier.id);
                    }
                    ii += 1;
                }
            }
        }
    }

    if inlined_functions.is_empty() {
        return;
    }

    // Remove the instructions that defined the inlined lambdas.
    for block in func.body.blocks_mut() {
        block
            .instructions
            .retain(|instr| !inlined_functions.contains(&instr.lvalue.identifier.id));
    }

    reverse_postorder_blocks(&mut func.body);
    mark_instruction_ids(&mut func.body);
    mark_predecessors(&mut func.body);
    merge_consecutive_blocks(func, ctx);
}

/// Inline one IIFE callsite (the instruction at `call_index` of `block_id`),
/// returning the id of the continuation block that holds the code following the
/// call. Mirrors the body of the `CallExpression` case in the TS.
fn inline_call_site(
    func: &mut HirFunction,
    ctx: &mut PassContext,
    block_id: BlockId,
    call_index: usize,
    body: LoweredFunction,
) -> BlockId {
    // The IIFE call's lvalue (the place the result is stored into).
    let result = func.body.block(block_id).expect("block exists").instructions[call_index]
        .lvalue
        .clone();

    // Split the current block: instructions after the call (+ original terminal)
    // become a new continuation block.
    let continuation_block_id = ctx.next_block_id();
    let (kind, tail_instructions, original_terminal) = {
        let block = func.body.block(block_id).expect("block exists");
        (
            block.kind,
            block.instructions[call_index + 1..].to_vec(),
            block.terminal.clone(),
        )
    };
    let original_terminal_id = original_terminal.id();
    let original_terminal_loc = terminal_loc(&original_terminal);

    let continuation_block = BasicBlock {
        kind,
        id: continuation_block_id,
        instructions: tail_instructions,
        terminal: original_terminal,
        preds: Default::default(),
        phis: Vec::new(),
    };
    func.body.push_block(continuation_block);

    // Trim the original block to the instructions before the call.
    {
        let block = func.body.block_mut(block_id).expect("block exists");
        block.instructions.truncate(call_index);
    }

    let entry = body.func.body.entry;

    if has_single_exit_return_terminal(&body.func) {
        // Single return: fully inline. The current block gotos into the lambda's
        // entry; each `return` becomes a LoadLocal into `result` + goto the
        // continuation.
        {
            let block = func.body.block_mut(block_id).expect("block exists");
            block.terminal = Terminal::Goto {
                block: entry,
                variant: GotoVariant::Break,
                id: original_terminal_id,
                loc: original_terminal_loc.clone(),
            };
        }

        let mut inlined = body.func.body;
        for block in inlined.blocks_mut() {
            if let Terminal::Return {
                value, id, loc, ..
            } = &block.terminal
            {
                let value = value.clone();
                let term_id = *id;
                let term_loc = loc.clone();
                block.instructions.push(Instruction {
                    id: InstructionId::new(0),
                    lvalue: result.clone(),
                    value: InstructionValue::LoadLocal {
                        place: value,
                        loc: term_loc.clone(),
                    },
                    loc: term_loc.clone(),
                    effects: None,
                });
                block.terminal = Terminal::Goto {
                    block: continuation_block_id,
                    variant: GotoVariant::Break,
                    id: term_id,
                    loc: term_loc,
                };
            }
        }
        for block in copy_blocks(inlined) {
            func.body.push_block(block);
        }
    } else {
        // Multiple returns: wrap as a labeled statement and rewrite returns to
        // StoreLocal(result) + goto.
        {
            let block = func.body.block_mut(block_id).expect("block exists");
            block.terminal = Terminal::Label {
                block: entry,
                fallthrough: continuation_block_id,
                id: InstructionId::new(0),
                loc: original_terminal_loc.clone(),
            };
        }

        // Declare and (if anonymous) promote the IIFE result temporary. The TS
        // declares first then promotes, but because the result lvalue's
        // identifier is shared by reference the promotion is observed by *every*
        // place referencing it (the DeclareLocal, the rewritten StoreLocals, and
        // the continuation's consuming StoreLocal). Rust places are by-value, so
        // we promote first and use the promoted result for all clones.
        let mut result = result;
        if result.identifier.name.is_none() {
            promote_temporary(&mut result.identifier);
        }
        declare_temporary(func, ctx, block_id, &result);

        let mut inlined = body.func.body;
        for block in inlined.blocks_mut() {
            rewrite_block(ctx, block, continuation_block_id, &result);
        }
        for block in copy_blocks(inlined) {
            func.body.push_block(block);
        }

        // Propagate the promotion to every other place referencing the result
        // identifier — notably the continuation's consuming `StoreLocal`/`LoadLocal`
        // operand, which stage-1 lowering created before this pass. In the TS the
        // identifier object is shared by reference, so promoting it renames all
        // uses at once.
        if let Some(name) = &result.identifier.name {
            rename_identifier(func, result.identifier.id, name);
        }
    }

    continuation_block_id
}

/// Set the name of every [`Place`] (instruction lvalues/operands, phi places and
/// operands, params, context, and `returns`) that references `id` to `name`.
/// Used to propagate a temporary's promotion across the by-value HIR, matching
/// the TS reference semantics where one identifier object is shared.
fn rename_identifier(func: &mut HirFunction, id: IdentifierId, name: &IdentifierName) {
    use crate::hir::model::FunctionParam;

    fn rename_place(place: &mut Place, id: IdentifierId, name: &IdentifierName) {
        if place.identifier.id == id {
            place.identifier.name = Some(name.clone());
        }
    }

    for param in &mut func.params {
        match param {
            FunctionParam::Place(place) => rename_place(place, id, name),
            FunctionParam::Spread(spread) => rename_place(&mut spread.place, id, name),
        }
    }
    rename_place(&mut func.returns, id, name);
    for place in &mut func.context {
        rename_place(place, id, name);
    }

    for block in func.body.blocks_mut() {
        for phi in &mut block.phis {
            rename_place(&mut phi.place, id, name);
            for operand in phi.operands.values_mut() {
                rename_place(operand, id, name);
            }
        }
        for instr in &mut block.instructions {
            rename_place(&mut instr.lvalue, id, name);
            for place in each_instruction_value_operand_mut(&mut instr.value) {
                rename_place(place, id, name);
            }
        }
        if let Some(value) = terminal_value_mut(&mut block.terminal) {
            rename_place(value, id, name);
        }
    }
}

/// Reset each block's predecessor set (the TS `block.preds.clear()`) and return
/// the blocks to copy into the outer function.
fn copy_blocks(mut ir: crate::hir::model::Hir) -> Vec<BasicBlock> {
    let ids: Vec<BlockId> = ir.blocks().iter().map(|b| b.id).collect();
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        let block = ir.block_mut(id).expect("block exists");
        block.preds.clear();
        out.push(block.clone());
    }
    out
}

/// `hasSingleExitReturnTerminal(fn)`: true when the function has exactly one
/// exit terminal (`return`/`throw`) and it is a `return`.
fn has_single_exit_return_terminal(func: &HirFunction) -> bool {
    let mut has_return = false;
    let mut exit_count = 0;
    for block in func.body.blocks() {
        match &block.terminal {
            Terminal::Return { .. } => {
                has_return = true;
                exit_count += 1;
            }
            Terminal::Throw { .. } => {
                exit_count += 1;
            }
            _ => {}
        }
    }
    exit_count == 1 && has_return
}

/// `rewriteBlock`: replace a `return` terminal with a StoreLocal(result) + goto.
fn rewrite_block(
    ctx: &mut PassContext,
    block: &mut BasicBlock,
    return_target: BlockId,
    return_value: &Place,
) {
    block.preds.clear();
    let Terminal::Return { value, loc, .. } = &block.terminal else {
        return;
    };
    let value = value.clone();
    let loc = loc.clone();
    block.instructions.push(Instruction {
        id: InstructionId::new(0),
        lvalue: create_temporary_place(ctx, loc.clone()),
        value: InstructionValue::StoreLocal {
            lvalue: LValue {
                place: return_value.clone(),
                kind: InstructionKind::Reassign,
            },
            value,
            type_annotation: None,
            loc: loc.clone(),
        },
        loc: loc.clone(),
        effects: None,
    });
    block.terminal = Terminal::Goto {
        block: return_target,
        variant: GotoVariant::Break,
        id: InstructionId::new(0),
        loc,
    };
}

/// `declareTemporary`: append a `DeclareLocal Let result` to the given block.
fn declare_temporary(func: &mut HirFunction, ctx: &mut PassContext, block_id: BlockId, result: &Place) {
    let temp = create_temporary_place(ctx, result.loc.clone());
    let block = func.body.block_mut(block_id).expect("block exists");
    block.instructions.push(Instruction {
        id: InstructionId::new(0),
        lvalue: temp,
        value: InstructionValue::DeclareLocal {
            lvalue: LValue {
                place: result.clone(),
                kind: InstructionKind::Let,
            },
            type_annotation: None,
            loc: result.loc.clone(),
        },
        loc: SourceLocation::Generated,
        effects: None,
    });
}

/// `createTemporaryPlace(env, loc)`: a fresh unnamed temporary place with
/// `Effect::Unknown`.
fn create_temporary_place(ctx: &mut PassContext, loc: SourceLocation) -> Place {
    let id = ctx.next_identifier_id();
    Place {
        identifier: Identifier::make_temporary(id, crate::hir::ids::TypeId::new(0), loc),
        effect: Effect::Unknown,
        reactive: false,
        loc: SourceLocation::Generated,
    }
}

/// `promoteTemporary(identifier)`: give an unnamed temporary the `#t<decl>` name.
fn promote_temporary(identifier: &mut Identifier) {
    identifier.name = Some(IdentifierName::Promoted {
        value: format!("#t{}", identifier.declaration_id.as_u32()),
    });
}

fn terminal_loc(terminal: &Terminal) -> SourceLocation {
    match terminal {
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
