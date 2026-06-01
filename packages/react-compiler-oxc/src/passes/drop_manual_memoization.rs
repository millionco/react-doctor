//! `dropManualMemoization` (`Inference/DropManualMemoization.ts`).
//!
//! Removes manual memoization using the `useMemo`/`useCallback` APIs so the
//! compiler can re-derive memoization. This pass is designed to compose with
//! `inlineImmediatelyInvokedFunctionExpressions` and runs *before* SSA form, so
//! it cannot rely on type inference: it does basic tracking of globals and
//! property loads to find both direct calls (`useMemo(...)`) and namespace calls
//! (`React.useMemo(...)`).
//!
//! Each manual-memo call is rewritten in place:
//! - `useMemo(fn, deps)` -> `CallExpression(fn, [])` (the inlined IIFE is then
//!   inlined by the following pass; DCE removes the dead `LoadGlobal`/deps array)
//! - `useCallback(fn, deps)` -> `LoadLocal(fn)` (alias the callback directly)
//!
//! When memoization validation is enabled (the default client config — see
//! [`EnvironmentConfig::is_memoization_validation_enabled`](crate::environment::EnvironmentConfig::is_memoization_validation_enabled)),
//! the pass also brackets each rewritten memoization with `StartMemoize` /
//! `FinishMemoize` markers carrying the *source* dependency list, inserting them
//! right after the hook load and right after the rewritten call respectively,
//! then re-marks instruction ids.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::{IdentifierId, InstructionId};
use crate::hir::instruction::Instruction;
use crate::hir::model::HirFunction;
use crate::hir::place::{Effect, Identifier, Place, SourceLocation};
use crate::hir::terminal::Terminal;
use crate::hir::value::{
    ArrayElement, CallArgument, DependencyPathEntry, InstructionValue, ManualMemoDependency,
    MemoDependencyRoot,
};

use super::cfg::mark_instruction_ids;
use super::PassContext;

/// The two recognized manual-memo hook callees (`ManualMemoCallee['kind']`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ManualMemoKind {
    UseMemo,
    UseCallback,
}

/// A recognized manual-memo callee (`ManualMemoCallee`): its kind plus the
/// `LoadGlobal`/`PropertyLoad` instruction id that produced it (so the
/// `StartMemoize` marker can be inserted right after that load).
#[derive(Clone, Debug)]
struct ManualMemoCallee {
    kind: ManualMemoKind,
    load_instr_id: InstructionId,
}

/// `IdentifierSidemap` from the TS: the side tables built while scanning
/// instructions, used to recognize hook callees, deps arrays, and dependency
/// chains.
#[derive(Default)]
struct IdentifierSidemap {
    /// Lvalue ids of `FunctionExpression` instructions.
    functions: HashSet<IdentifierId>,
    /// Lvalue ids that hold a recognized `useMemo`/`useCallback` callee.
    manual_memos: HashMap<IdentifierId, ManualMemoCallee>,
    /// Lvalue ids that hold a `LoadGlobal React` binding.
    react: HashSet<IdentifierId>,
    /// Lvalue ids of array literals whose elements are all identifiers — i.e.
    /// candidate dependency lists. Stores the array `loc` + element places.
    maybe_deps_lists: HashMap<IdentifierId, (SourceLocation, Vec<Place>)>,
    /// Lvalue ids that resolve to a simple dependency chain (`x`, `x.y.z`).
    maybe_deps: HashMap<IdentifierId, ManualMemoDependency>,
    /// Identifier ids written within an optional-chain block (`x?.y`), used to
    /// mark dependency-path entries optional.
    optionals: HashSet<IdentifierId>,
}

