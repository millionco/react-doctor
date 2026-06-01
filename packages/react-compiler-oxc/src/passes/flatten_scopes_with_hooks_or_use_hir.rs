//! `flattenScopesWithHooksOrUseHIR(fn)` — port of
//! `ReactiveScopes/FlattenScopesWithHooksOrUseHIR.ts`.
//!
//! Removes (flattens or prunes) reactive scopes that transitively contain a call
//! to a React hook or the `use` operator. Hooks cannot be called conditionally,
//! and a reactive-scope memo block would wrap the call in an `if`, so any scope
//! enclosing such a call is dropped.
//!
//! A single pass through blocks in program order maintains a stack of active
//! scopes (`{block, fallthrough}`). When an instruction is a `MethodCall` /
//! `CallExpression` whose callee is a hook or `use`, every currently-active
//! scope's block is queued for pruning and the active stack is cleared. After the
//! walk, each queued scope's `scope` terminal is converted to either a `label`
//! (when the scope body is a single hook-call instruction + `goto` to the
//! fallthrough — a "simple" scope) or a `pruned-scope`.

use crate::hir::ids::BlockId;
use crate::hir::model::HirFunction;
use crate::hir::terminal::Terminal;
use crate::hir::value::InstructionValue;

use super::infer_reactive_places::{get_hook_kind, is_use_operator};

/// `flattenScopesWithHooksOrUseHIR(fn)`.
pub fn flatten_scopes_with_hooks_or_use_hir(func: &mut HirFunction) {
    let mut active_scopes: Vec<ActiveScope> = Vec::new();
    let mut prune: Vec<BlockId> = Vec::new();

    let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in &block_ids {
        // `retainWhere(activeScopes, current => current.fallthrough !== block.id)`.
        active_scopes.retain(|s| s.fallthrough != *block_id);

        let block = func.body.block(*block_id).expect("block exists");
        for instr in &block.instructions {
            let callee = match &instr.value {
                InstructionValue::CallExpression { callee, .. } => Some(callee),
                InstructionValue::MethodCall { property, .. } => Some(property),
                _ => None,
            };
            if let Some(callee) = callee {
                if get_hook_kind(&callee.identifier).is_some()
                    || is_use_operator(&callee.identifier)
                {
                    prune.extend(active_scopes.iter().map(|s| s.block));
                    active_scopes.clear();
                }
            }
        }

        if let Terminal::Scope { fallthrough, .. } = &block.terminal {
            active_scopes.push(ActiveScope {
                block: *block_id,
                fallthrough: *fallthrough,
            });
        }
    }

    for id in prune {
        // Determine whether the scope body is "simple" (single instruction + a
        // `goto` to the scope fallthrough), then rewrite the terminal.
        let (body_block, fallthrough, scope, terminal_id, loc) = {
            let block = func.body.block(id).expect("pruned block exists");
            match &block.terminal {
                Terminal::Scope {
                    block: body,
                    fallthrough,
                    scope,
                    id,
                    loc,
                } => (*body, *fallthrough, scope.clone(), *id, loc.clone()),
                // The TS invariants that this is a `scope`; defensively skip otherwise.
                _ => continue,
            }
        };
        let simple = {
            let body = func.body.block(body_block).expect("scope body exists");
            body.instructions.len() == 1
                && matches!(
                    &body.terminal,
                    Terminal::Goto { block, .. } if *block == fallthrough
                )
        };
        let block = func.body.block_mut(id).expect("pruned block exists");
        block.terminal = if simple {
            // A scope that was just a hook call — flatten to a `label` (the actual
            // flattening is left to `pruneUnusedLabelsHIR`, which runs later).
            Terminal::Label {
                block: body_block,
                fallthrough,
                id: terminal_id,
                loc,
            }
        } else {
            Terminal::PrunedScope {
                block: body_block,
                fallthrough,
                scope,
                id: terminal_id,
                loc,
            }
        };
    }
}

/// An active reactive scope: its `scope`-terminal block and that scope's
/// fallthrough block.
struct ActiveScope {
    block: BlockId,
    fallthrough: BlockId,
}
