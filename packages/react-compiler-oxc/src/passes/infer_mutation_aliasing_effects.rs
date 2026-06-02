//! `InferMutationAliasingEffects` — port of
//! `Inference/InferMutationAliasingEffects.ts`.
//!
//! Computes the `effects` list on every instruction and select terminals via an
//! abstract-interpretation fixpoint. Phase 1 computes a syntactic
//! [`InstructionSignature`] per instruction; phase 2 applies it against the
//! inference state ([`InferenceState`]) to produce the precise effects.
//!
//! Fidelity notes vs the TS: the TS keys `#values` on `InstructionValue` object
//! identity. Here each `initialize` mints a fresh [`ValueId`]; synthetic values
//! created inside effects (`Create`/`CreateFrom`/`Assign`) are cached per
//! interned-effect hash (`effectInstructionValueCache`) so the same value id is
//! reused across fixpoint iterations, matching the TS's stable object identity.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use crate::environment::shapes::get_function_signature;
use crate::hir::ids::{BlockId, IdentifierId};
use crate::hir::instruction::{
    AliasingEffect, AliasingSignature, ApplyArg, CallSignature, Instruction, LegacyEffect,
    MutationReason, SigEffect, SigPlace,
};
use crate::hir::model::HirFunction;
use crate::hir::place::{
    Effect, Identifier, Place, SourceLocation, Type, ValueKind, ValueReason,
};
use crate::hir::terminal::Terminal;
use crate::hir::model::FunctionParam;
use crate::hir::value::{
    ArrayElement, CallArgument, InstructionKind, InstructionValue, JsxAttribute, JsxTag,
    ObjectExpressionProperty, Pattern, PropertyLiteral,
};
use crate::passes::cfg::{each_instruction_value_operand, each_terminal_successor};
use crate::passes::infer_reactive_places::get_hook_kind;

/// A synthetic identity for an abstract value (`InstructionValue` object identity
/// in the TS `#values` map).
type ValueId = u32;

/// Mutation outcome (`state.mutate` return).
#[derive(Clone, Copy, PartialEq, Eq)]
enum MutationOutcome {
    None,
    Mutate,
    MutateFrozen,
    MutateGlobal,
    MutateRef,
}

/// The kind of mutation requested.
#[derive(Clone, Copy, PartialEq, Eq)]
enum MutateVariant {
    Mutate,
    MutateConditionally,
    MutateTransitive,
    MutateTransitiveConditionally,
}

/// An abstract value: a kind plus the set of reasons (`AbstractValue`).
#[derive(Clone, PartialEq)]
struct AbstractValue {
    kind: ValueKind,
    reason: BTreeSet<ReasonKey>,
}

/// `ValueReason` as an orderable key (so the reason set is deterministic).
type ReasonKey = u8;

fn reason_key(r: ValueReason) -> ReasonKey {
    match r {
        ValueReason::Global => 0,
        ValueReason::JsxCaptured => 1,
        ValueReason::HookCaptured => 2,
        ValueReason::HookReturn => 3,
        ValueReason::Effect => 4,
        ValueReason::KnownReturnSignature => 5,
        ValueReason::Context => 6,
        ValueReason::State => 7,
        ValueReason::ReducerState => 8,
        ValueReason::ReactiveFunctionArgument => 9,
        ValueReason::Other => 10,
    }
}

fn reason_from_key(k: ReasonKey) -> ValueReason {
    match k {
        0 => ValueReason::Global,
        1 => ValueReason::JsxCaptured,
        2 => ValueReason::HookCaptured,
        3 => ValueReason::HookReturn,
        4 => ValueReason::Effect,
        5 => ValueReason::KnownReturnSignature,
        6 => ValueReason::Context,
        7 => ValueReason::State,
        8 => ValueReason::ReducerState,
        9 => ValueReason::ReactiveFunctionArgument,
        _ => ValueReason::Other,
    }
}

fn single_reason(r: ValueReason) -> BTreeSet<ReasonKey> {
    let mut s = BTreeSet::new();
    s.insert(reason_key(r));
    s
}

