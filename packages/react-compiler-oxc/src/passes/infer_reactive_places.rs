//! `InferReactivePlaces` — port of `Inference/InferReactivePlaces.ts`.
//!
//! Marks each [`Place`] that may *semantically* change over the component/hook's
//! lifetime as `reactive` (rendered with the `{reactive}` suffix by `PrintHIR`).
//! A place is reactive if it derives from a source of reactivity:
//!
//!  * **Props** — function parameters are unconditionally reactive.
//!  * **Hooks / `use`** — `useState`/`useContext`/… and the `use()` operator may
//!    read state/context, so their results are reactive (unless stable-typed —
//!    see [`StableSidemap`]).
//!  * **Mutation with reactive operands** — a value mutated in an instruction that
//!    also has a reactive operand may capture the reactive reference.
//!  * **Conditional assignment under reactive control** — a phi whose block is
//!    controlled by a reactive condition.
//!
//! The algorithm is a forward fixpoint over the CFG that propagates reactivity
//! through aliasing (via [`findDisjointMutableValues`](super::infer_reactive_places))
//! and reactive control (via post-dominator frontiers). It iterates until no new
//! identifier becomes reactive, then propagates the resulting reactivity into
//! nested function bodies.
//!
//! ## Rust-vs-TS modeling note
//!
//! The TS shares one [`Identifier`](crate::hir::place::Identifier) object across
//! every [`Place`] that references the same SSA value, so its `DisjointSet<Identifier>`
//! canonicalizes by object identity (which == SSA-id identity). Our model clones
//! the identifier into each place, so we canonicalize by [`IdentifierId`] instead;
//! the result is identical because post-SSA ids are unique per value. The
//! `place.reactive` side effect of `isReactive`/`markReactive` is applied directly
//! to each visited place, exactly as the TS sets `place.reactive = true`.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::{BlockId, IdentifierId};
use crate::hir::model::HirFunction;
use crate::hir::place::{Effect, Identifier, Place, Type};
use crate::hir::value::InstructionValue;

use super::cfg::{
    each_instruction_lvalue_mut, each_instruction_value_operand_mut, each_terminal_operand_mut,
};
use super::control_dominators::ControlDominators;
use super::disjoint_set::DisjointSet;
use super::find_disjoint_mutable_values::find_disjoint_mutable_values;

