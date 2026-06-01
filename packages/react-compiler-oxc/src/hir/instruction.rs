//! Instructions (`Instruction` in `HIR/HIR.ts`) and the [`AliasingEffect`] union
//! (`../Inference/AliasingEffects`) carried by instructions and select terminals.

use super::ids::IdentifierId;
use super::place::{Place, SourceLocation, ValueKind, ValueReason};

/// The signature carried by an `Apply` effect (`FunctionSignature` from
/// `HIR/ObjectShape.ts`). Only the fields the legacy-signature lowering reads are
/// materialized. `None` means an unsignatured call (the default capture path).
#[derive(Clone, Debug, PartialEq)]
pub struct CallSignature {
    /// `positionalParams`: the [`super::place::Effect`] applied to each positional
    /// argument (stored as the legacy [`LegacyEffect`]).
    pub positional_params: Vec<LegacyEffect>,
    /// `restParam`: the effect applied to any extra/spread arguments.
    pub rest_param: Option<LegacyEffect>,
    /// `calleeEffect`: the effect applied to the receiver.
    pub callee_effect: LegacyEffect,
    /// `returnValueKind`: the [`ValueKind`] of the call's result.
    pub return_value_kind: ValueKind,
    /// `returnValueReason`: the [`ValueReason`] of the result (defaults `Other`).
    pub return_value_reason: ValueReason,
    /// `mutableOnlyIfOperandsAreMutable`.
    pub mutable_only_if_operands_are_mutable: bool,
    /// `impure`.
    pub impure: bool,
    /// `noAlias`: when true, a (hook) call's arguments do not escape via the
    /// callee. Carried by the `useFragment`/`useNoAlias` shared-runtime hooks and
    /// the builtin higher-order array methods. Read by `PruneNonEscapingScopes`
    /// (`isMutableEffect` / hook-arg escape) and the freeze/effect inference.
    pub no_alias: bool,
    /// The new-style aliasing signature (`signature.aliasing`), when present.
    /// Effects reference [`SigPlace`] placeholders, substituted at application.
    pub aliasing: Option<AliasingSignature>,
}

/// A parametric aliasing signature (`AliasingSignature`). Placeholders are
/// referenced symbolically via [`SigPlace`] and substituted with concrete places
/// in `compute_effects_for_signature`.
#[derive(Clone, Debug, PartialEq)]
pub struct AliasingSignature {
    /// Number of named params.
    pub params: usize,
    /// Whether there is a rest param.
    pub has_rest: bool,
    /// Number of synthetic temporaries.
    pub temporaries: usize,
    /// The signature's effects, over [`SigPlace`] placeholders.
    pub effects: Vec<SigEffect>,
}

/// A placeholder operand in an [`AliasingSignature`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SigPlace {
    /// `@receiver`.
    Receiver,
    /// `@returns`.
    Returns,
    /// `@rest`.
    Rest,
    /// The `i`th positional param (`@paramN`).
    Param(usize),
    /// The `i`th synthetic temporary (`@tempN`).
    Temporary(usize),
}