/// The abstract-interpretation state (`InferenceState`).
#[derive(Clone)]
struct InferenceState {
    is_function_expression: bool,
    /// The TS `freezeValue` gate (`env.config.enablePreserveExistingMemoizationGuarantees
    /// || env.config.enableTransitivelyFreezeFunctionExpressions`): when set,
    /// freezing a FunctionExpression value transitively freezes its captured
    /// context places.
    transitively_freeze_fn_exprs: bool,
    values: HashMap<ValueId, AbstractValue>,
    /// Which value ids back each identifier (`InferenceState.#variables`), used
    /// by `freezeValue`'s transitive-freeze of function captures.
    variables: HashMap<IdentifierId, BTreeSet<ValueId>>,
    /// Value ids that back a `FunctionExpression`/`ObjectMethod` value, mapped to
    /// the data needed to build an aliasing signature for a call to that locally
    /// declared function (the TS `state.values(fn)[0].kind === 'FunctionExpression'`
    /// + `buildSignatureFromFunctionExpression` path).
    fn_expr_values: HashMap<ValueId, std::rc::Rc<crate::hir::instruction::FnExprSignatureData>>,
    /// `env.config.validateNoImpureFunctionsInRender`: gates emitting an `Impure`
    /// effect for a known-impure call signature (the `purity` lint rule).
    validate_no_impure: bool,
}

impl InferenceState {
    fn empty(
        is_function_expression: bool,
        transitively_freeze_fn_exprs: bool,
        validate_no_impure: bool,
    ) -> Self {
        InferenceState {
            is_function_expression,
            transitively_freeze_fn_exprs,
            values: HashMap::new(),
            variables: HashMap::new(),
            fn_expr_values: HashMap::new(),
            validate_no_impure,
        }
    }

    /// Resolve the single backing FunctionExpression signature data for `place`,
    /// if (and only if) `place` is backed by exactly one value and that value is a
    /// FunctionExpression with aliasing effects (mirrors the TS guard
    /// `functionValues.length === 1 && functionValues[0].kind === 'FunctionExpression'`).
    fn single_fn_expr(
        &self,
        place: &Place,
    ) -> Option<std::rc::Rc<crate::hir::instruction::FnExprSignatureData>> {
        let ids = self.variables.get(&place.identifier.id)?;
        if ids.len() != 1 {
            return None;
        }
        let id = *ids.iter().next()?;
        self.fn_expr_values.get(&id).cloned()
    }

    /// True if `value` backs a FunctionExpression whose params have a non-trivial
    /// mutable range (`range.end > range.start + 1`) — i.e. a lambda that may
    /// mutate its inputs. Used by `areArgumentsImmutableAndNonMutating`'s second
    /// check (`InferMutationAliasingEffects.ts:2546-2558`).
    fn fn_expr_has_mutating_param(&self, value: ValueId) -> bool {
        let Some(data) = self.fn_expr_values.get(&value) else {
            return false;
        };
        data.param_places.iter().any(|p| {
            let range = p.identifier.mutable_range;
            range.end.as_u32() > range.start.as_u32() + 1
        })
    }

    fn initialize(&mut self, value: ValueId, kind: AbstractValue) {
        self.values.insert(value, kind);
    }

    fn define(&mut self, place: &Place, value: ValueId) {
        let mut set = BTreeSet::new();
        set.insert(value);
        self.variables.insert(place.identifier.id, set);
    }

    fn value_ids(&self, place: &Place) -> Vec<ValueId> {
        self.variables
            .get(&place.identifier.id)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default()
    }

    /// `kind(place)`: merge all value kinds for the place.
    fn kind(&self, place: &Place) -> AbstractValue {
        let ids = self
            .variables
            .get(&place.identifier.id)
            .cloned()
            .unwrap_or_default();
        let mut merged: Option<AbstractValue> = None;
        for id in ids {
            if let Some(v) = self.values.get(&id) {
                merged = Some(match merged {
                    None => v.clone(),
                    Some(m) => merge_abstract_values(&m, v),
                });
            }
        }
        merged.unwrap_or(AbstractValue {
            // Uninitialized fallback: the TS invariants; for our purposes treat
            // as primitive (this should not happen for well-formed input).
            kind: ValueKind::Primitive,
            reason: single_reason(ValueReason::Other),
        })
    }

    fn assign(&mut self, place: &Place, value: &Place) {
        let values = self
            .variables
            .get(&value.identifier.id)
            .cloned()
            .unwrap_or_default();
        self.variables.insert(place.identifier.id, values);
    }

    fn append_alias(&mut self, place: &Place, value: &Place) {
        let values = self
            .variables
            .get(&value.identifier.id)
            .cloned()
            .unwrap_or_default();
        let mut prev = self
            .variables
            .get(&place.identifier.id)
            .cloned()
            .unwrap_or_default();
        for v in values {
            prev.insert(v);
        }
        self.variables.insert(place.identifier.id, prev);
    }

