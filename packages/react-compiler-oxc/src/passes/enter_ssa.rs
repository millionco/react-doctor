//! `enterSSA` (`SSA/EnterSSA.ts`).
//!
//! Iterative SSA construction (Cytron et al. with incomplete-phi handling for
//! loops). Blocks are visited in the order they appear in `func.body.blocks`
//! (reverse-postorder), so forward dataflow sees a definition before its use
//! except across back-edges, which are sealed lazily via incomplete phis.
//!
//! Every identifier *definition* is reallocated a fresh [`IdentifierId`] from the
//! shared [`PassContext`] counter. The `$id` parity oracle is sensitive to the
//! exact *order* of these allocations, so this pass mirrors the TS visit order
//! precisely: function params, then per block (in `func.body.blocks` order) each
//! instruction's operands (renamed, no allocation unless a phi is needed) then
//! its lvalues (in `mapInstructionLValues` order: value-lvalues, then
//! `instr.lvalue`), then nested-function params + bodies, then the terminal
//! operands. Phis allocate ids when first encountered (incomplete phis for
//! unsealed predecessors, complete phis at multi-predecessor joins).
//!
//! Identity: in the TS, `defs`/`unknown` key on the shared `Identifier` *object*.
//! Pre-SSA every reference to a variable shares one identifier whose `id` equals
//! its `declarationId` and is unique within the function tree, so this port keys
//! those maps/sets on the pre-SSA [`IdentifierId`]. `defineContext`/`#context` is
//! dead code in the TS pass (never called) and is omitted.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::{BlockId, IdentifierId};
use crate::hir::model::{BasicBlock, FunctionParam, HirFunction, Phi, PhiOperands};
use crate::hir::place::{Identifier, MutableRange, Place, Type};
use crate::hir::value::InstructionValue;

use super::PassContext;
use super::cfg::{
    each_instruction_operand_mut, each_terminal_operand_mut, each_terminal_successor,
    map_instruction_lvalues_order_mut,
};

/// A phi placed before all of a block's predecessors were visited, to be
/// completed (`addPhi`) once the block is sealed.
#[derive(Clone)]
struct IncompletePhi {
    old_place: Place,
    new_place: Place,
}

/// Per-block renaming state (`State` in the TS).
#[derive(Default)]
struct State {
    /// Maps a pre-SSA identifier id to its current SSA identifier in this block.
    defs: HashMap<IdentifierId, Identifier>,
    /// Phis inserted before the block was sealed.
    incomplete_phis: Vec<IncompletePhi>,
}

/// SSA construction state (`SSABuilder`). Holds only builder-internal data so its
/// methods never alias the [`HirFunction`] blocks being mutated by the driver.
struct SsaBuilder {
    states: HashMap<BlockId, State>,
    current: Option<BlockId>,
    /// Countdown of not-yet-visited predecessors per block.
    unsealed_preds: HashMap<BlockId, i64>,
    /// Snapshot of each block's predecessors, in `markPredecessors` order. For a
    /// nested function's entry block this is temporarily set to the enclosing
    /// block while that function is processed (`entry.preds.add/clear` in the TS).
    block_preds: HashMap<BlockId, Vec<BlockId>>,
    /// Identifiers used before definition (assumed global/external).
    unknown: HashSet<IdentifierId>,
    /// Phis accumulated per block, written back into the CFG at the end.
    phis: HashMap<BlockId, Vec<Phi>>,
}

impl SsaBuilder {
    fn new(func: &HirFunction) -> Self {
        let mut block_preds = HashMap::new();
        collect_block_preds(func, &mut block_preds);
        SsaBuilder {
            states: HashMap::new(),
            current: None,
            unsealed_preds: HashMap::new(),
            block_preds,
            unknown: HashSet::new(),
            phis: HashMap::new(),
        }
    }

    fn start_block(&mut self, block_id: BlockId) {
        self.current = Some(block_id);
        self.states.insert(block_id, State::default());
    }

    /// `makeId`: a fresh SSA identifier copying `name`/`declarationId`/`loc` from
    /// `old`, with reset mutable range, scope, and type (recomputed later).
    fn make_id(&mut self, ctx: &mut PassContext, old: &Identifier) -> Identifier {
        Identifier {
            id: ctx.next_identifier_id(),
            declaration_id: old.declaration_id,
            name: old.name.clone(),
            mutable_range: MutableRange::default(),
            scope: None,
            range_scope: None,
            type_: Type::var(crate::hir::ids::TypeId::new(0)),
            loc: old.loc.clone(),
        }
    }

    /// `definePlace`: allocate a fresh SSA id for an lvalue and record the
    /// mapping in the current block's defs.
    fn define_place(&mut self, ctx: &mut PassContext, old_place: &Place) -> Place {
        let old_id = old_place.identifier.id;
        debug_assert!(
            !self.unknown.contains(&old_id),
            "[hoisting] EnterSSA: identifier used before definition"
        );
        let new_id = self.make_id(ctx, &old_place.identifier);
        let current = self.current.expect("must be in a block");
        self.states
            .get_mut(&current)
            .expect("current state")
            .defs
            .insert(old_id, new_id.clone());
        Place {
            identifier: new_id,
            ..old_place.clone()
        }
    }