/// A signature effect over [`SigPlace`] placeholders (`AliasingEffect` with
/// symbolic operands).
#[derive(Clone, Debug, PartialEq)]
pub enum SigEffect {
    /// `Mutate place`.
    Mutate(SigPlace),
    /// `Capture from -> into`.
    Capture {
        /// Source placeholder.
        from: SigPlace,
        /// Destination placeholder.
        into: SigPlace,
    },
    /// `CreateFrom from -> into`.
    CreateFrom {
        /// Source placeholder.
        from: SigPlace,
        /// Destination placeholder.
        into: SigPlace,
    },
    /// `ImmutableCapture from -> into` — immutable data flow only (escape
    /// analysis), no mutable-range extension. Used by the `Object.keys` aliasing
    /// signature (only the immutable keys are captured, so the source object is
    /// not transitively mutated).
    ImmutableCapture {
        /// Source placeholder.
        from: SigPlace,
        /// Destination placeholder.
        into: SigPlace,
    },
    /// `Create into = value (reason)`.
    Create {
        /// Destination placeholder.
        into: SigPlace,
        /// Created value kind.
        value: ValueKind,
        /// Created value reason.
        reason: ValueReason,
    },
    /// `Freeze value (reason)` — freezes the placeholder (used by hook signatures
    /// to freeze their arguments).
    Freeze {
        /// The frozen placeholder.
        value: SigPlace,
        /// The freeze reason.
        reason: ValueReason,
    },
    /// `Alias from -> into` — information flow where mutating `into` mutates
    /// `from` (used by the default-hook signature to alias args into the return).
    Alias {
        /// Source placeholder.
        from: SigPlace,
        /// Destination placeholder.
        into: SigPlace,
    },
    /// `Assign into = from` — direct assignment / identity equivalence (used by
    /// the `Set.add` / `Map.set` aliasing signatures, which return the receiver).
    Assign {
        /// Source placeholder.
        from: SigPlace,
        /// Destination placeholder.
        into: SigPlace,
    },
    /// `Apply` — a nested call (used by `map` for the callback).
    Apply {
        /// The receiver placeholder.
        receiver: SigPlace,
        /// The function placeholder.
        function: SigPlace,
        /// The args (placeholder or hole).
        args: Vec<Option<SigPlace>>,
        /// The result placeholder.
        into: SigPlace,
        /// Whether the function is mutated.
        mutates_function: bool,
    },
}

/// The legacy `Effect` enum carried by [`CallSignature`] entries (`HIR/HIR.ts`'s
/// `Effect`). Distinct from [`super::place::Effect`] only in that it is used for
/// the signature's per-operand effect classification.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LegacyEffect {
    /// `Effect.Read`.
    Read,
    /// `Effect.Capture`.
    Capture,
    /// `Effect.ConditionallyMutate`.
    ConditionallyMutate,
    /// `Effect.ConditionallyMutateIterator`.
    ConditionallyMutateIterator,
    /// `Effect.Store`.
    Store,
    /// `Effect.Mutate`.
    Mutate,
    /// `Effect.Freeze`.
    Freeze,
}

/// The mutation reason carried by a `Mutate` effect (`MutationReason`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MutationReason {
    /// `{kind: 'AssignCurrentProperty'}` — a `.current` ref-store mutation.
    AssignCurrentProperty,
}

/// One argument to an `Apply` effect (`Place | SpreadPattern | Hole`).
#[derive(Clone, Debug, PartialEq)]
pub enum ApplyArg {
    /// A positional identifier argument.
    Identifier(Place),
    /// A `...spread` argument.
    Spread(Place),
    /// An elision/hole.
    Hole,
}

/// The data needed to build an [`AliasingSignature`] dynamically from a locally
/// declared `FunctionExpression` value (`buildSignatureFromFunctionExpression` in
/// the TS). Carried on a [`AliasingEffect::CreateFunction`] so the `Apply` path
/// can recognise a call to a known-locally-declared function and substitute its
/// effects precisely. `None` when the lowered function has no aliasing effects.
#[derive(Clone, Debug, PartialEq)]
pub struct FnExprSignatureData {
    /// The positional param identifier ids (the named params).
    pub params: Vec<IdentifierId>,
    /// The rest param identifier id, if any.
    pub rest: Option<IdentifierId>,
    /// The function's `returns` identifier id.
    pub returns: IdentifierId,
    /// The function's context operand places (substituted to themselves).
    pub context: Vec<Place>,
    /// The lowered function's aliasing effects (the signature body).
    pub effects: Vec<AliasingEffect>,
    /// Every param place (positional + rest) with its `mutable_range`, used by
    /// `areArgumentsImmutableAndNonMutating` to detect a lambda that mutates its
    /// inputs (`range.end > range.start + 1`).
    pub param_places: Vec<Place>,
}