    /// `freeze(place, reason)`: marks `place` as transitively frozen. Returns true
    /// if the value was not already frozen/immutable.
    fn freeze(&mut self, place: &Place, reason: ValueReason) -> bool {
        let value = self.kind(place);
        match value.kind {
            ValueKind::Context | ValueKind::Mutable | ValueKind::MaybeFrozen => {
                let ids = self.value_ids(place);
                for id in ids {
                    self.freeze_value(id, reason);
                }
                true
            }
            ValueKind::Frozen | ValueKind::Global | ValueKind::Primitive => false,
        }
    }

    /// `freezeValue(value, reason)`: set the value id frozen, and — when the
    /// FunctionExpression-transitive-freeze gate is on — recursively freeze the
    /// captured context of any FunctionExpression backing that value
    /// (`InferMutationAliasingEffects.ts:1461-1475`).
    fn freeze_value(&mut self, value: ValueId, reason: ValueReason) {
        self.values.insert(
            value,
            AbstractValue {
                kind: ValueKind::Frozen,
                reason: single_reason(reason),
            },
        );
        if self.transitively_freeze_fn_exprs
            && let Some(data) = self.fn_expr_values.get(&value).cloned()
        {
            for place in &data.context {
                self.freeze(place, reason);
            }
        }
    }

    fn mutate(&self, variant: MutateVariant, place: &Place) -> MutationOutcome {
        if is_ref_or_ref_value(&place.identifier) {
            return MutationOutcome::MutateRef;
        }
        let kind = self.kind(place).kind;
        match variant {
            MutateVariant::MutateConditionally | MutateVariant::MutateTransitiveConditionally => {
                match kind {
                    ValueKind::Mutable | ValueKind::Context => MutationOutcome::Mutate,
                    _ => MutationOutcome::None,
                }
            }
            MutateVariant::Mutate | MutateVariant::MutateTransitive => match kind {
                ValueKind::Mutable | ValueKind::Context => MutationOutcome::Mutate,
                ValueKind::Primitive => MutationOutcome::None,
                ValueKind::Frozen => MutationOutcome::MutateFrozen,
                ValueKind::Global => MutationOutcome::MutateGlobal,
                ValueKind::MaybeFrozen => MutationOutcome::MutateFrozen,
            },
        }
    }

    /// `merge(other)`: combine, returning `Some` if anything changed.
    fn merge(&self, other: &InferenceState) -> Option<InferenceState> {
        let mut next_values: Option<HashMap<ValueId, AbstractValue>> = None;
        let mut next_variables: Option<HashMap<IdentifierId, BTreeSet<ValueId>>> = None;

        for (id, this_value) in &self.values {
            if let Some(other_value) = other.values.get(id) {
                let merged = merge_abstract_values(this_value, other_value);
                if &merged != this_value {
                    let m = next_values.get_or_insert_with(|| self.values.clone());
                    m.insert(*id, merged);
                }
            }
        }
        for (id, other_value) in &other.values {
            if self.values.contains_key(id) {
                continue;
            }
            let m = next_values.get_or_insert_with(|| self.values.clone());
            m.insert(*id, other_value.clone());
        }

        for (id, this_values) in &self.variables {
            if let Some(other_values) = other.variables.get(id) {
                let mut merged: Option<BTreeSet<ValueId>> = None;
                for other_value in other_values {
                    if !this_values.contains(other_value) {
                        let m = merged.get_or_insert_with(|| this_values.clone());
                        m.insert(*other_value);
                    }
                }
                if let Some(merged) = merged {
                    let m = next_variables.get_or_insert_with(|| self.variables.clone());
                    m.insert(*id, merged);
                }
            }
        }
        for (id, other_values) in &other.variables {
            if self.variables.contains_key(id) {
                continue;
            }
            let m = next_variables.get_or_insert_with(|| self.variables.clone());
            m.insert(*id, other_values.clone());
        }

        if next_values.is_none() && next_variables.is_none() {
            None
        } else {
            // `fn_expr_values` is keyed by globally-unique value ids registered
            // exactly once, so the union is just self's entries plus any of
            // other's that self lacks (the two always agree on shared ids).
            let mut fn_expr_values = self.fn_expr_values.clone();
            for (id, data) in &other.fn_expr_values {
                fn_expr_values.entry(*id).or_insert_with(|| data.clone());
            }
            Some(InferenceState {
                is_function_expression: self.is_function_expression,
                transitively_freeze_fn_exprs: self.transitively_freeze_fn_exprs,
                values: next_values.unwrap_or_else(|| self.values.clone()),
                variables: next_variables.unwrap_or_else(|| self.variables.clone()),
                fn_expr_values,
                validate_no_impure: self.validate_no_impure,
            })
        }
    }