    /// `getPlace`: rename an operand to its current SSA definition.
    fn get_place(&mut self, ctx: &mut PassContext, old_place: &Place) -> Place {
        let new_id = self.get_id_at(ctx, old_place, self.current.expect("must be in a block"));
        Place {
            identifier: new_id,
            ..old_place.clone()
        }
    }

    /// `getIdAt`: the SSA identifier for `old_place` as seen from `block_id`,
    /// inserting phis as needed.
    fn get_id_at(&mut self, ctx: &mut PassContext, old_place: &Place, block_id: BlockId) -> Identifier {
        let old_id = old_place.identifier.id;

        // Defined locally?
        if let Some(def) = self
            .states
            .get(&block_id)
            .and_then(|state| state.defs.get(&old_id))
        {
            return def.clone();
        }

        let preds = self.block_preds.get(&block_id).cloned().unwrap_or_default();

        // Entry block with no definition: assume global/external.
        if preds.is_empty() {
            self.unknown.insert(old_id);
            return old_place.identifier.clone();
        }

        // Unsealed predecessors: place an incomplete phi.
        let unsealed = self.unsealed_preds.get(&block_id).copied().unwrap_or(0);
        if unsealed > 0 {
            let new_id = self.make_id(ctx, &old_place.identifier);
            let new_place = Place {
                identifier: new_id.clone(),
                ..old_place.clone()
            };
            let state = self.states.get_mut(&block_id).expect("state");
            state.incomplete_phis.push(IncompletePhi {
                old_place: old_place.clone(),
                new_place,
            });
            state.defs.insert(old_id, new_id.clone());
            return new_id;
        }

        // Single predecessor: look there.
        if preds.len() == 1 {
            let new_id = self.get_id_at(ctx, old_place, preds[0]);
            self.states
                .get_mut(&block_id)
                .expect("state")
                .defs
                .insert(old_id, new_id.clone());
            return new_id;
        }

        // Multiple predecessors: allocate a phi id, record it to break loops,
        // then compute operands.
        let new_id = self.make_id(ctx, &old_place.identifier);
        self.states
            .get_mut(&block_id)
            .expect("state")
            .defs
            .insert(old_id, new_id.clone());
        let new_place = Place {
            identifier: new_id,
            ..old_place.clone()
        };
        self.add_phi(ctx, block_id, old_place, new_place)
    }

    /// `addPhi`: build a phi for `new_place`, computing one operand per
    /// predecessor (in predecessor order). Returns the phi's identifier.
    fn add_phi(
        &mut self,
        ctx: &mut PassContext,
        block_id: BlockId,
        old_place: &Place,
        new_place: Place,
    ) -> Identifier {
        let preds = self.block_preds.get(&block_id).cloned().unwrap_or_default();
        let mut operands = PhiOperands::new();
        for pred in preds {
            let pred_id = self.get_id_at(ctx, old_place, pred);
            operands.insert(
                pred,
                Place {
                    identifier: pred_id,
                    ..old_place.clone()
                },
            );
        }
        let identifier = new_place.identifier.clone();
        self.phis.entry(block_id).or_default().push(Phi {
            place: new_place,
            operands,
        });
        identifier
    }

    /// `fixIncompletePhis`: complete every incomplete phi recorded for `block_id`
    /// now that all its predecessors have been visited.
    fn fix_incomplete_phis(&mut self, ctx: &mut PassContext, block_id: BlockId) {
        let incomplete = self
            .states
            .get(&block_id)
            .map(|state| state.incomplete_phis.clone())
            .unwrap_or_default();
        for phi in incomplete {
            self.add_phi(ctx, block_id, &phi.old_place, phi.new_place);
        }
    }
}

/// Recursively snapshot every block's predecessors (parent + nested functions),
/// keyed by globally-unique block id.
fn collect_block_preds(func: &HirFunction, out: &mut HashMap<BlockId, Vec<BlockId>>) {
    for block in func.body.blocks() {
        out.insert(block.id, block.preds.iter().copied().collect());
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    collect_block_preds(&lowered_func.func, out);
                }
                _ => {}
            }
        }
    }
}

/// `enterSSA`: rename every identifier into SSA form, inserting phis at joins.
pub fn enter_ssa(func: &mut HirFunction, ctx: &mut PassContext) {
    let mut builder = SsaBuilder::new(func);
    let root_entry = func.body.entry;
    enter_ssa_impl(func, &mut builder, ctx, root_entry);
    // Write accumulated phis back into the CFG (parent + nested functions).
    write_phis(func, &mut builder.phis);
}