/// Aliasing/mutation effect produced by inference (`AliasingEffect` from
/// `../Inference/AliasingEffects`). Populated by
/// [`crate::passes::infer_mutation_aliasing_effects`]; `None` after lowering.
#[derive(Clone, Debug, PartialEq)]
pub enum AliasingEffect {
    /// `Freeze` — marks the value and its direct aliases as frozen.
    Freeze {
        /// The frozen value.
        value: Place,
        /// The reason for freezing.
        reason: ValueReason,
    },
    /// `Mutate` — mutates the value and any direct aliases.
    Mutate {
        /// The mutated value.
        value: Place,
        /// An optional mutation reason (e.g. `.current` assignment).
        reason: Option<MutationReason>,
    },
    /// `MutateConditionally`.
    MutateConditionally {
        /// The conditionally-mutated value.
        value: Place,
    },
    /// `MutateTransitive`.
    MutateTransitive {
        /// The transitively-mutated value.
        value: Place,
    },
    /// `MutateTransitiveConditionally`.
    MutateTransitiveConditionally {
        /// The conditionally transitively-mutated value.
        value: Place,
    },
    /// `Capture` — information flow where local mutation of `into` does not
    /// mutate `from`.
    Capture {
        /// The captured-from value.
        from: Place,
        /// The capturing value.
        into: Place,
    },
    /// `Alias` — information flow where local mutation of `into` *does* mutate
    /// `from`.
    Alias {
        /// The aliased-from value.
        from: Place,
        /// The aliasing value.
        into: Place,
    },
    /// `MaybeAlias` — potential information flow.
    MaybeAlias {
        /// The maybe-aliased-from value.
        from: Place,
        /// The maybe-aliasing value.
        into: Place,
    },
    /// `Assign` — direct assignment `into = from`.
    Assign {
        /// The assigned-from value.
        from: Place,
        /// The assigned value.
        into: Place,
    },
    /// `CreateFrom` — creates a value with the same kind as the source.
    CreateFrom {
        /// The source value.
        from: Place,
        /// The created value.
        into: Place,
    },
    /// `ImmutableCapture` — immutable data flow (escape analysis only).
    ImmutableCapture {
        /// The captured-from value.
        from: Place,
        /// The capturing value.
        into: Place,
    },
    /// `Create` — creates a value of the given kind.
    Create {
        /// The created value.
        into: Place,
        /// The created value's kind.
        value: ValueKind,
        /// The created value's reason.
        reason: ValueReason,
    },
    /// `CreateFunction` — constructs a function value with the given captures.
    CreateFunction {
        /// The captured context places.
        captures: Vec<Place>,
        /// The created function value.
        into: Place,
        /// The function's `returns` identifier id (uniquely identifies the
        /// function for interning, mirroring the TS `hashEffect`).
        function_returns: IdentifierId,
        /// Whether any of the lowered function's context operands is a ref or
        /// ref-value (`capturesRef` in the TS). Forces the function value to be
        /// considered mutable even without mutable captures.
        captures_ref: bool,
        /// Whether the lowered function's `aliasingEffects` contain any tracked
        /// side effect (`MutateFrozen`/`MutateGlobal`/`Impure` —
        /// `hasTrackedSideEffects` in the TS). Also forces mutability.
        has_tracked_side_effects: bool,
        /// The data needed to build an aliasing signature for this function when
        /// it is later called as a locally declared function (`Apply` path).
        /// `None` when the lowered function has no aliasing effects.
        signature_data: Option<Box<FnExprSignatureData>>,
    },
    /// `Apply` — calls `function` (on `receiver`) with `args`, capturing the
    /// result into `into`.
    Apply {
        /// The receiver place.
        receiver: Place,
        /// The callee place.
        function: Place,
        /// Whether the callee itself is mutated.
        mutates_function: bool,
        /// The arguments.
        args: Vec<ApplyArg>,
        /// The result place.
        into: Place,
        /// The resolved call signature, if any.
        signature: Option<CallSignature>,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `MutateFrozen` — mutation of a known-immutable value (error case).
    MutateFrozen {
        /// The mutated place.
        place: Place,
        /// The diagnostic reason (`error.reason`).
        reason: String,
    },
    /// `MutateGlobal` — mutation of a global (error case).
    MutateGlobal {
        /// The mutated place.
        place: Place,
        /// The diagnostic reason (`error.reason`).
        reason: String,
    },
    /// `Impure` — a render-unsafe side effect (error case).
    Impure {
        /// The impure place.
        place: Place,
        /// The diagnostic reason (`error.reason`).
        reason: String,
    },
    /// `Render` — a place accessed during render.
    Render {
        /// The rendered place.
        place: Place,
    },
}

impl AliasingEffect {
    /// The dedup hash for interning (`hashEffect`), used to mirror the TS
    /// `internEffect` map keyed on a structural string.
    pub fn hash_key(&self) -> String {
        match self {
            AliasingEffect::Apply {
                receiver,
                function,
                mutates_function,
                args,
                into,
                ..
            } => {
                let arg_ids: Vec<String> = args
                    .iter()
                    .map(|a| match a {
                        ApplyArg::Hole => String::new(),
                        ApplyArg::Identifier(p) => p.identifier.id.as_u32().to_string(),
                        ApplyArg::Spread(p) => format!("...{}", p.identifier.id.as_u32()),
                    })
                    .collect();
                format!(
                    "Apply:{}:{}:{}:{}:{}",
                    receiver.identifier.id.as_u32(),
                    function.identifier.id.as_u32(),
                    mutates_function,
                    arg_ids.join(","),
                    into.identifier.id.as_u32(),
                )
            }
            AliasingEffect::CreateFrom { from, into }
            | AliasingEffect::ImmutableCapture { from, into }
            | AliasingEffect::Assign { from, into }
            | AliasingEffect::Alias { from, into }
            | AliasingEffect::Capture { from, into }
            | AliasingEffect::MaybeAlias { from, into } => {
                format!(
                    "{}:{}:{}",
                    self.kind_name(),
                    from.identifier.id.as_u32(),
                    into.identifier.id.as_u32(),
                )
            }
            AliasingEffect::Create {
                into,
                value,
                reason,
            } => format!(
                "Create:{}:{}:{}",
                into.identifier.id.as_u32(),
                value.as_str(),
                reason.as_str()
            ),
            AliasingEffect::Freeze { value, reason } => format!(
                "Freeze:{}:{}",
                value.identifier.id.as_u32(),
                reason.as_str()
            ),
            AliasingEffect::Impure { place, .. } | AliasingEffect::Render { place } => {
                format!("{}:{}", self.kind_name(), place.identifier.id.as_u32())
            }
            AliasingEffect::MutateFrozen { place, reason }
            | AliasingEffect::MutateGlobal { place, reason } => {
                format!(
                    "{}:{}:{}",
                    self.kind_name(),
                    place.identifier.id.as_u32(),
                    reason
                )
            }
            AliasingEffect::Mutate { value, .. }
            | AliasingEffect::MutateConditionally { value }
            | AliasingEffect::MutateTransitive { value }
            | AliasingEffect::MutateTransitiveConditionally { value } => {
                format!("{}:{}", self.kind_name(), value.identifier.id.as_u32())
            }
            AliasingEffect::CreateFunction {
                into,
                function_returns,
                captures,
                ..
            } => {
                let cap_ids: Vec<String> = captures
                    .iter()
                    .map(|p| p.identifier.id.as_u32().to_string())
                    .collect();
                format!(
                    "CreateFunction:{}:{}:{}",
                    into.identifier.id.as_u32(),
                    function_returns.as_u32(),
                    cap_ids.join(",")
                )
            }
        }
    }

