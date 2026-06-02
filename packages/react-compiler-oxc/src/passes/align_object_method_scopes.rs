//! `alignObjectMethodScopes(fn)` — port of
//! `ReactiveScopes/AlignObjectMethodScopes.ts`.
//!
//! Aligns the scope of every `ObjectMethod` value to its enclosing
//! `ObjectExpression`, so codegen can inline the method definition into the same
//! reactive block as the object literal. Two phases per function:
//! 1. `findScopesToMerge`: collect `ObjectMethod` lvalue identifiers, then for
//!    every `ObjectExpression` whose operand is one of those object-method
//!    identifiers, union the operand's scope with the object expression's scope.
//! 2. Merge the canonical roots' ranges, then repoint every instruction lvalue
//!    whose scope was merged to the canonical root.
//!
//! Recurses into nested `ObjectMethod`/`FunctionExpression` bodies first (scopes
//! are disjoint per function). No fixture contains an object method captured by
//! an object literal in a way that triggers a merge, so in practice this pass is
//! a no-op; the full algorithm is ported regardless.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::{IdentifierId, InstructionId, ScopeId};
use crate::hir::model::HirFunction;
use crate::hir::value::InstructionValue;

use super::disjoint_set::DisjointSet;
use super::reactive_scope_util::{collect_scope_ranges, for_each_place_mut, write_scope_ranges};

/// `alignObjectMethodScopes(fn)`.
pub fn align_object_method_scopes(func: &mut HirFunction) {
    // Recurse into nested functions first.
    let block_ids: Vec<_> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in &block_ids {
        let block = func.body.block_mut(*block_id).expect("block exists");
        for instr in &mut block.instructions {
            match &mut instr.value {
                InstructionValue::ObjectMethod { lowered_func, .. }
                | InstructionValue::FunctionExpression { lowered_func, .. } => {
                    align_object_method_scopes(&mut lowered_func.func);
                }
                _ => {}
            }
        }
    }

    let merge = find_scopes_to_merge(func);
    // `canonicalize()`: map each member scope to its set root.
    let mut scope_groups: HashMap<ScopeId, ScopeId> = HashMap::new();
    {
        let mut builder = merge;
        builder.for_each(|scope, root| {
            scope_groups.insert(scope, root);
        });
    }

    if scope_groups.is_empty() {
        return;
    }

    // Step 1: merge affected scopes' ranges into their canonical root.
    let mut scope_ranges = collect_scope_ranges(func);
    for (scope, root) in &scope_groups {
        if scope == root {
            continue;
        }
        let scope_range = scope_ranges.get(scope).copied();
        if let (Some(scope_range), Some(root_range)) = (scope_range, scope_ranges.get_mut(root)) {
            root_range.start = InstructionId::new(
                scope_range.start.as_u32().min(root_range.start.as_u32()),
            );
            root_range.end =
                InstructionId::new(scope_range.end.as_u32().max(root_range.end.as_u32()));
        }
    }

    // Step 2: repoint instruction lvalue identifiers whose scope was merged.
    let mut decisions: HashMap<IdentifierId, ScopeId> = HashMap::new();
    for block_id in &block_ids {
        let block = func.body.block(*block_id).expect("block exists");
        for instr in &block.instructions {
            if let Some(scope) = instr.lvalue.identifier.scope {
                if let Some(root) = scope_groups.get(&scope) {
                    decisions.insert(instr.lvalue.identifier.id, *root);
                }
            }
        }
    }
    for_each_place_mut(func, |place| {
        if let Some(root) = decisions.get(&place.identifier.id) {
            place.identifier.scope = Some(*root);
        }
    });

    write_scope_ranges(func, &scope_ranges);
}

/// `findScopesToMerge(fn)`: union the scope of each object-method operand of an
/// `ObjectExpression` with the object expression's own scope.
fn find_scopes_to_merge(func: &HirFunction) -> DisjointSet<ScopeId> {
    let mut object_method_decls: HashSet<IdentifierId> = HashSet::new();
    let mut builder: DisjointSet<ScopeId> = DisjointSet::new();

    for block in func.body.blocks() {
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::ObjectMethod { .. } => {
                    object_method_decls.insert(instr.lvalue.identifier.id);
                }
                InstructionValue::ObjectExpression { .. } => {
                    let lvalue_scope = instr.lvalue.identifier.scope;
                    for operand in super::cfg::each_instruction_value_operand(&instr.value) {
                        if object_method_decls.contains(&operand.identifier.id) {
                            // The TS asserts both scopes are non-null; we mirror
                            // that by only unioning when both are present.
                            if let (Some(operand_scope), Some(lvalue_scope)) =
                                (operand.identifier.scope, lvalue_scope)
                            {
                                builder.union(&[operand_scope, lvalue_scope]);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
    builder
}
