//! `alignMethodCallScopes(fn)` — port of
//! `ReactiveScopes/AlignMethodCallScopes.ts`.
//!
//! Ensures every `MethodCall` instruction has scopes such that either both the
//! call result (lvalue) and its resolved method (`property`) share a scope, or
//! neither has one. For each `MethodCall`:
//! - both scoped → union the two scopes (merged into one root, ranges combined),
//! - only the lvalue scoped → record that the property should adopt the lvalue's
//!   scope (`scopeMapping[property.id] = lvalueScope`),
//! - only the property scoped → record that the property should *lose* its scope
//!   (`scopeMapping[property.id] = null`).
//!
//! Recurses into nested `FunctionExpression`/`ObjectMethod` bodies (scopes are
//! disjoint per function). After collecting, merged scope roots get their ranges
//! combined, then a second body pass repoints each instruction lvalue: the
//! `scopeMapping` (keyed by id) wins, else the lvalue's scope is canonicalized to
//! its merged root.
//!
//! ## Scope/range model
//!
//! Our `Identifier` carries `scope: Option<ScopeId>` + a per-place `mutable_range`
//! kept equal to the shared scope range. This pass changes `identifier.scope`
//! (set/clear/repoint) and may extend a surviving root scope's range. We apply
//! the scope change to *every* `Place` carrying that id (so the printed `_@N`
//! suffix updates everywhere), and write merged ranges back to all members of the
//! surviving root scope.

use std::collections::HashMap;

use crate::hir::ids::{IdentifierId, InstructionId, ScopeId};
use crate::hir::model::HirFunction;
use crate::hir::value::InstructionValue;

use super::disjoint_set::DisjointSet;
use super::reactive_scope_util::{collect_scope_ranges, for_each_place_mut, write_scope_ranges};

/// `alignMethodCallScopes(fn)`.
pub fn align_method_call_scopes(func: &mut HirFunction) {
    // `scopeMapping`: property identifier id -> new scope (Some) or cleared (None).
    let mut scope_mapping: HashMap<IdentifierId, Option<ScopeId>> = HashMap::new();
    // `mergedScopes`: union-find over scope ids.
    let mut merged_scopes: DisjointSet<ScopeId> = DisjointSet::new();

    for block in func.body.blocks() {
        for instr in &block.instructions {
            if let InstructionValue::MethodCall { property, .. } = &instr.value {
                let lvalue_scope = instr.lvalue.identifier.scope;
                let property_scope = property.identifier.scope;
                match (lvalue_scope, property_scope) {
                    (Some(lvalue_scope), Some(property_scope)) => {
                        merged_scopes.union(&[lvalue_scope, property_scope]);
                    }
                    (Some(lvalue_scope), None) => {
                        scope_mapping.insert(property.identifier.id, Some(lvalue_scope));
                    }
                    (None, Some(_)) => {
                        scope_mapping.insert(property.identifier.id, None);
                    }
                    (None, None) => {}
                }
            }
        }
    }

    // Recurse into nested functions (after the outer collection, matching the TS
    // which recurses inline during the same loop — order is irrelevant since the
    // nested calls operate on disjoint scope sets / separate bodies).
    recurse_nested(func);

    // Merge scope-root ranges: for each non-root scope, fold its range into the
    // root's range (`Math.min` start / `Math.max` end).
    let mut scope_ranges = collect_scope_ranges(func);
    let pairs: Vec<(ScopeId, ScopeId)> = {
        let mut out = Vec::new();
        merged_scopes.for_each(|scope, root| out.push((scope, root)));
        out
    };
    for (scope, root) in &pairs {
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

    // Build the canonical-root lookup for the repoint step.
    let mut root_of: HashMap<ScopeId, ScopeId> = HashMap::new();
    for scope in scope_ranges.keys().copied().collect::<Vec<_>>() {
        if let Some(root) = merged_scopes.find(scope) {
            root_of.insert(scope, root);
        }
    }

    // Repoint instruction lvalue scopes. `scopeMapping` (by id) wins; else the
    // lvalue's scope is canonicalized to its merged root. The decision records
    // both the new `scope` and whether `range_scope` should be repointed too:
    // - cleared (case 3): `scope = None`, `range_scope` *kept* (so the printed
    //   `[a:b]` keeps following its former scope's — now-extended — range);
    // - repointed to a merged root: both `scope` and `range_scope` → root.
    let mut decisions: HashMap<IdentifierId, Decision> = HashMap::new();
    let block_ids: Vec<_> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in &block_ids {
        let block = func.body.block(*block_id).expect("block exists");
        for instr in &block.instructions {
            let id = instr.lvalue.identifier.id;
            let current = instr.lvalue.identifier.scope;
            let decision = if let Some(mapped) = scope_mapping.get(&id) {
                // `scopeMapping` only ever clears (`None`) or assigns the lvalue's
                // scope to the property; both keep the same `range_scope`.
                Decision {
                    scope: *mapped,
                    range_scope: None, // keep existing range_scope
                }
            } else if let Some(current) = current {
                match root_of.get(&current) {
                    Some(root) => Decision {
                        scope: Some(*root),
                        range_scope: Some(*root),
                    },
                    None => continue,
                }
            } else {
                continue;
            };
            decisions.insert(id, decision);
        }
    }
    for_each_place_mut(func, |place| {
        if let Some(decision) = decisions.get(&place.identifier.id) {
            place.identifier.scope = decision.scope;
            if let Some(root) = decision.range_scope {
                place.identifier.range_scope = Some(root);
            }
        }
    });

    // After repoint, every place's `range_scope` resolves (via the side-table) to
    // its merged-root range; write those ranges back so the printed `[a:b]`
    // matches.
    write_scope_ranges(func, &scope_ranges);
}

/// A per-lvalue scope repoint decision.
struct Decision {
    /// The new `scope` (printed `_@N`); `None` clears it.
    scope: Option<ScopeId>,
    /// If `Some`, the new `range_scope`; if `None`, keep the existing one.
    range_scope: Option<ScopeId>,
}

/// Recurse into nested `FunctionExpression`/`ObjectMethod` bodies.
fn recurse_nested(func: &mut HirFunction) {
    let block_ids: Vec<_> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        let block = func.body.block_mut(block_id).expect("block exists");
        for instr in &mut block.instructions {
            match &mut instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    align_method_call_scopes(&mut lowered_func.func);
                }
                _ => {}
            }
        }
    }
}