    fn infer_phi(&mut self, phi: &crate::hir::model::Phi) {
        let mut values: BTreeSet<ValueId> = BTreeSet::new();
        for (_, operand) in phi.operands.iter() {
            if let Some(operand_values) = self.variables.get(&operand.identifier.id) {
                for v in operand_values {
                    values.insert(*v);
                }
            }
        }
        if !values.is_empty() {
            self.variables.insert(phi.place.identifier.id, values);
        }
    }
}

/// `mergeAbstractValues(a, b)`.
fn merge_abstract_values(a: &AbstractValue, b: &AbstractValue) -> AbstractValue {
    let kind = merge_value_kinds(a.kind, b.kind);
    if kind == a.kind && kind == b.kind && a.reason.is_superset(&b.reason) {
        return a.clone();
    }
    let mut reason = a.reason.clone();
    for r in &b.reason {
        reason.insert(*r);
    }
    AbstractValue { kind, reason }
}

/// `mergeValueKinds(a, b)`.
fn merge_value_kinds(a: ValueKind, b: ValueKind) -> ValueKind {
    use ValueKind::*;
    if a == b {
        a
    } else if a == MaybeFrozen || b == MaybeFrozen {
        MaybeFrozen
    } else if a == Mutable || b == Mutable {
        if a == Frozen || b == Frozen {
            MaybeFrozen
        } else if a == Context || b == Context {
            Context
        } else {
            Mutable
        }
    } else if a == Context || b == Context {
        if a == Frozen || b == Frozen {
            MaybeFrozen
        } else {
            Context
        }
    } else if a == Frozen || b == Frozen {
        Frozen
    } else if a == Global || b == Global {
        Global
    } else {
        Primitive
    }
}

// ---- Type predicates (HIR.ts) ----

fn is_primitive_type(id: &Identifier) -> bool {
    matches!(id.type_, Type::Primitive)
}

fn has_shape(id: &Identifier, shape: &str) -> bool {
    matches!(&id.type_, Type::Object { shape_id: Some(s) } if s == shape)
}

fn is_array_type(id: &Identifier) -> bool {
    has_shape(id, "BuiltInArray")
}

fn is_set_type(id: &Identifier) -> bool {
    has_shape(id, "BuiltInSet")
}

fn is_map_type(id: &Identifier) -> bool {
    has_shape(id, "BuiltInMap")
}

fn is_use_ref_type(id: &Identifier) -> bool {
    has_shape(id, "BuiltInUseRefId")
}

fn is_ref_value_type(id: &Identifier) -> bool {
    has_shape(id, "BuiltInRefValue")
}

fn is_ref_or_ref_value(id: &Identifier) -> bool {
    is_use_ref_type(id) || is_ref_value_type(id)
}

fn is_jsx_type(type_: &Type) -> bool {
    matches!(type_, Type::Object { shape_id: Some(s) } if s == "BuiltInJsx")
}

/// `conditionallyMutateIterator(place)`.
fn conditionally_mutate_iterator(place: &Place) -> Option<AliasingEffect> {
    if !(is_array_type(&place.identifier)
        || is_set_type(&place.identifier)
        || is_map_type(&place.identifier))
    {
        Some(AliasingEffect::MutateTransitiveConditionally {
            value: place.clone(),
        })
    } else {
        None
    }
}