/// `collectMaybeMemoDependencies(value, maybeDeps, optional)`: extract the
/// variable + property reads represented by `value` into a [`ManualMemoDependency`].
pub(crate) fn collect_maybe_memo_dependencies(
    value: &InstructionValue,
    maybe_deps: &mut HashMap<IdentifierId, ManualMemoDependency>,
    optional: bool,
) -> Option<ManualMemoDependency> {
    match value {
        InstructionValue::LoadGlobal { binding, loc } => Some(ManualMemoDependency {
            root: MemoDependencyRoot::Global {
                identifier_name: binding_name(binding).to_string(),
            },
            path: Vec::new(),
            loc: loc.clone(),
        }),
        InstructionValue::PropertyLoad {
            object,
            property,
            loc,
        } => {
            let object_dep = maybe_deps.get(&object.identifier.id)?;
            let mut path = object_dep.path.clone();
            path.push(DependencyPathEntry {
                property: property.clone(),
                optional,
                loc: loc.clone(),
            });
            Some(ManualMemoDependency {
                root: object_dep.root.clone(),
                path,
                loc: loc.clone(),
            })
        }
        InstructionValue::LoadLocal { place, .. } | InstructionValue::LoadContext { place, .. } => {
            if let Some(source) = maybe_deps.get(&place.identifier.id) {
                Some(source.clone())
            } else if is_named(&place.identifier) {
                Some(ManualMemoDependency {
                    root: MemoDependencyRoot::NamedLocal {
                        value: place.clone(),
                        constant: false,
                    },
                    path: Vec::new(),
                    loc: place.loc.clone(),
                })
            } else {
                None
            }
        }
        InstructionValue::StoreLocal { lvalue, value, .. } => {
            // Value blocks rely on StoreLocal to populate their return value; track
            // these so optional property chains are valid in source depslists.
            let lvalue_id = lvalue.place.identifier.id;
            let rvalue_id = value.identifier.id;
            if let Some(aliased) = maybe_deps.get(&rvalue_id).cloned() {
                if !is_named(&lvalue.place.identifier) {
                    maybe_deps.insert(lvalue_id, aliased.clone());
                    return Some(aliased);
                }
            }
            None
        }
        _ => None,
    }
}

/// `collectTemporaries(instr, env, sidemap)`: populate the sidemap from one
/// non-call instruction.
fn collect_temporaries(instr: &Instruction, sidemap: &mut IdentifierSidemap) {
    let lvalue_id = instr.lvalue.identifier.id;
    match &instr.value {
        InstructionValue::FunctionExpression { .. } => {
            sidemap.functions.insert(lvalue_id);
        }
        InstructionValue::LoadGlobal { binding, .. } => {
            let name = binding_name(binding);
            // The pass cannot run type inference; instead it recognizes the
            // `useMemo`/`useCallback` globals by name (which `getHookKindForType`
            // would resolve from the global declaration's signature), and the
            // `React` namespace binding for `React.useMemo`/`React.useCallback`.
            match hook_kind_for_global(name) {
                Some(kind) => {
                    sidemap.manual_memos.insert(
                        lvalue_id,
                        ManualMemoCallee {
                            kind,
                            load_instr_id: instr.id,
                        },
                    );
                }
                None => {
                    if name == "React" {
                        sidemap.react.insert(lvalue_id);
                    }
                }
            }
        }
        InstructionValue::PropertyLoad {
            object, property, ..
        } => {
            if sidemap.react.contains(&object.identifier.id) {
                if let crate::hir::value::PropertyLiteral::String(prop) = property {
                    if let Some(kind) = hook_kind_for_property(prop) {
                        sidemap.manual_memos.insert(
                            lvalue_id,
                            ManualMemoCallee {
                                kind,
                                load_instr_id: instr.id,
                            },
                        );
                    }
                }
            }
        }
        InstructionValue::ArrayExpression { elements, loc } => {
            if elements
                .iter()
                .all(|e| matches!(e, ArrayElement::Place(_)))
            {
                let deps: Vec<Place> = elements
                    .iter()
                    .filter_map(|e| match e {
                        ArrayElement::Place(p) => Some(p.clone()),
                        _ => None,
                    })
                    .collect();
                sidemap
                    .maybe_deps_lists
                    .insert(lvalue_id, (loc.clone(), deps));
            }
        }
        _ => {}
    }

    let optional = sidemap.optionals.contains(&lvalue_id);
    if let Some(dep) = collect_maybe_memo_dependencies(&instr.value, &mut sidemap.maybe_deps, optional)
    {
        sidemap.maybe_deps.insert(lvalue_id, dep);
    }
}