    fn kind_name(&self) -> &'static str {
        match self {
            AliasingEffect::Freeze { .. } => "Freeze",
            AliasingEffect::Mutate { .. } => "Mutate",
            AliasingEffect::MutateConditionally { .. } => "MutateConditionally",
            AliasingEffect::MutateTransitive { .. } => "MutateTransitive",
            AliasingEffect::MutateTransitiveConditionally { .. } => "MutateTransitiveConditionally",
            AliasingEffect::Capture { .. } => "Capture",
            AliasingEffect::Alias { .. } => "Alias",
            AliasingEffect::MaybeAlias { .. } => "MaybeAlias",
            AliasingEffect::Assign { .. } => "Assign",
            AliasingEffect::CreateFrom { .. } => "CreateFrom",
            AliasingEffect::ImmutableCapture { .. } => "ImmutableCapture",
            AliasingEffect::Create { .. } => "Create",
            AliasingEffect::CreateFunction { .. } => "CreateFunction",
            AliasingEffect::Apply { .. } => "Apply",
            AliasingEffect::MutateFrozen { .. } => "MutateFrozen",
            AliasingEffect::MutateGlobal { .. } => "MutateGlobal",
            AliasingEffect::Impure { .. } => "Impure",
            AliasingEffect::Render { .. } => "Render",
        }
    }