/// The inference context (`Context`), holding per-function caches.
struct Context {
    is_function_expression: bool,
    /// `effectInstructionValueCache`: synthetic value id per interned effect hash.
    effect_value_cache: HashMap<String, ValueId>,
    /// `instructionSignatureCache`: signature per instruction id.
    signature_cache: HashMap<u32, Vec<AliasingEffect>>,
    catch_handlers: HashMap<BlockId, Place>,
    hoisted_context_declarations: HashMap<crate::hir::ids::DeclarationId, Option<SourceLocation>>,
    non_mutating_spreads: HashSet<IdentifierId>,
    next_value_id: ValueId,
    /// Context-operand effect downgrades produced by the `CreateFunction` apply
    /// path for the instruction currently being applied: identifier ids whose
    /// context operand `effect` should be downgraded from `Capture` to `Read`
    /// (because the captured value resolved to Primitive/Frozen/Global). Mirrors
    /// the TS mutating `operand.effect = Effect.Read` on the FunctionExpression's
    /// `loweredFunc.func.context`. Drained back onto the real instruction in
    /// `infer_block`.
    pending_context_downgrades: HashSet<IdentifierId>,
    /// `env.config.enablePreserveExistingMemoizationGuarantees`. Gates the
    /// `Freeze` effects emitted for `StartMemoize`/`FinishMemoize` operands
    /// (`InferMutationAliasingEffects.ts` `case 'StartMemoize'/'FinishMemoize'`):
    /// when the flag is off, a `useMemo`/`useCallback` value is *not* frozen by
    /// the memo markers, so a later transitive mutation can still extend its
    /// reactive scope.
    enable_preserve_existing_memoization_guarantees: bool,
}

impl Context {
    fn alloc_value(&mut self) -> ValueId {
        let v = self.next_value_id;
        self.next_value_id += 1;
        v
    }

    /// Get-or-create a cached synthetic value id for an effect.
    fn cached_value(&mut self, effect: &AliasingEffect) -> ValueId {
        let key = effect.hash_key();
        if let Some(v) = self.effect_value_cache.get(&key) {
            *v
        } else {
            let v = self.alloc_value();
            self.effect_value_cache.insert(key, v);
            v
        }
    }
}

/// Run `inferMutationAliasingEffects` on `fn`.
///
/// `enable_preserve` is `env.config.enablePreserveExistingMemoizationGuarantees`:
/// it gates whether `StartMemoize`/`FinishMemoize` operands are frozen.
///
/// `transitively_freeze_fn_exprs` is the TS `freezeValue` gate
/// `enablePreserveExistingMemoizationGuarantees || enableTransitivelyFreezeFunctionExpressions`
/// (`InferMutationAliasingEffects.ts:1466-1474`): when set, freezing a
/// FunctionExpression value transitively freezes its captured context places.
pub fn infer_mutation_aliasing_effects(
    func: &mut HirFunction,
    is_function_expression: bool,
    enable_preserve: bool,
    transitively_freeze_fn_exprs: bool,
    validate_no_impure: bool,
) {
    let mut initial_state = InferenceState::empty(
        is_function_expression,
        transitively_freeze_fn_exprs,
        validate_no_impure,
    );
    let mut next_value_id: ValueId = 0;
    let mut alloc = |s: &mut InferenceState, kind: AbstractValue| -> ValueId {
        let v = next_value_id;
        next_value_id += 1;
        s.values.insert(v, kind);
        v
    };

    // Context variables -> Context.
    for ref_place in &func.context {
        let v = alloc(
            &mut initial_state,
            AbstractValue {
                kind: ValueKind::Context,
                reason: single_reason(ValueReason::Other),
            },
        );
        initial_state.define(ref_place, v);
    }

    let param_kind = if is_function_expression {
        AbstractValue {
            kind: ValueKind::Mutable,
            reason: single_reason(ValueReason::Other),
        }
    } else {
        AbstractValue {
            kind: ValueKind::Frozen,
            reason: single_reason(ValueReason::ReactiveFunctionArgument),
        }
    };

    let is_component = func.fn_type == crate::hir::model::ReactFunctionType::Component;
    let params = func.params.clone();
    if is_component {
        // props (param 0) inferred with paramKind; ref (param 1) Mutable.
        if let Some(props) = params.first() {
            let place = param_place(props);
            let v = alloc(&mut initial_state, param_kind.clone());
            initial_state.define(place, v);
        }
        if let Some(refp) = params.get(1) {
            let place = param_place(refp);
            let v = alloc(
                &mut initial_state,
                AbstractValue {
                    kind: ValueKind::Mutable,
                    reason: single_reason(ValueReason::Other),
                },
            );
            initial_state.define(place, v);
        }
    } else {
        for param in &params {
            let place = param_place(param);
            let v = alloc(&mut initial_state, param_kind.clone());
            initial_state.define(place, v);
        }
    }

    let mut ctx = Context {
        is_function_expression,
        effect_value_cache: HashMap::new(),
        signature_cache: HashMap::new(),
        catch_handlers: HashMap::new(),
        hoisted_context_declarations: find_hoisted_context_declarations(func),
        non_mutating_spreads: find_non_mutated_destructure_spreads(func),
        next_value_id,
        pending_context_downgrades: HashSet::new(),
        enable_preserve_existing_memoization_guarantees: enable_preserve,
    };

    // Fixpoint.
    let mut states_by_block: HashMap<BlockId, InferenceState> = HashMap::new();
    let mut queued_states: BTreeMap<BlockId, InferenceState> = BTreeMap::new();
    queue_block(
        &mut queued_states,
        &states_by_block,
        func.body.entry,
        initial_state,
    );

    let block_order: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();

    let mut iteration = 0;
    while !queued_states.is_empty() {
        iteration += 1;
        if iteration > 100 {
            break;
        }
        for block_id in &block_order {
            let Some(incoming) = queued_states.remove(block_id) else {
                continue;
            };
            states_by_block.insert(*block_id, incoming.clone());
            let mut state = incoming;
            infer_block(&mut ctx, &mut state, func, *block_id);

            let successors = {
                let block = func.body.block(*block_id).unwrap();
                each_terminal_successor(&block.terminal)
            };
            for succ in successors {
                queue_block(&mut queued_states, &states_by_block, succ, state.clone());
            }
        }
    }
}