/// `getManualMemoizationReplacement(fn, loc, kind)`: the replacement value for
/// the rewritten hook call.
fn get_manual_memoization_replacement(
    fn_place: &Place,
    loc: SourceLocation,
    kind: ManualMemoKind,
) -> InstructionValue {
    match kind {
        // useMemo: call the memo function itself with no args (a later pass
        // inlines the IIFE; DCE removes the dead deps array).
        ManualMemoKind::UseMemo => InstructionValue::CallExpression {
            callee: fn_place.clone(),
            args: Vec::new(),
            loc,
        },
        // useCallback: alias the callback directly.
        ManualMemoKind::UseCallback => InstructionValue::LoadLocal {
            place: Place {
                identifier: fn_place.identifier.clone(),
                effect: Effect::Unknown,
                reactive: false,
                loc: loc.clone(),
            },
            loc,
        },
    }
}

/// The extracted args of a manual-memo call (`extractManualMemoizationArgs`).
struct MemoDetails {
    fn_place: Place,
    deps_list: Option<Vec<ManualMemoDependency>>,
    deps_loc: Option<SourceLocation>,
}

/// `extractManualMemoizationArgs(instr, kind, sidemap, env)`: validate and
/// extract the `(fn, deps)` args of a manual-memo call. Returns `None` on an
/// invalid shape (the TS records a `UseMemo` error and bails; we mirror the bail
/// without surfacing diagnostics, since the default client path discards them).
fn extract_manual_memoization_args(
    args: &[CallArgument],
    sidemap: &IdentifierSidemap,
) -> Option<MemoDetails> {
    // args[0]: the memo function. Must be a plain identifier place.
    let fn_place = match args.first() {
        Some(CallArgument::Place(p)) => p.clone(),
        _ => return None,
    };
    // args[1]: the deps list, optional (`useMemo(fn)` is valid).
    let Some(deps_arg) = args.get(1) else {
        return Some(MemoDetails {
            fn_place,
            deps_list: None,
            deps_loc: None,
        });
    };
    let deps_place = match deps_arg {
        CallArgument::Place(p) => p,
        CallArgument::Spread(_) => return None,
    };
    let Some((deps_array_loc, deps_elements)) =
        sidemap.maybe_deps_lists.get(&deps_place.identifier.id)
    else {
        return None;
    };
    let mut deps_list = Vec::new();
    for dep in deps_elements {
        // The TS records an error for a non-simple dep but still continues (it
        // just doesn't push it). Mirror that: skip unrecognized deps.
        if let Some(resolved) = sidemap.maybe_deps.get(&dep.identifier.id) {
            deps_list.push(resolved.clone());
        }
    }
    Some(MemoDetails {
        fn_place,
        deps_list: Some(deps_list),
        deps_loc: Some(deps_array_loc.clone()),
    })
}

/// `findOptionalPlaces(fn)`: the identifier ids written within optional-chain
/// blocks, used to mark dependency-path entries optional. Walks the CFG from each
/// optional terminal backwards to the matching branch's consequent and records
/// the last `StoreLocal` value.
fn find_optional_places(func: &HirFunction) -> HashSet<IdentifierId> {
    let mut optionals = HashSet::new();
    for block in func.body.blocks() {
        let Terminal::Optional {
            optional: true,
            test,
            fallthrough: optional_fallthrough,
            ..
        } = &block.terminal
        else {
            continue;
        };
        let optional_fallthrough = *optional_fallthrough;
        let mut test_block_id = *test;
        loop {
            let Some(test_block) = func.body.block(test_block_id) else {
                break;
            };
            match &test_block.terminal {
                Terminal::Branch {
                    consequent,
                    fallthrough,
                    ..
                } => {
                    if *fallthrough == optional_fallthrough {
                        // Found it: record the last StoreLocal value in the
                        // consequent block.
                        if let Some(consequent_block) = func.body.block(*consequent) {
                            if let Some(last) = consequent_block.instructions.last() {
                                if let InstructionValue::StoreLocal { value, .. } = &last.value {
                                    optionals.insert(value.identifier.id);
                                }
                            }
                        }
                        break;
                    } else {
                        test_block_id = *fallthrough;
                    }
                }
                Terminal::Optional { fallthrough, .. }
                | Terminal::Logical { fallthrough, .. }
                | Terminal::Sequence { fallthrough, .. }
                | Terminal::Ternary { fallthrough, .. } => {
                    test_block_id = *fallthrough;
                }
                Terminal::MaybeThrow { continuation, .. } => {
                    test_block_id = *continuation;
                }
                _ => {
                    // The TS invariants here; an unexpected terminal cannot occur
                    // in a well-formed optional, so bail this optional rather than
                    // panicking.
                    break;
                }
            }
        }
    }
    optionals
}