/// `inferReactivePlaces(fn)`.
pub fn infer_reactive_places(func: &mut HirFunction) {
    let aliased = find_disjoint_mutable_values(func);
    let mut reactive = ReactivityMap::new(aliased);

    // Params are unconditionally reactive (props may change).
    for param in &mut func.params {
        let place = match param {
            crate::hir::model::FunctionParam::Place(p) => p,
            crate::hir::model::FunctionParam::Spread(s) => &mut s.place,
        };
        reactive.mark_reactive(place);
    }

    // Control-dominator predicate: a block is reactively controlled if some
    // post-dominator-frontier block branches on a reactive test. The predicate
    // is computed against the *current* reactive set on each query.
    let control = ControlDominators::new(func);

    loop {
        let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
        for block_id in block_ids {
            let has_reactive_control =
                control.is_reactive_controlled_block(func, block_id, &mut reactive);

            // --- Phis ---
            // Snapshot the operand/pred info we need (canonical ids + preds),
            // then apply reactivity. Phi places/operands get their `reactive`
            // flag set in place.
            let phi_count = func.body.block(block_id).expect("block").phis.len();
            for phi_index in 0..phi_count {
                // `isReactive(phi.place)`: skip if already reactive.
                {
                    let block = func.body.block_mut(block_id).expect("block");
                    let phi = &mut block.phis[phi_index];
                    if reactive.is_reactive(&mut phi.place) {
                        continue;
                    }
                }
                // Determine reactivity from operands (setting each operand's flag).
                let mut is_phi_reactive = false;
                {
                    let block = func.body.block_mut(block_id).expect("block");
                    let phi = &mut block.phis[phi_index];
                    for operand in phi.operands.values_mut() {
                        if reactive.is_reactive(operand) {
                            is_phi_reactive = true;
                            break;
                        }
                    }
                }
                if is_phi_reactive {
                    let block = func.body.block_mut(block_id).expect("block");
                    let phi = &mut block.phis[phi_index];
                    reactive.mark_reactive(&mut phi.place);
                } else {
                    // Any reactively-controlled predecessor makes the phi reactive.
                    let preds: Vec<BlockId> = {
                        let block = func.body.block(block_id).expect("block");
                        block.phis[phi_index].operands.keys().copied().collect()
                    };
                    for pred in preds {
                        if control.is_reactive_controlled_block(func, pred, &mut reactive) {
                            let block = func.body.block_mut(block_id).expect("block");
                            let phi = &mut block.phis[phi_index];
                            reactive.mark_reactive(&mut phi.place);
                            break;
                        }
                    }
                }
            }

            // --- Instructions ---
            let instr_count = func.body.block(block_id).expect("block").instructions.len();
            for i in 0..instr_count {
                // StableSidemap forward tracking.
                {
                    let block = func.body.block(block_id).expect("block");
                    reactive.stable.handle_instruction(&block.instructions[i]);
                }

                let block = func.body.block_mut(block_id).expect("block");
                let instr = &mut block.instructions[i];

                // Read every operand (marking its `reactive` flag), without
                // short-circuiting, accumulating whether any input is reactive.
                let mut has_reactive_input = false;
                for operand in each_instruction_value_operand_mut(&mut instr.value) {
                    let r = reactive.is_reactive(operand);
                    has_reactive_input |= r;
                }

                // Hooks and the `use` operator are reactivity sources.
                if is_hook_or_use_call(&instr.value) {
                    has_reactive_input = true;
                }

                if has_reactive_input {
                    // Mark each lvalue reactive unless it is a stable source.
                    for lvalue in each_instruction_lvalue_mut(instr) {
                        if reactive.stable.is_stable(lvalue.identifier.id) {
                            continue;
                        }
                        reactive.reactive_set_mark(lvalue);
                    }
                }
                if has_reactive_input || has_reactive_control {
                    // Propagate reactivity to mutated operands within the
                    // operand's mutable range.
                    let instr_id = instr.id;
                    for operand in each_instruction_value_operand_mut(&mut instr.value) {
                        match operand.effect {
                            Effect::Capture
                            | Effect::Store
                            | Effect::ConditionallyMutate
                            | Effect::ConditionallyMutateIterator
                            | Effect::Mutate => {
                                if is_mutable(instr_id, operand) {
                                    reactive.reactive_set_mark(operand);
                                }
                            }
                            // Freeze / Read: no-op. Unknown should not occur here
                            // (ranges resolved every effect); treat as no-op.
                            _ => {}
                        }
                    }
                }
            }

            // --- Terminal operands ---
            let block = func.body.block_mut(block_id).expect("block");
            for operand in each_terminal_operand_mut(&mut block.terminal) {
                reactive.is_reactive(operand);
            }
        }

        if !reactive.snapshot() {
            break;
        }
    }

    // Propagate reactivity into nested functions (read all operands so their
    // `reactive` flags are set where the canonical id is reactive).
    propagate_to_inner_functions(func, true, &mut reactive);
}

/// `propagateReactivityToInnerFunctions(fn, isOutermost)`.
fn propagate_to_inner_functions(
    func: &mut HirFunction,
    is_outermost: bool,
    reactive: &mut ReactivityMap,
) {
    for block in func.body.blocks_mut() {
        for instr in &mut block.instructions {
            if !is_outermost {
                for operand in each_instruction_value_operand_mut(&mut instr.value) {
                    reactive.is_reactive(operand);
                }
            }
            match &mut instr.value {
                InstructionValue::ObjectMethod { lowered_func, .. }
                | InstructionValue::FunctionExpression { lowered_func, .. } => {
                    propagate_to_inner_functions(&mut lowered_func.func, false, reactive);
                }
                _ => {}
            }
        }
        if !is_outermost {
            for operand in each_terminal_operand_mut(&mut block.terminal) {
                reactive.is_reactive(operand);
            }
        }
    }
}