/// `queue(blockId, state)`.
fn queue_block(
    queued_states: &mut BTreeMap<BlockId, InferenceState>,
    states_by_block: &HashMap<BlockId, InferenceState>,
    block_id: BlockId,
    state: InferenceState,
) {
    if let Some(existing) = queued_states.get(&block_id) {
        let merged = existing.merge(&state).unwrap_or_else(|| existing.clone());
        queued_states.insert(block_id, merged);
    } else if let Some(prev) = states_by_block.get(&block_id) {
        if let Some(merged) = prev.merge(&state) {
            queued_states.insert(block_id, merged);
        }
    } else {
        queued_states.insert(block_id, state);
    }
}

fn param_place(param: &FunctionParam) -> &Place {
    match param {
        FunctionParam::Place(p) => p,
        FunctionParam::Spread(s) => &s.place,
    }
}

/// `findHoistedContextDeclarations`.
fn find_hoisted_context_declarations(
    func: &HirFunction,
) -> HashMap<crate::hir::ids::DeclarationId, Option<SourceLocation>> {
    let mut hoisted: HashMap<crate::hir::ids::DeclarationId, Option<SourceLocation>> =
        HashMap::new();
    let visit = |hoisted: &mut HashMap<crate::hir::ids::DeclarationId, Option<SourceLocation>>,
                 place: &Place| {
        let decl = place.identifier.declaration_id;
        if let Some(entry) = hoisted.get(&decl) {
            if entry.is_none() {
                hoisted.insert(decl, Some(place.loc.clone()));
            }
        }
    };
    for block in func.body.blocks() {
        for instr in &block.instructions {
            if let InstructionValue::DeclareContext { kind, place, .. } = &instr.value {
                if matches!(
                    kind,
                    InstructionKind::HoistedConst
                        | InstructionKind::HoistedFunction
                        | InstructionKind::HoistedLet
                ) {
                    hoisted.insert(place.identifier.declaration_id, None);
                }
            } else {
                for operand in each_instruction_value_operand(&instr.value) {
                    visit(&mut hoisted, operand);
                }
            }
        }
        for operand in crate::passes::cfg::each_terminal_operand(&block.terminal) {
            visit(&mut hoisted, operand);
        }
    }
    hoisted
}