/// `enterSSAImpl`: the per-function SSA traversal. Recurses into nested function
/// expressions / object methods inline, exactly where the TS does.
fn enter_ssa_impl(
    func: &mut HirFunction,
    builder: &mut SsaBuilder,
    ctx: &mut PassContext,
    root_entry: BlockId,
) {
    let mut visited: HashSet<BlockId> = HashSet::new();
    let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();

    // Rename root-function params at the entry block (the TS does this inside the
    // entry-block iteration, before its instructions).
    for block_id in block_ids {
        debug_assert!(
            !visited.contains(&block_id),
            "found a cycle revisiting bb{block_id:?}"
        );
        visited.insert(block_id);
        builder.start_block(block_id);

        if block_id == root_entry {
            debug_assert!(
                func.context.is_empty(),
                "root function context must be empty"
            );
            rename_params(&mut func.params, builder, ctx);
        }

        // Process instructions: operands (rename) then lvalues (define), then any
        // nested function. We index by position to re-borrow the block between the
        // operand/lvalue passes and the nested-function recursion.
        let instr_count = func
            .body
            .block(block_id)
            .expect("block exists")
            .instructions
            .len();
        for index in 0..instr_count {
            {
                let block = func.body.block_mut(block_id).expect("block exists");
                let instr = &mut block.instructions[index];
                for place in each_instruction_operand_mut(instr) {
                    *place = builder.get_place(ctx, place);
                }
                for place in map_instruction_lvalues_order_mut(instr) {
                    *place = builder.define_place(ctx, place);
                }
            }

            // Nested function expression / object method.
            let nested_entry = {
                let block = func.body.block(block_id).expect("block exists");
                match &block.instructions[index].value {
                    InstructionValue::FunctionExpression { lowered_func, .. }
                    | InstructionValue::ObjectMethod { lowered_func, .. } => {
                        Some(lowered_func.func.body.entry)
                    }
                    _ => None,
                }
            };
            if let Some(nested_entry) = nested_entry {
                // Mark the current block as the nested entry's predecessor.
                builder
                    .block_preds
                    .insert(nested_entry, vec![block_id]);
                let saved_current = builder.current;
                {
                    let block = func.body.block_mut(block_id).expect("block exists");
                    let lowered_func = match &mut block.instructions[index].value {
                        InstructionValue::FunctionExpression { lowered_func, .. }
                        | InstructionValue::ObjectMethod { lowered_func, .. } => lowered_func,
                        _ => unreachable!(),
                    };
                    rename_params(&mut lowered_func.func.params, builder, ctx);
                    enter_ssa_impl(&mut lowered_func.func, builder, ctx, root_entry);
                }
                builder.current = saved_current;
                // `entry.preds.clear()` — the nested entry has no real predecessor.
                builder.block_preds.insert(nested_entry, Vec::new());
            }
        }

        // Terminal operands.
        {
            let block = func.body.block_mut(block_id).expect("block exists");
            for place in each_terminal_operand_mut(&mut block.terminal) {
                *place = builder.get_place(ctx, place);
            }
        }

        // Update unsealed predecessor counts for successors, sealing any that are
        // now fully visited.
        let successors = {
            let block = func.body.block(block_id).expect("block exists");
            each_terminal_successor(&block.terminal)
        };
        for output in successors {
            let count = if let Some(existing) = builder.unsealed_preds.get(&output) {
                existing - 1
            } else {
                let preds = builder.block_preds.get(&output).map(|p| p.len()).unwrap_or(0);
                preds as i64 - 1
            };
            builder.unsealed_preds.insert(output, count);
            if count == 0 && visited.contains(&output) {
                builder.fix_incomplete_phis(ctx, output);
            }
        }
    }
}

/// Rename a parameter list in place (`func.params.map(...)`): an `Identifier`
/// param defines its place, a `...rest` param defines its inner place.
fn rename_params(params: &mut [FunctionParam], builder: &mut SsaBuilder, ctx: &mut PassContext) {
    for param in params {
        match param {
            FunctionParam::Place(place) => {
                *place = builder.define_place(ctx, place);
            }
            FunctionParam::Spread(spread) => {
                spread.place = builder.define_place(ctx, &spread.place);
            }
        }
    }
}

/// Drain the accumulated phis into their blocks (parent + nested functions).
fn write_phis(func: &mut HirFunction, phis: &mut HashMap<BlockId, Vec<Phi>>) {
    for block in func.body.blocks_mut() {
        attach_phis(block, phis);
        for instr in &mut block.instructions {
            match &mut instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    write_phis(&mut lowered_func.func, phis);
                }
                _ => {}
            }
        }
    }
}

fn attach_phis(block: &mut BasicBlock, phis: &mut HashMap<BlockId, Vec<Phi>>) {
    if let Some(block_phis) = phis.remove(&block.id) {
        block.phis.extend(block_phis);
    }
}