/// Run `dropManualMemoization` on `func` in place. `is_validation_enabled`
/// mirrors the TS `isValidationEnabled` disjunction (the caller reads it from the
/// environment config); when set, `StartMemoize`/`FinishMemoize` markers are
/// emitted and instruction ids re-marked.
pub fn drop_manual_memoization(
    func: &mut HirFunction,
    ctx: &mut PassContext,
    is_validation_enabled: bool,
) {
    let optionals = find_optional_places(func);
    let mut sidemap = IdentifierSidemap {
        optionals,
        ..Default::default()
    };
    let mut next_manual_memo_id: u32 = 0;

    // Phase 1: rewrite manual-memo calls; queue marker inserts (instruction id ->
    // marker), anchored to the load instr (StartMemoize) and the call (FinishMemoize).
    let mut queued_inserts: HashMap<InstructionId, Instruction> = HashMap::new();

    let block_ids: Vec<_> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        let instr_count = func.body.block(block_id).unwrap().instructions.len();
        for i in 0..instr_count {
            // Determine the callee id for a call instruction.
            let (callee_id, is_call) = {
                let instr = &func.body.block(block_id).unwrap().instructions[i];
                match &instr.value {
                    InstructionValue::CallExpression { callee, .. } => {
                        (Some(callee.identifier.id), true)
                    }
                    InstructionValue::MethodCall { property, .. } => {
                        (Some(property.identifier.id), true)
                    }
                    _ => (None, false),
                }
            };

            if !is_call {
                let instr = &func.body.block(block_id).unwrap().instructions[i];
                collect_temporaries(instr, &mut sidemap);
                continue;
            }

            let Some(callee_id) = callee_id else { continue };
            let Some(manual_memo) = sidemap.manual_memos.get(&callee_id).cloned() else {
                // A call that is not a manual-memo callee still feeds the sidemap
                // via collectTemporaries (the TS only collects in the `else`
                // branch, i.e. for non-call instructions; calls otherwise do not
                // contribute). Match that: do nothing.
                continue;
            };

            let (args, call_loc, lvalue) = {
                let instr = &func.body.block(block_id).unwrap().instructions[i];
                let (args, loc) = match &instr.value {
                    InstructionValue::CallExpression { args, loc, .. } => (args.clone(), loc.clone()),
                    InstructionValue::MethodCall { args, loc, .. } => (args.clone(), loc.clone()),
                    _ => unreachable!(),
                };
                (args, loc, instr.lvalue.clone())
            };

            let Some(details) = extract_manual_memoization_args(&args, &sidemap) else {
                continue;
            };

            // Rewrite the call value in place.
            let replacement =
                get_manual_memoization_replacement(&details.fn_place, call_loc.clone(), manual_memo.kind);
            {
                let instr = &mut func.body.block_mut(block_id).unwrap().instructions[i];
                instr.value = replacement;
            }

            if is_validation_enabled {
                // Bail out when the memo function is not an inline function
                // expression: the validation assumes source depslists closely match
                // inferred deps (the exhaustive-deps lint only covers inline memo
                // functions). The TS records an error and `continue`s without
                // inserting markers.
                if !sidemap.functions.contains(&details.fn_place.identifier.id) {
                    continue;
                }

                let memo_decl: Place = match manual_memo.kind {
                    ManualMemoKind::UseMemo => lvalue.clone(),
                    ManualMemoKind::UseCallback => Place {
                        identifier: details.fn_place.identifier.clone(),
                        effect: Effect::Unknown,
                        reactive: false,
                        loc: details.fn_place.loc.clone(),
                    },
                };

                let manual_memo_id = next_manual_memo_id;
                next_manual_memo_id += 1;
                let fn_loc = details.fn_place.loc.clone();

                let start_marker = Instruction {
                    id: InstructionId::new(0),
                    lvalue: create_temporary_place(ctx, fn_loc.clone()),
                    value: InstructionValue::StartMemoize {
                        manual_memo_id,
                        deps: details.deps_list.clone(),
                        deps_loc: details.deps_loc.clone(),
                        has_invalid_deps: false,
                        loc: fn_loc.clone(),
                    },
                    loc: fn_loc.clone(),
                    effects: None,
                };
                let finish_marker = Instruction {
                    id: InstructionId::new(0),
                    lvalue: create_temporary_place(ctx, fn_loc.clone()),
                    value: InstructionValue::FinishMemoize {
                        manual_memo_id,
                        decl: memo_decl,
                        pruned: false,
                        loc: fn_loc.clone(),
                    },
                    loc: fn_loc,
                    effects: None,
                };

                // Anchor StartMemoize right after the hook load, FinishMemoize right
                // after the rewritten call.
                queued_inserts.insert(manual_memo.load_instr_id, start_marker);
                let call_id = func.body.block(block_id).unwrap().instructions[i].id;
                queued_inserts.insert(call_id, finish_marker);
            }
        }
    }

    // Phase 2: insert the queued markers right after their anchor instructions.
    if !queued_inserts.is_empty() {
        let mut has_changes = false;
        for block in func.body.blocks_mut() {
            let mut next_instructions: Option<Vec<Instruction>> = None;
            for i in 0..block.instructions.len() {
                let instr_id = block.instructions[i].id;
                if let Some(marker) = queued_inserts.remove(&instr_id) {
                    let buf = next_instructions
                        .get_or_insert_with(|| block.instructions[..i].to_vec());
                    buf.push(block.instructions[i].clone());
                    buf.push(marker);
                } else if let Some(buf) = next_instructions.as_mut() {
                    buf.push(block.instructions[i].clone());
                }
            }
            if let Some(buf) = next_instructions {
                block.instructions = buf;
                has_changes = true;
            }
        }
        if has_changes {
            mark_instruction_ids(&mut func.body);
        }
    }
}