/// `isMutable(instr, place)` = `inRange(instr, place.identifier.mutableRange)`:
/// `id >= range.start && id < range.end`.
fn is_mutable(instr_id: crate::hir::ids::InstructionId, place: &Place) -> bool {
    let range = &place.identifier.mutable_range;
    instr_id.as_u32() >= range.start.as_u32() && instr_id.as_u32() < range.end.as_u32()
}

/// Whether the value is a hook call or a `use()` call (`getHookKind != null ||
/// isUseOperator`), checked on the callee/property identifier's type.
fn is_hook_or_use_call(value: &InstructionValue) -> bool {
    match value {
        InstructionValue::CallExpression { callee, .. } => {
            get_hook_kind(&callee.identifier).is_some() || is_use_operator(&callee.identifier)
        }
        InstructionValue::MethodCall { property, .. } => {
            get_hook_kind(&property.identifier).is_some() || is_use_operator(&property.identifier)
        }
        _ => false,
    }
}

/// `getHookKind(env, id)` — the [`HookKind`] of a function-typed identifier,
/// keyed by its shape id (the TS reads `signature.hookKind`).
///
/// `useState`/`useRef` are distinguished (they produce stable types). Every other
/// hook — the built-in effect/memo hooks (`useEffect`, `useLayoutEffect`,
/// `useMemo`, `useCallback`, …) and any user custom hook — resolves to the
/// `DefaultNonmutatingHook`/`DefaultMutatingHook` shape (or a pinned React-API
/// generated id) and maps to [`HookKind::Custom`]. Callers that only check
/// `is_some()` (hook-call detection, the hook-argument escape rule in
/// `PruneNonEscapingScopes`) therefore fire for *all* hooks, matching the TS.
pub(crate) fn get_hook_kind(id: &Identifier) -> Option<HookKind> {
    let Type::Function { shape_id: Some(shape), .. } = &id.type_ else {
        return None;
    };
    use crate::environment::shapes::{
        BUILTIN_USE_CONTEXT_HOOK_ID, BUILTIN_USE_EFFECT_HOOK_ID, BUILTIN_USE_EFFECT_EVENT_ID,
        BUILTIN_USE_INSERTION_EFFECT_HOOK_ID, BUILTIN_USE_LAYOUT_EFFECT_HOOK_ID,
        DEFAULT_MUTATING_HOOK_ID, DEFAULT_NONMUTATING_HOOK_ID, GENERATED_REANIMATED_FROZEN_HOOK_ID,
        GENERATED_REANIMATED_MUTABLE_HOOK_ID, GENERATED_USE_ACTION_STATE_ID,
        GENERATED_USE_CALLBACK_ID, GENERATED_USE_FRAGMENT_ID, GENERATED_USE_FREEZE_ID,
        GENERATED_USE_IMPERATIVE_HANDLE_ID, GENERATED_USE_MEMO_ID, GENERATED_USE_NO_ALIAS_ID,
        GENERATED_USE_OPTIMISTIC_ID, GENERATED_USE_REDUCER_ID, GENERATED_USE_REF_ID,
        GENERATED_USE_STATE_ID, GENERATED_USE_TRANSITION_ID,
    };
    match shape.as_str() {
        GENERATED_USE_STATE_ID => Some(HookKind::UseState),
        GENERATED_USE_REF_ID => Some(HookKind::UseRef),
        // The remaining stable-container hooks (`useReducer`/`useActionState`/
        // `useTransition`/`useOptimistic`): like `useState`, their results are
        // stable-typed (the destructured setter/dispatcher is non-reactive), which
        // `evaluatesToStableTypeOrContainer` keys on.
        GENERATED_USE_REDUCER_ID => Some(HookKind::UseReducer),
        GENERATED_USE_ACTION_STATE_ID => Some(HookKind::UseActionState),
        GENERATED_USE_TRANSITION_ID => Some(HookKind::UseTransition),
        GENERATED_USE_OPTIMISTIC_ID => Some(HookKind::UseOptimistic),
        // The two generic custom-hook shapes (the fallback for every user hook) and
        // the pinned `useMemo`/`useCallback` React-API shapes are all hooks for
        // escape/hook-call purposes. The typed React-namespace effect/context hooks
        // (`React.useEffect`/`useLayoutEffect`/`useInsertionEffect`/`useContext`/
        // `useImperativeHandle`/`useEffectEvent`) carry a `hookKind` in `Globals.ts`,
        // so `getHookKindForType` returns non-null for them too — they collapse to
        // `Custom` since the reactive/stable analysis only needs "is a hook" (the
        // hook call's result is a source of reactivity).
        DEFAULT_NONMUTATING_HOOK_ID
        | DEFAULT_MUTATING_HOOK_ID
        | GENERATED_USE_MEMO_ID
        | GENERATED_USE_CALLBACK_ID
        | GENERATED_USE_IMPERATIVE_HANDLE_ID
        | BUILTIN_USE_CONTEXT_HOOK_ID
        | BUILTIN_USE_EFFECT_HOOK_ID
        | BUILTIN_USE_LAYOUT_EFFECT_HOOK_ID
        | BUILTIN_USE_INSERTION_EFFECT_HOOK_ID
        | BUILTIN_USE_EFFECT_EVENT_ID
        // The typed `shared-runtime` hooks installed by the module type provider
        // (`useFreeze`/`useFragment`/`useNoAlias`): all `hookKind: 'Custom'`.
        | GENERATED_USE_FREEZE_ID
        | GENERATED_USE_FRAGMENT_ID
        | GENERATED_USE_NO_ALIAS_ID
        // The typed `react-native-reanimated` hooks (frozen + mutable shared-value
        // hooks from `getReanimatedModuleType`): all `hookKind: 'Custom'`.
        | GENERATED_REANIMATED_FROZEN_HOOK_ID
        | GENERATED_REANIMATED_MUTABLE_HOOK_ID => Some(HookKind::Custom),
        _ => None,
    }
}