/// `findNonMutatedDestructureSpreads` — port of the TS pass that finds rest
/// spreads (`{...rest}`) of a known-frozen value (component props / hook params)
/// that are never themselves mutated. Such spreads only read frozen properties,
/// so the spread object can be treated as `Frozen` rather than `Mutable`,
/// keeping the downstream reads out of a reactive scope.
fn find_non_mutated_destructure_spreads(func: &HirFunction) -> HashSet<IdentifierId> {
    let mut known_frozen: HashSet<IdentifierId> = HashSet::new();
    if func.fn_type == crate::hir::model::ReactFunctionType::Component {
        if let Some(FunctionParam::Place(props)) = func.params.first() {
            known_frozen.insert(props.identifier.id);
        }
    } else {
        for param in &func.params {
            if let FunctionParam::Place(place) = param {
                known_frozen.insert(place.identifier.id);
            }
        }
    }

    // Map of temporaries to identifiers for spread objects.
    let mut candidate: BTreeMap<IdentifierId, IdentifierId> = BTreeMap::new();
    for block in func.body.blocks() {
        if !candidate.is_empty() {
            for phi in &block.phis {
                for operand in phi.operands.values() {
                    if let Some(&spread) = candidate.get(&operand.identifier.id) {
                        candidate.remove(&spread);
                    }
                }
            }
        }
        for instr in &block.instructions {
            let lvalue = &instr.lvalue;
            match &instr.value {
                InstructionValue::Destructure { lvalue: lv, value, .. } => {
                    if !known_frozen.contains(&value.identifier.id)
                        || !matches!(lv.kind, InstructionKind::Let | InstructionKind::Const)
                    {
                        continue;
                    }
                    let Pattern::Object(obj) = &lv.pattern else {
                        continue;
                    };
                    for item in &obj.properties {
                        if let crate::hir::value::ObjectPatternProperty::Spread(s) = item {
                            candidate.insert(s.place.identifier.id, s.place.identifier.id);
                        }
                    }
                }
                InstructionValue::LoadLocal { place, .. } => {
                    if let Some(&spread) = candidate.get(&place.identifier.id) {
                        candidate.insert(lvalue.identifier.id, spread);
                    }
                }
                InstructionValue::StoreLocal { lvalue: store_lv, value, .. } => {
                    if let Some(&spread) = candidate.get(&value.identifier.id) {
                        candidate.insert(lvalue.identifier.id, spread);
                        candidate.insert(store_lv.place.identifier.id, spread);
                    }
                }
                InstructionValue::JsxFragment { .. } | InstructionValue::JsxExpression { .. } => {
                    // Passing objects created with spread to jsx can't mutate them.
                }
                InstructionValue::PropertyLoad { .. } => {
                    // Properties must be frozen since the original value was frozen.
                }
                InstructionValue::CallExpression { callee, .. } => {
                    if get_hook_kind(&callee.identifier).is_some() {
                        if !is_ref_or_ref_value(&lvalue.identifier) {
                            known_frozen.insert(lvalue.identifier.id);
                        }
                    } else if !candidate.is_empty() {
                        for operand in each_instruction_value_operand(&instr.value) {
                            if let Some(&spread) = candidate.get(&operand.identifier.id) {
                                candidate.remove(&spread);
                            }
                        }
                    }
                }
                InstructionValue::MethodCall { property, .. } => {
                    if get_hook_kind(&property.identifier).is_some() {
                        if !is_ref_or_ref_value(&lvalue.identifier) {
                            known_frozen.insert(lvalue.identifier.id);
                        }
                    } else if !candidate.is_empty() {
                        for operand in each_instruction_value_operand(&instr.value) {
                            if let Some(&spread) = candidate.get(&operand.identifier.id) {
                                candidate.remove(&spread);
                            }
                        }
                    }
                }
                other => {
                    if !candidate.is_empty() {
                        for operand in each_instruction_value_operand(other) {
                            if let Some(&spread) = candidate.get(&operand.identifier.id) {
                                candidate.remove(&spread);
                            }
                        }
                    }
                }
            }
        }
    }

    let mut non_mutating = HashSet::new();
    for (&key, &value) in &candidate {
        if key == value {
            non_mutating.insert(key);
        }
    }
    non_mutating
}