/// `createTemporaryPlace(env, loc)`: a fresh unnamed temporary place with
/// `Effect::Unknown`, drawing its identifier id from the shared allocator.
fn create_temporary_place(ctx: &mut PassContext, loc: SourceLocation) -> Place {
    let id = ctx.next_identifier_id();
    Place {
        identifier: Identifier::make_temporary(id, crate::hir::ids::TypeId::new(0), loc),
        effect: Effect::Unknown,
        reactive: false,
        loc: SourceLocation::Generated,
    }
}

/// The hook kind a global *binding name* resolves to, matching the TS
/// `getHookKindForType(env, getGlobalDeclaration(binding))` for the only two
/// hooks this pass cares about. `useMemo`/`useCallback` are the React APIs whose
/// global declaration carries `hookKind: 'useMemo' | 'useCallback'`.
fn hook_kind_for_global(name: &str) -> Option<ManualMemoKind> {
    match name {
        "useMemo" => Some(ManualMemoKind::UseMemo),
        "useCallback" => Some(ManualMemoKind::UseCallback),
        _ => None,
    }
}

/// The hook kind a `React.<prop>` namespace access resolves to.
fn hook_kind_for_property(prop: &str) -> Option<ManualMemoKind> {
    match prop {
        "useMemo" => Some(ManualMemoKind::UseMemo),
        "useCallback" => Some(ManualMemoKind::UseCallback),
        _ => None,
    }
}

/// The local name of a `LoadGlobal` binding (the identifier the source wrote),
/// across the [`crate::hir::value::NonLocalBinding`] variants.
fn binding_name(binding: &crate::hir::value::NonLocalBinding) -> &str {
    use crate::hir::value::NonLocalBinding::*;
    match binding {
        ImportDefault { name, .. }
        | ImportNamespace { name, .. }
        | ImportSpecifier { name, .. }
        | ModuleLocal { name }
        | Global { name } => name,
    }
}

/// Whether an identifier carries a user-source (`named`) name.
pub(crate) fn is_named(identifier: &Identifier) -> bool {
    matches!(
        &identifier.name,
        Some(crate::hir::place::IdentifierName::Named { .. })
    )
}
