// Included into `infer_mutation_aliasing_effects.rs`. The `applyEffect` engine
// and signature substitution.

/// `applyEffect`.
#[allow(clippy::too_many_arguments)]
fn apply_effect(
    ctx: &mut Context,
    state: &mut InferenceState,
    effect: &AliasingEffect,
    initialized: &mut HashSet<IdentifierId>,
    effects: &mut Vec<AliasingEffect>,
) {
    match effect {
        AliasingEffect::Freeze { value, reason } => {
            let did_freeze = state.freeze(value, *reason);
            if did_freeze {
                effects.push(effect.clone());
            }
        }
        AliasingEffect::Create {
            into,
            value,
            reason,
        } => {
            initialized.insert(into.identifier.id);
            let v = ctx.cached_value(effect);
            state.initialize(
                v,
                AbstractValue {
                    kind: *value,
                    reason: single_reason(*reason),
                },
            );
            state.define(into, v);
            effects.push(effect.clone());
        }
        AliasingEffect::ImmutableCapture { from, .. } => {
            let kind = state.kind(from).kind;
            match kind {
                ValueKind::Global | ValueKind::Primitive => {}
                _ => effects.push(effect.clone()),
            }
        }
        AliasingEffect::CreateFrom { from, into } => {
            initialized.insert(into.identifier.id);
            let from_value = state.kind(from);
            let v = ctx.cached_value(effect);
            state.initialize(
                v,
                AbstractValue {
                    kind: from_value.kind,
                    reason: from_value.reason.clone(),
                },
            );
            state.define(into, v);
            match from_value.kind {
                ValueKind::Primitive | ValueKind::Global => {
                    effects.push(AliasingEffect::Create {
                        value: from_value.kind,
                        into: into.clone(),
                        reason: first_reason(&from_value.reason),
                    });
                }
                ValueKind::Frozen => {
                    effects.push(AliasingEffect::Create {
                        value: from_value.kind,
                        into: into.clone(),
                        reason: first_reason(&from_value.reason),
                    });
                    apply_effect(
                        ctx,
                        state,
                        &AliasingEffect::ImmutableCapture {
                            from: from.clone(),
                            into: into.clone(),
                        },
                        initialized,
                        effects,
                    );
                }
                _ => effects.push(effect.clone()),
            }
        }
        AliasingEffect::CreateFunction {
            captures,
            into,
            captures_ref,
            has_tracked_side_effects,
            signature_data,
            ..
        } => {
            initialized.insert(into.identifier.id);
            effects.push(effect.clone());

            let has_captures = captures.iter().any(|c| {
                matches!(state.kind(c).kind, ValueKind::Context | ValueKind::Mutable)
            });
            // `isMutable = hasCaptures || hasTrackedSideEffects || capturesRef`
            // (TS InferMutationAliasingEffects, CreateFunction case). `capturesRef`
            // and `hasTrackedSideEffects` are precomputed onto the effect from the
            // lowered function's context operands / aliasing effects.
            let is_mutable = has_captures || *captures_ref || *has_tracked_side_effects;

            // Downgrade each captured context operand whose value resolved to
            // Primitive/Frozen/Global from `Capture` to `Read` (TS mutates
            // `operand.effect = Effect.Read` on the lowered func's context). The
            // `captures` set is already exactly the context operands with
            // `Effect::Capture`. Record the identifier ids so `infer_block` can
            // write the downgrade back onto the real instruction's lowered func.
            for capture in captures.iter() {
                match state.kind(capture).kind {
                    ValueKind::Primitive | ValueKind::Frozen | ValueKind::Global => {
                        ctx.pending_context_downgrades.insert(capture.identifier.id);
                    }
                    _ => {}
                }
            }

            let v = ctx.alloc_value();
            state.initialize(
                v,
                AbstractValue {
                    kind: if is_mutable {
                        ValueKind::Mutable
                    } else {
                        ValueKind::Frozen
                    },
                    reason: BTreeSet::new(),
                },
            );
            // The function value backs `into`; we model `state.define(into, v)`.
            state.define(into, v);
            // Register the FunctionExpression signature data against this value so
            // a later `Apply` whose function resolves to exactly this value can
            // substitute the closure's effects precisely (TS `state.values(fn)`
            // returning a single FunctionExpression with `aliasingEffects`).
            if let Some(data) = signature_data {
                state
                    .fn_expr_values
                    .insert(v, std::rc::Rc::new((**data).clone()));
            }
            let captures = captures.clone();
            for capture in &captures {
                apply_effect(
                    ctx,
                    state,
                    &AliasingEffect::Capture {
                        from: capture.clone(),
                        into: into.clone(),
                    },
                    initialized,
                    effects,
                );
            }
        }
        AliasingEffect::MaybeAlias { from, into }
        | AliasingEffect::Alias { from, into }
        | AliasingEffect::Capture { from, into } => {
            let into_kind = state.kind(into).kind;
            let destination_type = match into_kind {
                ValueKind::Context => Some(DestType::Context),
                ValueKind::Mutable | ValueKind::MaybeFrozen => Some(DestType::Mutable),
                _ => None,
            };
            let from_kind = state.kind(from).kind;
            let source_type = match from_kind {
                ValueKind::Context => Some(SrcType::Context),
                ValueKind::Global | ValueKind::Primitive => None,
                ValueKind::MaybeFrozen | ValueKind::Frozen => Some(SrcType::Frozen),
                ValueKind::Mutable => Some(SrcType::Mutable),
            };

            let is_maybe_alias = matches!(effect, AliasingEffect::MaybeAlias { .. });
            if source_type == Some(SrcType::Frozen) {
                apply_effect(
                    ctx,
                    state,
                    &AliasingEffect::ImmutableCapture {
                        from: from.clone(),
                        into: into.clone(),
                    },
                    initialized,
                    effects,
                );
            } else if (source_type == Some(SrcType::Mutable)
                && destination_type == Some(DestType::Mutable))
                || is_maybe_alias
            {
                effects.push(effect.clone());
            } else if (source_type == Some(SrcType::Context) && destination_type.is_some())
                || (source_type == Some(SrcType::Mutable)
                    && destination_type == Some(DestType::Context))
            {
                apply_effect(
                    ctx,
                    state,
                    &AliasingEffect::MaybeAlias {
                        from: from.clone(),
                        into: into.clone(),
                    },
                    initialized,
                    effects,
                );
            }
        }
        AliasingEffect::Assign { from, into } => {
            initialized.insert(into.identifier.id);
            let from_value = state.kind(from);
            match from_value.kind {
                ValueKind::Frozen => {
                    apply_effect(
                        ctx,
                        state,
                        &AliasingEffect::ImmutableCapture {
                            from: from.clone(),
                            into: into.clone(),
                        },
                        initialized,
                        effects,
                    );
                    let v = ctx.cached_value(effect);
                    state.initialize(
                        v,
                        AbstractValue {
                            kind: ValueKind::Frozen,
                            reason: from_value.reason.clone(),
                        },
                    );
                    state.define(into, v);
                }
                ValueKind::Global | ValueKind::Primitive => {
                    let v = ctx.cached_value(effect);
                    state.initialize(
                        v,
                        AbstractValue {
                            kind: from_value.kind,
                            reason: from_value.reason.clone(),
                        },
                    );
                    state.define(into, v);
                }
                _ => {
                    state.assign(into, from);
                    effects.push(effect.clone());
                }
            }
        }
        AliasingEffect::Apply { .. } => {
            apply_apply_effect(ctx, state, effect, initialized, effects);
        }
        AliasingEffect::Mutate { value, .. }
        | AliasingEffect::MutateConditionally { value }
        | AliasingEffect::MutateTransitive { value }
        | AliasingEffect::MutateTransitiveConditionally { value } => {
            let variant = match effect {
                AliasingEffect::Mutate { .. } => MutateVariant::Mutate,
                AliasingEffect::MutateConditionally { .. } => MutateVariant::MutateConditionally,
                AliasingEffect::MutateTransitive { .. } => MutateVariant::MutateTransitive,
                _ => MutateVariant::MutateTransitiveConditionally,
            };
            let outcome = state.mutate(variant, value);
            match outcome {
                MutationOutcome::Mutate => effects.push(effect.clone()),
                MutationOutcome::MutateRef => {}
                MutationOutcome::None => {}
                MutationOutcome::MutateFrozen | MutationOutcome::MutateGlobal => {
                    if matches!(variant, MutateVariant::Mutate | MutateVariant::MutateTransitive) {
                        let value_kind = state.kind(value);
                        let is_frozen = value_kind.kind == ValueKind::Frozen
                            || value_kind.kind == ValueKind::MaybeFrozen;
                        // The printed `reason` is the diagnostic's top-level
                        // `reason` field (`'This value cannot be modified'`), not
                        // its `description` (`getWriteErrorReason`).
                        let reason = "This value cannot be modified".to_string();
                        effects.push(if is_frozen {
                            AliasingEffect::MutateFrozen {
                                place: value.clone(),
                                reason,
                            }
                        } else {
                            AliasingEffect::MutateGlobal {
                                place: value.clone(),
                                reason,
                            }
                        });
                    }
                }
            }
        }
        AliasingEffect::Impure { .. }
        | AliasingEffect::Render { .. }
        | AliasingEffect::MutateFrozen { .. }
        | AliasingEffect::MutateGlobal { .. } => {
            effects.push(effect.clone());
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DestType {
    Context,
    Mutable,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SrcType {
    Context,
    Mutable,
    Frozen,
}

fn first_reason(reason: &BTreeSet<ReasonKey>) -> ValueReason {
    reason
        .iter()
        .next()
        .map(|k| reason_from_key(*k))
        .unwrap_or(ValueReason::Other)
}

/// `applyEffect` for the `Apply` case.
fn apply_apply_effect(
    ctx: &mut Context,
    state: &mut InferenceState,
    effect: &AliasingEffect,
    initialized: &mut HashSet<IdentifierId>,
    effects: &mut Vec<AliasingEffect>,
) {
    let AliasingEffect::Apply {
        receiver,
        function,
        mutates_function,
        args,
        into,
        signature,
        loc,
    } = effect
    else {
        return;
    };

    // Locally-declared function path: if the callee resolves to a single
    // FunctionExpression value whose aliasing effects we already know, build a
    // signature from it and substitute the call's args/receiver in. Mirrors the
    // TS `state.values(effect.function)` single-FunctionExpression branch.
    if let Some(data) = state.single_fn_expr(function) {
        if let Some(sig_effects) =
            compute_effects_for_fn_expr_signature(ctx, &data, into, receiver, args, loc)
        {
            // `MutateTransitiveConditionally <function>` then the substituted
            // signature effects (TS InferMutationAliasingEffects Apply case).
            apply_effect(
                ctx,
                state,
                &AliasingEffect::MutateTransitiveConditionally {
                    value: function.clone(),
                },
                initialized,
                effects,
            );
            for se in sig_effects {
                apply_effect(ctx, state, &se, initialized, effects);
            }
            return;
        }
    }

    if let Some(sig) = signature {
        if let Some(aliasing) = &sig.aliasing {
            if let Some(sig_effects) = compute_effects_for_signature(
                ctx, aliasing, into, receiver, args, loc,
            ) {
                for se in sig_effects {
                    apply_effect(ctx, state, &se, initialized, effects);
                }
                return;
            }
        }
        // Legacy signature path.
        let legacy = compute_effects_for_legacy_signature(state, sig, into, receiver, args);
        for le in legacy {
            apply_effect(ctx, state, &le, initialized, effects);
        }
        return;
    }

    // No signature: default capture path.
    apply_effect(
        ctx,
        state,
        &AliasingEffect::Create {
            into: into.clone(),
            value: ValueKind::Mutable,
            reason: ValueReason::Other,
        },
        initialized,
        effects,
    );

    // Build the operand list `[receiver, function, ...args]`, tracking the TS
    // *object identity* of each slot so the cross-product `Capture` can skip
    // `other === arg`. For CallExpression/NewExpression `receiver` and `function`
    // are the *same* Place object (both the callee), so they share an object id;
    // for MethodCall they are distinct. Args are always distinct objects.
    let receiver_is_function = receiver.identifier.id == function.identifier.id;
    let function_oid = if receiver_is_function { 0 } else { 1 };
    let mut operands: Vec<(Place, bool, usize)> = Vec::new(); // (place, is_spread, object_id)
    operands.push((receiver.clone(), false, 0));
    operands.push((function.clone(), false, function_oid));
    let mut next_oid = 2usize;
    for arg in args {
        match arg {
            ApplyArg::Identifier(p) => {
                operands.push((p.clone(), false, next_oid));
                next_oid += 1;
            }
            ApplyArg::Spread(p) => {
                operands.push((p.clone(), true, next_oid));
                next_oid += 1;
            }
            ApplyArg::Hole => {}
        }
    }

    for idx in 0..operands.len() {
        let (operand, is_spread, oid) = operands[idx].clone();
        // `operand !== effect.function || effect.mutatesFunction`: object identity
        // — the operand is the function only when it is the function slot's object.
        let is_function = oid == function_oid;
        if !is_function || *mutates_function {
            apply_effect(
                ctx,
                state,
                &AliasingEffect::MutateTransitiveConditionally {
                    value: operand.clone(),
                },
                initialized,
                effects,
            );
        }
        if is_spread {
            if let Some(mi) = conditionally_mutate_iterator(&operand) {
                apply_effect(ctx, state, &mi, initialized, effects);
            }
        }
        apply_effect(
            ctx,
            state,
            &AliasingEffect::MaybeAlias {
                from: operand.clone(),
                into: into.clone(),
            },
            initialized,
            effects,
        );
        for (other, _, other_oid) in operands.iter() {
            // TS: `if (other === arg) continue;` where `arg` is the array element
            // and `other` is `otherArg.place` (a Place). For an Identifier arg,
            // `arg` IS the place, so this skips the same object (matched via oid,
            // which also collapses receiver===function for CallExpression). For a
            // Spread arg, `arg` is the SpreadPattern wrapper — never equal to a
            // Place — so a spread operand is *not* skipped against any slot,
            // including its own (producing the self-capture seen in the oracle).
            if !is_spread && *other_oid == oid {
                continue;
            }
            apply_effect(
                ctx,
                state,
                &AliasingEffect::Capture {
                    from: operand.clone(),
                    into: other.clone(),
                },
                initialized,
                effects,
            );
        }
    }
}

/// `computeEffectsForSignature` for a signature built dynamically from a locally
/// declared `FunctionExpression` (`buildSignatureFromFunctionExpression` +
/// `computeEffectsForSignature`). The signature's effects are `AliasingEffect`s
/// referencing the closure's own identifier ids (params/returns/context); we
/// build an `IdentifierId`-keyed substitution table from the call site and
/// substitute. Returns `None` (the call bails to the default capture path) if any
/// substitution is missing or has the wrong cardinality, exactly as the TS does.
fn compute_effects_for_fn_expr_signature(
    ctx: &mut Context,
    data: &crate::hir::instruction::FnExprSignatureData,
    lvalue: &Place,
    receiver: &Place,
    args: &[ApplyArg],
    loc: &SourceLocation,
) -> Option<Vec<AliasingEffect>> {
    // Arity checks (TS): not enough args, or too many with no rest param.
    if data.params.len() > args.len() || (args.len() > data.params.len() && data.rest.is_none()) {
        return None;
    }

    let mut subst: HashMap<IdentifierId, Vec<Place>> = HashMap::new();
    // `signature.receiver = makeIdentifierId(0)`; `signature.returns`.
    subst.insert(IdentifierId::new(0), vec![receiver.clone()]);
    subst.insert(data.returns, vec![lvalue.clone()]);

    let mut mutable_spreads: HashSet<IdentifierId> = HashSet::new();
    for (i, arg) in args.iter().enumerate() {
        match arg {
            ApplyArg::Hole => {}
            ApplyArg::Identifier(place) => {
                if i >= data.params.len() {
                    let rest = data.rest?;
                    subst.entry(rest).or_default().push(place.clone());
                } else {
                    subst.insert(data.params[i], vec![place.clone()]);
                }
            }
            ApplyArg::Spread(place) => {
                let rest = data.rest?;
                subst.entry(rest).or_default().push(place.clone());
                if conditionally_mutate_iterator(place).is_some() {
                    mutable_spreads.insert(place.identifier.id);
                }
            }
        }
    }

    // Context operands substitute to themselves (so closure-body effects that
    // reference captured values still resolve).
    for operand in &data.context {
        subst.insert(operand.identifier.id, vec![operand.clone()]);
    }

    let single = |subst: &HashMap<IdentifierId, Vec<Place>>, id: IdentifierId| -> Option<Place> {
        let v = subst.get(&id)?;
        if v.len() != 1 {
            return None;
        }
        Some(v[0].clone())
    };

    let mut out: Vec<AliasingEffect> = Vec::new();
    for effect in &data.effects {
        match effect {
            AliasingEffect::MaybeAlias { from, into }
            | AliasingEffect::Assign { from, into }
            | AliasingEffect::ImmutableCapture { from, into }
            | AliasingEffect::Alias { from, into }
            | AliasingEffect::CreateFrom { from, into }
            | AliasingEffect::Capture { from, into } => {
                let froms = subst.get(&from.identifier.id).cloned().unwrap_or_default();
                let intos = subst.get(&into.identifier.id).cloned().unwrap_or_default();
                for f in &froms {
                    for t in &intos {
                        out.push(rebuild_from_into(effect, f.clone(), t.clone()));
                    }
                }
            }
            AliasingEffect::Impure { place, reason }
            | AliasingEffect::MutateFrozen { place, reason } => {
                for value in subst.get(&place.identifier.id).cloned().unwrap_or_default() {
                    out.push(match effect {
                        AliasingEffect::Impure { .. } => AliasingEffect::Impure {
                            place: value,
                            reason: reason.clone(),
                        },
                        _ => AliasingEffect::MutateFrozen {
                            place: value,
                            reason: reason.clone(),
                        },
                    });
                }
            }
            AliasingEffect::MutateGlobal { place, reason } => {
                for value in subst.get(&place.identifier.id).cloned().unwrap_or_default() {
                    out.push(AliasingEffect::MutateGlobal {
                        place: value,
                        reason: reason.clone(),
                    });
                }
            }
            AliasingEffect::Render { place } => {
                for value in subst.get(&place.identifier.id).cloned().unwrap_or_default() {
                    out.push(AliasingEffect::Render { place: value });
                }
            }
            AliasingEffect::Mutate { value, reason } => {
                for v in subst.get(&value.identifier.id).cloned().unwrap_or_default() {
                    out.push(AliasingEffect::Mutate {
                        value: v,
                        reason: *reason,
                    });
                }
            }
            AliasingEffect::MutateTransitive { value }
            | AliasingEffect::MutateTransitiveConditionally { value }
            | AliasingEffect::MutateConditionally { value } => {
                for v in subst.get(&value.identifier.id).cloned().unwrap_or_default() {
                    out.push(rebuild_mutate(effect, v));
                }
            }
            AliasingEffect::Freeze { value, reason } => {
                for v in subst.get(&value.identifier.id).cloned().unwrap_or_default() {
                    // `mutableSpreads` for hook args is a TODO in the TS; the
                    // curated corpus never reaches it, so we just emit the Freeze.
                    out.push(AliasingEffect::Freeze {
                        value: v,
                        reason: *reason,
                    });
                }
            }
            AliasingEffect::Create {
                into,
                value,
                reason,
            } => {
                for v in subst.get(&into.identifier.id).cloned().unwrap_or_default() {
                    out.push(AliasingEffect::Create {
                        into: v,
                        value: *value,
                        reason: *reason,
                    });
                }
            }
            AliasingEffect::Apply {
                receiver: r,
                function: f,
                mutates_function,
                args: a,
                into: i,
                signature: s,
                ..
            } => {
                let ar = single(&subst, r.identifier.id)?;
                let af = single(&subst, f.identifier.id)?;
                let ai = single(&subst, i.identifier.id)?;
                let mut apply_args: Vec<ApplyArg> = Vec::new();
                for arg in a {
                    match arg {
                        ApplyArg::Hole => apply_args.push(ApplyArg::Hole),
                        ApplyArg::Identifier(p) => {
                            apply_args.push(ApplyArg::Identifier(single(&subst, p.identifier.id)?));
                        }
                        ApplyArg::Spread(p) => {
                            apply_args.push(ApplyArg::Spread(single(&subst, p.identifier.id)?));
                        }
                    }
                }
                out.push(AliasingEffect::Apply {
                    receiver: ar,
                    function: af,
                    mutates_function: *mutates_function,
                    args: apply_args,
                    into: ai,
                    signature: s.clone(),
                    loc: loc.clone(),
                });
            }
            // `CreateFunction` in a signature is a TS `throwTodo`; not reachable
            // for the corpus. Bail to the default path rather than emit garbage.
            AliasingEffect::CreateFunction { .. } => return None,
        }
    }
    let _ = ctx;
    let _ = mutable_spreads;
    Some(out)
}

/// Rebuild a from/into-shaped effect with substituted places.
fn rebuild_from_into(effect: &AliasingEffect, from: Place, into: Place) -> AliasingEffect {
    match effect {
        AliasingEffect::MaybeAlias { .. } => AliasingEffect::MaybeAlias { from, into },
        AliasingEffect::Assign { .. } => AliasingEffect::Assign { from, into },
        AliasingEffect::ImmutableCapture { .. } => AliasingEffect::ImmutableCapture { from, into },
        AliasingEffect::Alias { .. } => AliasingEffect::Alias { from, into },
        AliasingEffect::CreateFrom { .. } => AliasingEffect::CreateFrom { from, into },
        _ => AliasingEffect::Capture { from, into },
    }
}

/// Rebuild a value-shaped mutate effect with a substituted place.
fn rebuild_mutate(effect: &AliasingEffect, value: Place) -> AliasingEffect {
    match effect {
        AliasingEffect::MutateTransitive { .. } => AliasingEffect::MutateTransitive { value },
        AliasingEffect::MutateConditionally { .. } => {
            AliasingEffect::MutateConditionally { value }
        }
        _ => AliasingEffect::MutateTransitiveConditionally { value },
    }
}