/// `isUseOperator(id)`: a function whose shape id is `BuiltInUseOperator`.
pub(crate) fn is_use_operator(id: &Identifier) -> bool {
    matches!(&id.type_, Type::Function { shape_id: Some(s), .. } if s == "BuiltInUseOperator")
}

/// The hook kinds the reactive/stable analysis distinguishes (`HookKind`,
/// restricted to those the curated fixtures reach).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HookKind {
    /// `useState`.
    UseState,
    /// `useRef`.
    UseRef,
    /// `useReducer`.
    UseReducer,
    /// `useActionState`.
    UseActionState,
    /// `useTransition`.
    UseTransition,
    /// `useOptimistic`.
    UseOptimistic,
    /// Any other hook (built-in effect/memo hook or user custom hook). The TS
    /// distinguishes these further (`useEffect`, `Custom`, …); the reactive/stable
    /// analysis only needs "is a hook", so they collapse to one variant.
    Custom,
}

/// `evaluatesToStableTypeOrContainer(env, instr)`: whether the instruction is a
/// call/method-call to a hook whose result is a stable type or stable container
/// (`useState`/`useReducer`/`useActionState`/`useRef`/`useTransition`/`useOptimistic`).
fn evaluates_to_stable_type_or_container(value: &InstructionValue) -> bool {
    let callee = match value {
        InstructionValue::CallExpression { callee, .. } => callee,
        InstructionValue::MethodCall { property, .. } => property,
        _ => return false,
    };
    matches!(
        get_hook_kind(&callee.identifier),
        Some(
            HookKind::UseState
                | HookKind::UseReducer
                | HookKind::UseActionState
                | HookKind::UseRef
                | HookKind::UseTransition
                | HookKind::UseOptimistic
        )
    )
}

