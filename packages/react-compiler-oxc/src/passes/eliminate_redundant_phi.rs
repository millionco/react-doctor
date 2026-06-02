//! `eliminateRedundantPhi` (`SSA/EliminateRedundantPhi.ts`).
//!
//! Removes trivial phis whose operands are all the same identifier (or the phi's
//! own output), replacing every use of the phi with that identifier. A trivial
//! phi `x2 = phi(x1, x1, x1)` or `x2 = phi(x1, x2, x1)` is eliminated and `x2` is
//! rewritten to `x1` everywhere.
//!
//! The algorithm visits blocks in reverse-postorder, recording rewrites
//! (`x2 -> x1`) and applying them to subsequent phis, instructions, and
//! terminals. It iterates until a pass adds no new rewrites; for a CFG without
//! back-edges one pass suffices. Rewrites are *shared* into nested functions so a
//! parent's eliminations propagate into closures.
//!
//! Identity: post-SSA every definition has a unique [`IdentifierId`], so the
//! TS `Map<Identifier, Identifier>` rewrite table keys on that id here. A rewrite
//! stores the full target [`Identifier`] (so a rewritten place adopts the target
//! name/type), matching `place.identifier = rewrite`.

use std::collections::HashMap;

use crate::hir::ids::IdentifierId;
use crate::hir::model::HirFunction;
use crate::hir::place::{Identifier, Place};
use crate::hir::value::InstructionValue;

use super::PassContext;
use super::cfg::{each_instruction_lvalue_mut, each_instruction_operand_mut, each_terminal_operand_mut};

/// The rewrite table: pre-rewrite SSA id -> its replacement identifier.
type Rewrites = HashMap<IdentifierId, Identifier>;

/// `eliminateRedundantPhi`: the [`PassContext`]-signature entry point. Allocates
/// no ids; `ctx` is unused but kept for the uniform pass signature.
pub fn eliminate_redundant_phi(func: &mut HirFunction, _ctx: &mut PassContext) {
    let mut rewrites: Rewrites = HashMap::new();
    eliminate_redundant_phi_impl(func, &mut rewrites);
}

fn eliminate_redundant_phi_impl(func: &mut HirFunction, rewrites: &mut Rewrites) {
    let mut has_back_edge = false;
    let mut visited: Vec<crate::hir::ids::BlockId> = Vec::new();

    loop {
        let size = rewrites.len();
        let block_ids: Vec<crate::hir::ids::BlockId> =
            func.body.blocks().iter().map(|b| b.id).collect();

        for block_id in block_ids {
            // Detect back-edges on the first pass: a predecessor not yet visited
            // (only possible across a loop, since blocks are in reverse-postorder).
            if !has_back_edge {
                let preds: Vec<crate::hir::ids::BlockId> = func
                    .body
                    .block(block_id)
                    .map(|b| b.preds.iter().copied().collect())
                    .unwrap_or_default();
                for pred in preds {
                    if !visited.contains(&pred) {
                        has_back_edge = true;
                    }
                }
            }
            if !visited.contains(&block_id) {
                visited.push(block_id);
            }

            let block = func.body.block_mut(block_id).expect("block exists");

            // STEP 1: eliminate trivial phis.
            let mut surviving = Vec::with_capacity(block.phis.len());
            for mut phi in std::mem::take(&mut block.phis) {
                // Remap operands through prior rewrites.
                for place in phi.operands.values_mut() {
                    rewrite_place(place, rewrites);
                }
                // Determine the single non-self operand, if any.
                let mut same: Option<Identifier> = None;
                let mut trivial = true;
                for (_, operand) in phi.operands.iter() {
                    let op_id = operand.identifier.id;
                    if same.as_ref().is_some_and(|s| op_id == s.id)
                        || op_id == phi.place.identifier.id
                    {
                        // Same as the phi output or a prior operand.
                        continue;
                    } else if same.is_some() {
                        // A second distinct operand: not trivial.
                        trivial = false;
                        break;
                    } else {
                        same = Some(operand.identifier.clone());
                    }
                }
                if trivial {
                    let same = same.expect("phi must be non-empty");
                    rewrites.insert(phi.place.identifier.id, same);
                    // Drop the phi (do not keep it in `surviving`).
                } else {
                    surviving.push(phi);
                }
            }
            block.phis = surviving;

            // STEP 2: rewrite instruction lvalues + operands, recurse into nested.
            for instr in &mut block.instructions {
                for place in each_instruction_lvalue_mut(instr) {
                    rewrite_place(place, rewrites);
                }
                for place in each_instruction_operand_mut(instr) {
                    rewrite_place(place, rewrites);
                }
                match &mut instr.value {
                    InstructionValue::FunctionExpression { lowered_func, .. }
                    | InstructionValue::ObjectMethod { lowered_func, .. } => {
                        for place in &mut lowered_func.func.context {
                            rewrite_place(place, rewrites);
                        }
                        eliminate_redundant_phi_impl(&mut lowered_func.func, rewrites);
                    }
                    _ => {}
                }
            }

            // STEP 3: rewrite terminal operands.
            let block = func.body.block_mut(block_id).expect("block exists");
            for place in each_terminal_operand_mut(&mut block.terminal) {
                rewrite_place(place, rewrites);
            }
        }

        if rewrites.len() <= size || !has_back_edge {
            break;
        }
    }
}

/// `rewritePlace`: replace `place.identifier` with its rewrite, if any (a single,
/// non-transitive lookup — chains resolve over successive passes).
fn rewrite_place(place: &mut Place, rewrites: &Rewrites) {
    if let Some(rewrite) = rewrites.get(&place.identifier.id) {
        place.identifier = rewrite.clone();
    }
}