/// `inferBlock`.
fn infer_block(ctx: &mut Context, state: &mut InferenceState, func: &mut HirFunction, block_id: BlockId) {
    // Phis (clone to avoid borrow conflict).
    let phis = func.body.block(block_id).unwrap().phis.clone();
    for phi in &phis {
        state.infer_phi(phi);
    }

    let instr_count = func.body.block(block_id).unwrap().instructions.len();
    for i in 0..instr_count {
        let instr = func.body.block(block_id).unwrap().instructions[i].clone();
        let instr_id = instr.id.as_u32();
        let signature = if let Some(sig) = ctx.signature_cache.get(&instr_id) {
            sig.clone()
        } else {
            let sig = compute_signature_for_instruction(ctx, &instr);
            ctx.signature_cache.insert(instr_id, sig.clone());
            sig
        };
        ctx.pending_context_downgrades.clear();
        let effects = apply_signature(ctx, state, &signature, &instr);
        // Write any context-operand effect downgrades (Capture -> Read) produced
        // by the `CreateFunction` apply path back onto the real instruction's
        // lowered function, so the `@context[...]` print reflects them.
        if !ctx.pending_context_downgrades.is_empty() {
            if let InstructionValue::FunctionExpression { lowered_func, .. }
            | InstructionValue::ObjectMethod { lowered_func, .. } =
                &mut func.body.block_mut(block_id).unwrap().instructions[i].value
            {
                for operand in &mut lowered_func.func.context {
                    if operand.effect == Effect::Capture
                        && ctx
                            .pending_context_downgrades
                            .contains(&operand.identifier.id)
                    {
                        operand.effect = Effect::Read;
                    }
                }
            }
            ctx.pending_context_downgrades.clear();
        }
        func.body.block_mut(block_id).unwrap().instructions[i].effects = effects;
    }

    // Terminal effects.
    let terminal = func.body.block(block_id).unwrap().terminal.clone();
    match &terminal {
        Terminal::Try {
            handler,
            handler_binding: Some(binding),
            ..
        } => {
            ctx.catch_handlers.insert(*handler, binding.clone());
        }
        Terminal::MaybeThrow {
            handler: Some(handler),
            ..
        } => {
            if let Some(handler_param) = ctx.catch_handlers.get(handler).cloned() {
                let mut effects: Vec<AliasingEffect> = Vec::new();
                let instrs = func.body.block(block_id).unwrap().instructions.clone();
                for instr in &instrs {
                    if matches!(
                        instr.value,
                        InstructionValue::CallExpression { .. } | InstructionValue::MethodCall { .. }
                    ) {
                        state.append_alias(&handler_param, &instr.lvalue);
                        let kind = state.kind(&instr.lvalue).kind;
                        if kind == ValueKind::Mutable || kind == ValueKind::Context {
                            effects.push(AliasingEffect::Alias {
                                from: instr.lvalue.clone(),
                                into: handler_param.clone(),
                            });
                        }
                    }
                }
                if let Terminal::MaybeThrow {
                    effects: term_effects,
                    ..
                } = &mut func.body.block_mut(block_id).unwrap().terminal
                {
                    *term_effects = if effects.is_empty() { None } else { Some(effects) };
                }
            }
        }
        Terminal::Return { value, .. } => {
            if !ctx.is_function_expression {
                let eff = vec![AliasingEffect::Freeze {
                    value: value.clone(),
                    reason: ValueReason::JsxCaptured,
                }];
                if let Terminal::Return {
                    effects: term_effects,
                    ..
                } = &mut func.body.block_mut(block_id).unwrap().terminal
                {
                    *term_effects = Some(eff);
                }
            }
        }
        _ => {}
    }
}

/// `applySignature`.
fn apply_signature(
    ctx: &mut Context,
    state: &mut InferenceState,
    signature: &[AliasingEffect],
    instruction: &Instruction,
) -> Option<Vec<AliasingEffect>> {
    let mut effects: Vec<AliasingEffect> = Vec::new();

    // Early validation for FunctionExpression/ObjectMethod mutating frozen
    // context. (Produces MutateFrozen; rare in fixtures.)
    if let InstructionValue::FunctionExpression { lowered_func, .. }
    | InstructionValue::ObjectMethod { lowered_func, .. } = &instruction.value
    {
        let inner = &lowered_func.func;
        let context_ids: HashSet<IdentifierId> =
            inner.context.iter().map(|p| p.identifier.id).collect();
        if let Some(aliasing) = &inner.aliasing_effects {
            for effect in aliasing {
                let value = match effect {
                    AliasingEffect::Mutate { value, .. }
                    | AliasingEffect::MutateTransitive { value } => value,
                    _ => continue,
                };
                if !context_ids.contains(&value.identifier.id) {
                    continue;
                }
                if state.kind(value).kind == ValueKind::Frozen {
                    effects.push(AliasingEffect::MutateFrozen {
                        place: value.clone(),
                        reason: "This value cannot be modified".to_string(),
                    });
                }
            }
        }
    }

    let mut initialized: HashSet<IdentifierId> = HashSet::new();
    for effect in signature {
        apply_effect(ctx, state, effect, &mut initialized, &mut effects);
    }

    if effects.is_empty() {
        None
    } else {
        Some(effects)
    }
}

include!("infer_mutation_aliasing_effects_apply.rs");
include!("infer_mutation_aliasing_effects_signature.rs");