/// `isStableType(id)`: the result is a stable, identity-preserving value
/// (`setState` / `setActionState` / dispatcher / ref / `startTransition` /
/// `setOptimistic`).
fn is_stable_type(id: &Identifier) -> bool {
    let ty = &id.type_;
    let is_fn_shape = |s: &str| matches!(ty, Type::Function { shape_id: Some(x), .. } if x == s);
    let is_obj_shape = |s: &str| matches!(ty, Type::Object { shape_id: Some(x) } if x == s);
    is_fn_shape("BuiltInSetState")
        || is_fn_shape("BuiltInSetActionState")
        || is_fn_shape("BuiltInDispatch")
        || is_obj_shape("BuiltInUseRefId")
        || is_fn_shape("BuiltInStartTransition")
        || is_fn_shape("BuiltInSetOptimistic")
}

/// `isStableTypeContainer(id)`: an object whose elements include a stable value
/// (`useState` / `useActionState` / `useReducer` / `useOptimistic` /
/// `useTransition` tuples).
fn is_stable_type_container(id: &Identifier) -> bool {
    let Type::Object { shape_id } = &id.type_ else {
        return false;
    };
    let Some(s) = shape_id else { return false };
    matches!(
        s.as_str(),
        "BuiltInUseState"
            | "BuiltInUseActionState"
            | "BuiltInUseReducer"
            | "BuiltInUseOptimistic"
            | "BuiltInUseTransition"
    )
}

/// `StableSidemap`: forward-tracks identifiers producing stable values so they
/// are not falsely marked reactive (e.g. `useRef()` / `useState()[1]`).
struct StableSidemap {
    map: HashMap<IdentifierId, bool>,
}

impl StableSidemap {
    fn new() -> Self {
        StableSidemap {
            map: HashMap::new(),
        }
    }

    fn handle_instruction(&mut self, instr: &crate::hir::instruction::Instruction) {
        let lvalue_id = instr.lvalue.identifier.id;
        match &instr.value {
            InstructionValue::CallExpression { .. } | InstructionValue::MethodCall { .. } => {
                if evaluates_to_stable_type_or_container(&instr.value) {
                    let stable = is_stable_type(&instr.lvalue.identifier);
                    self.map.insert(lvalue_id, stable);
                }
            }
            InstructionValue::Destructure { value, .. } => {
                let source = value.identifier.id;
                if self.map.contains_key(&source) {
                    for lvalue in instruction_lvalues(instr) {
                        self.set_extracted(lvalue);
                    }
                }
            }
            InstructionValue::PropertyLoad { object, .. } => {
                let source = object.identifier.id;
                if self.map.contains_key(&source) {
                    for lvalue in instruction_lvalues(instr) {
                        self.set_extracted(lvalue);
                    }
                }
            }
            InstructionValue::StoreLocal { value, lvalue, .. } => {
                if let Some(&entry) = self.map.get(&value.identifier.id) {
                    self.map.insert(lvalue_id, entry);
                    self.map.insert(lvalue.place.identifier.id, entry);
                }
            }
            InstructionValue::LoadLocal { place, .. } => {
                if let Some(&entry) = self.map.get(&place.identifier.id) {
                    self.map.insert(lvalue_id, entry);
                }
            }
            _ => {}
        }
    }

    /// Mark an extracted lvalue's stability based on its own type
    /// (container → not stable, stable type → stable; else untouched).
    fn set_extracted(&mut self, id: &Identifier) {
        if is_stable_type_container(id) {
            self.map.insert(id.id, false);
        } else if is_stable_type(id) {
            self.map.insert(id.id, true);
        }
    }

    fn is_stable(&self, id: IdentifierId) -> bool {
        self.map.get(&id).copied().unwrap_or(false)
    }
}