    /// Mutable references to every [`Place`] this effect references, so a pass
    /// (e.g. `inferReactiveScopeVariables`) can rewrite the identifiers carried in
    /// the effect lines. Order is not significant.
    pub fn places_mut(&mut self) -> Vec<&mut Place> {
        match self {
            AliasingEffect::Freeze { value, .. }
            | AliasingEffect::Mutate { value, .. }
            | AliasingEffect::MutateConditionally { value }
            | AliasingEffect::MutateTransitive { value }
            | AliasingEffect::MutateTransitiveConditionally { value } => vec![value],
            AliasingEffect::Capture { from, into }
            | AliasingEffect::Alias { from, into }
            | AliasingEffect::MaybeAlias { from, into }
            | AliasingEffect::Assign { from, into }
            | AliasingEffect::CreateFrom { from, into }
            | AliasingEffect::ImmutableCapture { from, into } => vec![from, into],
            AliasingEffect::Create { into, .. } => vec![into],
            AliasingEffect::CreateFunction { captures, into, .. } => {
                let mut out: Vec<&mut Place> = captures.iter_mut().collect();
                out.push(into);
                out
            }
            AliasingEffect::Apply {
                receiver,
                function,
                args,
                into,
                ..
            } => {
                let mut out = vec![receiver, function];
                for arg in args.iter_mut() {
                    match arg {
                        ApplyArg::Identifier(p) | ApplyArg::Spread(p) => out.push(p),
                        ApplyArg::Hole => {}
                    }
                }
                out.push(into);
                out
            }
            AliasingEffect::MutateFrozen { place, .. }
            | AliasingEffect::MutateGlobal { place, .. }
            | AliasingEffect::Impure { place, .. }
            | AliasingEffect::Render { place } => vec![place],
        }
    }
}

use super::ids::InstructionId;
use super::value::InstructionValue;

/// A single HIR instruction: a flattened expression whose result is stored into
/// [`Instruction::lvalue`] (`Instruction` in `HIR/HIR.ts`).
#[derive(Clone, Debug, PartialEq)]
pub struct Instruction {
    /// Sequencing id within the function.
    pub id: InstructionId,
    /// The place that receives the instruction's result.
    pub lvalue: Place,
    /// The computed value.
    pub value: InstructionValue,
    /// Originating source location.
    pub loc: SourceLocation,
    /// Aliasing effects (populated by inference; `None` after lowering).
    pub effects: Option<Vec<AliasingEffect>>,
}