/// `eachInstructionLValue(instr)` as owned identifier references: `instr.lvalue`
/// then the value-level lvalues, in TS order.
fn instruction_lvalues(instr: &crate::hir::instruction::Instruction) -> Vec<&Identifier> {
    let mut out: Vec<&Identifier> = vec![&instr.lvalue.identifier];
    match &instr.value {
        InstructionValue::DeclareLocal { lvalue, .. }
        | InstructionValue::StoreLocal { lvalue, .. } => out.push(&lvalue.place.identifier),
        InstructionValue::DeclareContext { place, .. }
        | InstructionValue::StoreContext { place, .. } => out.push(&place.identifier),
        InstructionValue::Destructure { lvalue, .. } => {
            push_pattern_identifiers(&mut out, &lvalue.pattern);
        }
        InstructionValue::PostfixUpdate { lvalue, .. }
        | InstructionValue::PrefixUpdate { lvalue, .. } => out.push(&lvalue.identifier),
        _ => {}
    }
    out
}

fn push_pattern_identifiers<'a>(
    out: &mut Vec<&'a Identifier>,
    pattern: &'a crate::hir::value::Pattern,
) {
    use crate::hir::value::{ArrayPatternItem, ObjectPatternProperty, Pattern};
    match pattern {
        Pattern::Array(array) => {
            for item in &array.items {
                match item {
                    ArrayPatternItem::Place(place) => out.push(&place.identifier),
                    ArrayPatternItem::Spread(spread) => out.push(&spread.place.identifier),
                    ArrayPatternItem::Hole => {}
                }
            }
        }
        Pattern::Object(object) => {
            for property in &object.properties {
                match property {
                    ObjectPatternProperty::Property(p) => out.push(&p.place.identifier),
                    ObjectPatternProperty::Spread(s) => out.push(&s.place.identifier),
                }
            }
        }
    }
}

/// `ReactivityMap`: the reactive identifier set + the mutable-alias disjoint set
/// + the change flag, plus the [`StableSidemap`] (kept here for borrow locality).
pub(crate) struct ReactivityMap {
    has_changes: bool,
    reactive: HashSet<IdentifierId>,
    aliased: DisjointSet<IdentifierId>,
    stable: StableSidemap,
}

impl ReactivityMap {
    fn new(aliased: DisjointSet<IdentifierId>) -> Self {
        ReactivityMap {
            has_changes: false,
            reactive: HashSet::new(),
            aliased,
            stable: StableSidemap::new(),
        }
    }

    /// The canonical id for `id` per the alias disjoint set (or `id` itself).
    fn canonical(&mut self, id: IdentifierId) -> IdentifierId {
        self.aliased.find(id).unwrap_or(id)
    }

    /// `isReactive(place)`: whether the place's (canonical) identifier is
    /// reactive; sets `place.reactive = true` as a side effect when so.
    pub(crate) fn is_reactive(&mut self, place: &mut Place) -> bool {
        let canonical = self.canonical(place.identifier.id);
        let reactive = self.reactive.contains(&canonical);
        if reactive {
            place.reactive = true;
        }
        reactive
    }

    /// `markReactive(place)`: set `place.reactive = true` and add the canonical
    /// id to the reactive set (flagging a change if newly added).
    fn mark_reactive(&mut self, place: &mut Place) {
        place.reactive = true;
        let canonical = self.canonical(place.identifier.id);
        if self.reactive.insert(canonical) {
            self.has_changes = true;
        }
    }

    /// As [`mark_reactive`](Self::mark_reactive) but named to read clearly at the
    /// lvalue/operand mutation call sites.
    fn reactive_set_mark(&mut self, place: &mut Place) {
        self.mark_reactive(place);
    }

    /// `snapshot()`: returns whether any change occurred since the last call,
    /// resetting the flag.
    fn snapshot(&mut self) -> bool {
        let changed = self.has_changes;
        self.has_changes = false;
        changed
    }
}
