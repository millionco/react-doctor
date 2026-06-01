// Included into `infer_mutation_aliasing_effects.rs`. Signature computation
// (`computeSignatureForInstruction`), legacy + aliasing signature lowering.

/// Convert a [`CallArgument`] to an [`ApplyArg`].
fn call_arg_to_apply_arg(arg: &CallArgument) -> ApplyArg {
    match arg {
        CallArgument::Place(p) => ApplyArg::Identifier(p.clone()),
        CallArgument::Spread(s) => ApplyArg::Spread(s.place.clone()),
    }
}

/// `computeSignatureForInstruction`.
fn compute_signature_for_instruction(ctx: &mut Context, instr: &Instruction) -> Vec<AliasingEffect> {
    let lvalue = &instr.lvalue;
    let mut effects: Vec<AliasingEffect> = Vec::new();
    match &instr.value {
        InstructionValue::ArrayExpression { elements, .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Mutable,
                reason: ValueReason::Other,
            });
            for element in elements {
                match element {
                    ArrayElement::Place(p) => effects.push(AliasingEffect::Capture {
                        from: p.clone(),
                        into: lvalue.clone(),
                    }),
                    ArrayElement::Spread(s) => {
                        if let Some(mi) = conditionally_mutate_iterator(&s.place) {
                            effects.push(mi);
                        }
                        effects.push(AliasingEffect::Capture {
                            from: s.place.clone(),
                            into: lvalue.clone(),
                        });
                    }
                    ArrayElement::Hole => {}
                }
            }
        }
        InstructionValue::ObjectExpression { properties, .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Mutable,
                reason: ValueReason::Other,
            });
            for property in properties {
                let place = match property {
                    ObjectExpressionProperty::Property(p) => &p.place,
                    ObjectExpressionProperty::Spread(s) => &s.place,
                };
                effects.push(AliasingEffect::Capture {
                    from: place.clone(),
                    into: lvalue.clone(),
                });
            }
        }
        InstructionValue::Await { value, .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Mutable,
                reason: ValueReason::Other,
            });
            effects.push(AliasingEffect::MutateTransitiveConditionally {
                value: value.clone(),
            });
            effects.push(AliasingEffect::Capture {
                from: value.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::NewExpression { callee, args, loc } => {
            let signature = get_function_signature(&callee.identifier.type_);
            effects.push(AliasingEffect::Apply {
                receiver: callee.clone(),
                function: callee.clone(),
                mutates_function: false,
                args: args.iter().map(call_arg_to_apply_arg).collect(),
                into: lvalue.clone(),
                signature,
                loc: loc.clone(),
            });
        }
        InstructionValue::CallExpression { callee, args, loc } => {
            let signature = get_function_signature(&callee.identifier.type_);
            effects.push(AliasingEffect::Apply {
                receiver: callee.clone(),
                function: callee.clone(),
                mutates_function: true,
                args: args.iter().map(call_arg_to_apply_arg).collect(),
                into: lvalue.clone(),
                signature,
                loc: loc.clone(),
            });
        }
        InstructionValue::MethodCall {
            receiver,
            property,
            args,
            loc,
        } => {
            let signature = get_function_signature(&property.identifier.type_);
            effects.push(AliasingEffect::Apply {
                receiver: receiver.clone(),
                function: property.clone(),
                mutates_function: false,
                args: args.iter().map(call_arg_to_apply_arg).collect(),
                into: lvalue.clone(),
                signature,
                loc: loc.clone(),
            });
        }
        InstructionValue::PropertyDelete { object, .. }
        | InstructionValue::ComputedDelete { object, .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
            effects.push(AliasingEffect::Mutate {
                value: object.clone(),
                reason: None,
            });
        }
        InstructionValue::PropertyLoad { object, .. }
        | InstructionValue::ComputedLoad { object, .. } => {
            if is_primitive_type(&lvalue.identifier) {
                effects.push(AliasingEffect::Create {
                    into: lvalue.clone(),
                    value: ValueKind::Primitive,
                    reason: ValueReason::Other,
                });
            } else {
                effects.push(AliasingEffect::CreateFrom {
                    from: object.clone(),
                    into: lvalue.clone(),
                });
            }
        }
        InstructionValue::PropertyStore {
            object,
            property,
            value,
            ..
        } => {
            let mutation_reason = if matches!(property, PropertyLiteral::String(s) if s == "current")
                && matches!(object.identifier.type_, Type::Var { .. })
            {
                Some(MutationReason::AssignCurrentProperty)
            } else {
                None
            };
            effects.push(AliasingEffect::Mutate {
                value: object.clone(),
                reason: mutation_reason,
            });
            effects.push(AliasingEffect::Capture {
                from: value.clone(),
                into: object.clone(),
            });
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        InstructionValue::ComputedStore { object, value, .. } => {
            effects.push(AliasingEffect::Mutate {
                value: object.clone(),
                reason: None,
            });
            effects.push(AliasingEffect::Capture {
                from: value.clone(),
                into: object.clone(),
            });
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        InstructionValue::ObjectMethod { lowered_func, .. }
        | InstructionValue::FunctionExpression { lowered_func, .. } => {
            let captures: Vec<Place> = lowered_func
                .func
                .context
                .iter()
                .filter(|op| op.effect == Effect::Capture)
                .cloned()
                .collect();
            // `capturesRef` (TS): any context operand is a ref / ref-value.
            let captures_ref = lowered_func
                .func
                .context
                .iter()
                .any(|op| is_ref_or_ref_value(&op.identifier));
            // `hasTrackedSideEffects` (TS): the lowered function's aliasing
            // effects contain a MutateFrozen / MutateGlobal / Impure.
            let has_tracked_side_effects = lowered_func
                .func
                .aliasing_effects
                .as_ref()
                .is_some_and(|effs| {
                    effs.iter().any(|e| {
                        matches!(
                            e,
                            AliasingEffect::MutateFrozen { .. }
                                | AliasingEffect::MutateGlobal { .. }
                                | AliasingEffect::Impure { .. }
                        )
                    })
                });
            // `buildSignatureFromFunctionExpression` data — only meaningful when
            // the lowered function has aliasing effects (the TS gates the
            // locally-declared `Apply` path on `aliasingEffects != null`).
            let signature_data = lowered_func.func.aliasing_effects.as_ref().map(|effs| {
                let mut params: Vec<IdentifierId> = Vec::new();
                let mut rest: Option<IdentifierId> = None;
                let mut param_places: Vec<Place> = Vec::new();
                for param in &lowered_func.func.params {
                    match param {
                        FunctionParam::Place(p) => {
                            params.push(p.identifier.id);
                            param_places.push(p.clone());
                        }
                        FunctionParam::Spread(s) => {
                            rest = Some(s.place.identifier.id);
                            param_places.push(s.place.clone());
                        }
                    }
                }
                // `buildSignatureFromFunctionExpression`: a no-rest callback still
                // gets a synthetic rest temporary (`rest ?? createTemporaryPlace`),
                // so a call passing more args than params (e.g. the map/filter
                // aliasing inner-Apply: `[@item, Hole, @receiver]` against a 1-param
                // callback) routes the extra args into the rest substitution instead
                // of bailing to the default capture path.
                let rest = rest.unwrap_or_else(|| {
                    create_temporary_place(ctx, &lowered_func.func.loc).identifier.id
                });
                Box::new(crate::hir::instruction::FnExprSignatureData {
                    params,
                    rest: Some(rest),
                    returns: lowered_func.func.returns.identifier.id,
                    context: lowered_func.func.context.clone(),
                    effects: effs.clone(),
                    param_places,
                })
            });
            effects.push(AliasingEffect::CreateFunction {
                into: lvalue.clone(),
                captures,
                function_returns: lowered_func.func.returns.identifier.id,
                captures_ref,
                has_tracked_side_effects,
                signature_data,
            });
        }
        InstructionValue::GetIterator { collection, .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Mutable,
                reason: ValueReason::Other,
            });
            if is_array_type(&collection.identifier)
                || is_map_type(&collection.identifier)
                || is_set_type(&collection.identifier)
            {
                effects.push(AliasingEffect::Capture {
                    from: collection.clone(),
                    into: lvalue.clone(),
                });
            } else {
                effects.push(AliasingEffect::Alias {
                    from: collection.clone(),
                    into: lvalue.clone(),
                });
                effects.push(AliasingEffect::MutateTransitiveConditionally {
                    value: collection.clone(),
                });
            }
        }
        InstructionValue::IteratorNext {
            iterator,
            collection,
            ..
        } => {
            effects.push(AliasingEffect::MutateConditionally {
                value: iterator.clone(),
            });
            effects.push(AliasingEffect::CreateFrom {
                from: collection.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::NextPropertyOf { .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        InstructionValue::JsxExpression {
            tag,
            props,
            children,
            ..
        } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Frozen,
                reason: ValueReason::JsxCaptured,
            });
            for operand in each_instruction_value_operand(&instr.value) {
                effects.push(AliasingEffect::Freeze {
                    value: operand.clone(),
                    reason: ValueReason::JsxCaptured,
                });
                effects.push(AliasingEffect::Capture {
                    from: operand.clone(),
                    into: lvalue.clone(),
                });
            }
            if let JsxTag::Place(place) = tag {
                effects.push(AliasingEffect::Render {
                    place: place.clone(),
                });
            }
            if let Some(children) = children {
                for child in children {
                    effects.push(AliasingEffect::Render {
                        place: child.clone(),
                    });
                }
            }
            for prop in props {
                if let JsxAttribute::Attribute { place, .. } = prop {
                    if is_function_returning_jsx(&place.identifier.type_) {
                        effects.push(AliasingEffect::Render {
                            place: place.clone(),
                        });
                    }
                }
            }
        }
        InstructionValue::JsxFragment { .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Frozen,
                reason: ValueReason::JsxCaptured,
            });
            for operand in each_instruction_value_operand(&instr.value) {
                effects.push(AliasingEffect::Freeze {
                    value: operand.clone(),
                    reason: ValueReason::JsxCaptured,
                });
                effects.push(AliasingEffect::Capture {
                    from: operand.clone(),
                    into: lvalue.clone(),
                });
            }
        }
        InstructionValue::DeclareLocal { lvalue: lv, .. } => {
            effects.push(AliasingEffect::Create {
                into: lv.place.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        InstructionValue::Destructure { lvalue: lv, value, .. } => {
            for place in each_pattern_item(&lv.pattern, ctx) {
                let (place, is_spread) = place;
                if is_primitive_type(&place.identifier) {
                    effects.push(AliasingEffect::Create {
                        into: place.clone(),
                        value: ValueKind::Primitive,
                        reason: ValueReason::Other,
                    });
                } else if !is_spread {
                    effects.push(AliasingEffect::CreateFrom {
                        from: value.clone(),
                        into: place.clone(),
                    });
                } else {
                    let kind = if ctx.non_mutating_spreads.contains(&place.identifier.id) {
                        ValueKind::Frozen
                    } else {
                        ValueKind::Mutable
                    };
                    effects.push(AliasingEffect::Create {
                        into: place.clone(),
                        value: kind,
                        reason: ValueReason::Other,
                    });
                    effects.push(AliasingEffect::Capture {
                        from: value.clone(),
                        into: place.clone(),
                    });
                }
            }
            effects.push(AliasingEffect::Assign {
                from: value.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::LoadContext { place, .. } => {
            effects.push(AliasingEffect::CreateFrom {
                from: place.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::DeclareContext { kind, place, .. } => {
            let is_hoisted_decl = matches!(
                kind,
                InstructionKind::HoistedConst
                    | InstructionKind::HoistedFunction
                    | InstructionKind::HoistedLet
            );
            if !ctx
                .hoisted_context_declarations
                .contains_key(&place.identifier.declaration_id)
                || is_hoisted_decl
            {
                effects.push(AliasingEffect::Create {
                    into: place.clone(),
                    value: ValueKind::Mutable,
                    reason: ValueReason::Other,
                });
            } else {
                effects.push(AliasingEffect::Mutate {
                    value: place.clone(),
                    reason: None,
                });
            }
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        InstructionValue::StoreContext {
            kind, place, value, ..
        } => {
            if matches!(kind, InstructionKind::Reassign)
                || ctx
                    .hoisted_context_declarations
                    .contains_key(&place.identifier.declaration_id)
            {
                effects.push(AliasingEffect::Mutate {
                    value: place.clone(),
                    reason: None,
                });
            } else {
                effects.push(AliasingEffect::Create {
                    into: place.clone(),
                    value: ValueKind::Mutable,
                    reason: ValueReason::Other,
                });
            }
            effects.push(AliasingEffect::Capture {
                from: value.clone(),
                into: place.clone(),
            });
            effects.push(AliasingEffect::Assign {
                from: value.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::LoadLocal { place, .. } => {
            effects.push(AliasingEffect::Assign {
                from: place.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::StoreLocal { lvalue: lv, value, .. } => {
            effects.push(AliasingEffect::Assign {
                from: value.clone(),
                into: lv.place.clone(),
            });
            effects.push(AliasingEffect::Assign {
                from: value.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::PostfixUpdate { lvalue: lv, .. }
        | InstructionValue::PrefixUpdate { lvalue: lv, .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
            effects.push(AliasingEffect::Create {
                into: lv.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        InstructionValue::StoreGlobal { name, value, .. } => {
            effects.push(AliasingEffect::MutateGlobal {
                place: value.clone(),
                reason: "Cannot reassign variables declared outside of the component/hook"
                    .to_string(),
            });
            let _ = name;
            effects.push(AliasingEffect::Assign {
                from: value.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::TypeCastExpression { value, .. } => {
            effects.push(AliasingEffect::Assign {
                from: value.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::LoadGlobal { .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Global,
                reason: ValueReason::Global,
            });
        }
        InstructionValue::StartMemoize { .. } | InstructionValue::FinishMemoize { .. } => {
            // Only with `enablePreserveExistingMemoizationGuarantees` is each
            // marker operand frozen with reason `HookCaptured` (the memoized value
            // + source deps); when the flag is off the memoized value is left
            // mutable so a later transitive mutation can still extend its reactive
            // scope (`InferMutationAliasingEffects.ts` `case 'StartMemoize'`). The
            // markers themselves are only present when *some* memoization
            // validation is enabled, but the freeze is gated on this flag alone.
            if ctx.enable_preserve_existing_memoization_guarantees {
                for operand in each_instruction_value_operand(&instr.value) {
                    effects.push(AliasingEffect::Freeze {
                        value: operand.clone(),
                        reason: ValueReason::HookCaptured,
                    });
                }
            }
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        InstructionValue::TaggedTemplateExpression { .. }
        | InstructionValue::BinaryExpression { .. }
        | InstructionValue::Debugger { .. }
        | InstructionValue::JsxText { .. }
        | InstructionValue::MetaProperty { .. }
        | InstructionValue::Primitive { .. }
        | InstructionValue::RegExpLiteral { .. }
        | InstructionValue::TemplateLiteral { .. }
        | InstructionValue::UnaryExpression { .. }
        | InstructionValue::UnsupportedNode { .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
    }
    effects
}

/// `isJsxType(type.return)` test for a function returning jsx (used for Render of
/// jsx-returning props). Returns true if `type` is a Function whose return is jsx
/// (or a Phi with a jsx operand).
fn is_function_returning_jsx(type_: &Type) -> bool {
    match type_ {
        Type::Function { return_type, .. } => {
            is_jsx_type(return_type)
                || matches!(return_type.as_ref(), Type::Phi { operands } if operands.iter().any(is_jsx_type))
        }
        _ => false,
    }
}

/// `eachPatternItem` flattened to `(place, is_spread)`.
fn each_pattern_item(pattern: &Pattern, _ctx: &Context) -> Vec<(Place, bool)> {
    use crate::hir::value::{ArrayPatternItem, ObjectPatternProperty};
    let mut out: Vec<(Place, bool)> = Vec::new();
    match pattern {
        Pattern::Array(arr) => {
            for item in &arr.items {
                match item {
                    ArrayPatternItem::Place(p) => out.push((p.clone(), false)),
                    ArrayPatternItem::Spread(s) => out.push((s.place.clone(), true)),
                    ArrayPatternItem::Hole => {}
                }
            }
        }
        Pattern::Object(obj) => {
            for prop in &obj.properties {
                match prop {
                    ObjectPatternProperty::Property(p) => out.push((p.place.clone(), false)),
                    ObjectPatternProperty::Spread(s) => out.push((s.place.clone(), true)),
                }
            }
        }
    }
    out
}

/// `computeEffectsForLegacySignature`.
fn compute_effects_for_legacy_signature(
    state: &InferenceState,
    signature: &CallSignature,
    lvalue: &Place,
    receiver: &Place,
    args: &[ApplyArg],
) -> Vec<AliasingEffect> {
    let return_value_reason = signature.return_value_reason;
    let mut effects: Vec<AliasingEffect> = Vec::new();
    effects.push(AliasingEffect::Create {
        into: lvalue.clone(),
        value: signature.return_value_kind,
        reason: return_value_reason,
    });

    // impure / knownIncompatible omitted (not exercised).

    let mut stores: Vec<Place> = Vec::new();
    let mut captures: Vec<Place> = Vec::new();

    // mutableOnlyIfOperandsAreMutable fast path.
    if signature.mutable_only_if_operands_are_mutable
        && are_arguments_immutable_and_non_mutating(state, args)
    {
        effects.push(AliasingEffect::Alias {
            from: receiver.clone(),
            into: lvalue.clone(),
        });
        for arg in args {
            let place = match arg {
                ApplyArg::Hole => continue,
                ApplyArg::Identifier(p) | ApplyArg::Spread(p) => p,
            };
            effects.push(AliasingEffect::ImmutableCapture {
                from: place.clone(),
                into: lvalue.clone(),
            });
        }
        return effects;
    }

    let mut visit = |place: &Place, effect: LegacyEffect, effects: &mut Vec<AliasingEffect>| {
        match effect {
            LegacyEffect::Store => {
                effects.push(AliasingEffect::Mutate {
                    value: place.clone(),
                    reason: None,
                });
                stores.push(place.clone());
            }
            LegacyEffect::Capture => captures.push(place.clone()),
            LegacyEffect::ConditionallyMutate => {
                effects.push(AliasingEffect::MutateTransitiveConditionally {
                    value: place.clone(),
                });
            }
            LegacyEffect::ConditionallyMutateIterator => {
                if let Some(mi) = conditionally_mutate_iterator(place) {
                    effects.push(mi);
                }
                effects.push(AliasingEffect::Capture {
                    from: place.clone(),
                    into: lvalue.clone(),
                });
            }
            LegacyEffect::Freeze => {
                effects.push(AliasingEffect::Freeze {
                    value: place.clone(),
                    reason: return_value_reason,
                });
            }
            LegacyEffect::Mutate => {
                effects.push(AliasingEffect::MutateTransitive {
                    value: place.clone(),
                });
            }
            LegacyEffect::Read => {
                effects.push(AliasingEffect::ImmutableCapture {
                    from: place.clone(),
                    into: lvalue.clone(),
                });
            }
        }
    };

    if signature.callee_effect != LegacyEffect::Capture {
        effects.push(AliasingEffect::Alias {
            from: receiver.clone(),
            into: lvalue.clone(),
        });
    }
    visit(receiver, signature.callee_effect, &mut effects);

    for (i, arg) in args.iter().enumerate() {
        let place = match arg {
            ApplyArg::Hole => continue,
            ApplyArg::Identifier(p) | ApplyArg::Spread(p) => p,
        };
        let is_identifier = matches!(arg, ApplyArg::Identifier(_));
        let signature_effect = if is_identifier && i < signature.positional_params.len() {
            Some(signature.positional_params[i])
        } else {
            signature.rest_param
        };
        let effect = get_argument_effect(signature_effect, arg);
        visit(place, effect, &mut effects);
    }

    if !captures.is_empty() {
        if stores.is_empty() {
            for capture in &captures {
                effects.push(AliasingEffect::Alias {
                    from: capture.clone(),
                    into: lvalue.clone(),
                });
            }
        } else {
            for capture in &captures {
                for store in &stores {
                    effects.push(AliasingEffect::Capture {
                        from: capture.clone(),
                        into: store.clone(),
                    });
                }
            }
        }
    }
    effects
}

/// `getArgumentEffect`.
fn get_argument_effect(signature_effect: Option<LegacyEffect>, arg: &ApplyArg) -> LegacyEffect {
    match signature_effect {
        Some(eff) => {
            if matches!(arg, ApplyArg::Identifier(_)) {
                eff
            } else if matches!(eff, LegacyEffect::Mutate | LegacyEffect::ConditionallyMutate) {
                eff
            } else {
                // spread + Capture/Read/Store -> ConditionallyMutateIterator
                LegacyEffect::ConditionallyMutateIterator
            }
        }
        None => LegacyEffect::ConditionallyMutate,
    }
}

/// `isKnownMutableEffect` (`InferMutationAliasingEffects.ts`): `Store`,
/// `ConditionallyMutate`, `ConditionallyMutateIterator`, `Mutate` are mutable;
/// `Read`, `Capture`, `Freeze` are not.
fn is_known_mutable_effect(effect: LegacyEffect) -> bool {
    matches!(
        effect,
        LegacyEffect::Store
            | LegacyEffect::ConditionallyMutate
            | LegacyEffect::ConditionallyMutateIterator
            | LegacyEffect::Mutate
    )
}

/// `areArgumentsImmutableAndNonMutating` — returns true iff every argument is both
/// non-mutable (immutable / frozen) *and* not a function that might mutate its
/// arguments. Function expressions count as frozen so long as they don't mutate
/// free variables, so a frozen value backed by a mutating-param lambda is still
/// excluded by the second check (`InferMutationAliasingEffects.ts:2506-2561`).
fn are_arguments_immutable_and_non_mutating(state: &InferenceState, args: &[ApplyArg]) -> bool {
    for arg in args {
        if let ApplyArg::Hole = arg {
            continue;
        }
        // (1) Known function shapes (e.g. global `Boolean`/`Number`/`String`): the
        // result depends only on whether the function's signature has any
        // known-mutable param/rest effect. This mirrors the TS early `return`: the
        // first Identifier arg whose `type.kind === 'Function'` with a resolvable
        // signature decides the whole call.
        if let ApplyArg::Identifier(place) = arg
            && matches!(place.identifier.type_, Type::Function { .. })
            && let Some(sig) = get_function_signature(&place.identifier.type_)
        {
            let positional_mutable =
                sig.positional_params.iter().any(|e| is_known_mutable_effect(*e));
            let rest_mutable = sig.rest_param.map(is_known_mutable_effect).unwrap_or(false);
            return !positional_mutable && !rest_mutable;
        }
        let place = match arg {
            ApplyArg::Identifier(p) | ApplyArg::Spread(p) => p,
            ApplyArg::Hole => continue,
        };
        // Only immutable values, or frozen lambdas are allowed. Globals, module
        // locals, and other locally-defined functions may mutate their arguments.
        match state.kind(place).kind {
            ValueKind::Primitive | ValueKind::Frozen => {}
            _ => return false,
        }
        // (2) Even a frozen value may be a lambda that mutates its inputs: if any
        // backing value is a FunctionExpression whose params have a non-trivial
        // mutable range (`end > start + 1`), the call is not operand-only-mutable.
        for value_id in state.value_ids(place) {
            if state.fn_expr_has_mutating_param(value_id) {
                return false;
            }
        }
    }
    true
}

/// `computeEffectsForSignature` for a parametric [`AliasingSignature`].
fn compute_effects_for_signature(
    ctx: &mut Context,
    signature: &AliasingSignature,
    lvalue: &Place,
    receiver: &Place,
    args: &[ApplyArg],
    _loc: &SourceLocation,
) -> Option<Vec<AliasingEffect>> {
    // Arity checks.
    if signature.params > args.len() || (args.len() > signature.params && !signature.has_rest) {
        return None;
    }
    let mut subst: HashMap<SigPlace, Vec<Place>> = HashMap::new();
    subst.insert(SigPlace::Receiver, vec![receiver.clone()]);
    subst.insert(SigPlace::Returns, vec![lvalue.clone()]);

    for (i, arg) in args.iter().enumerate() {
        if matches!(arg, ApplyArg::Hole) {
            continue;
        }
        let is_spread = matches!(arg, ApplyArg::Spread(_));
        let place = match arg {
            ApplyArg::Identifier(p) | ApplyArg::Spread(p) => p.clone(),
            ApplyArg::Hole => continue,
        };
        if i >= signature.params || is_spread {
            if !signature.has_rest {
                return None;
            }
            subst.entry(SigPlace::Rest).or_default().push(place);
        } else {
            subst.insert(SigPlace::Param(i), vec![place]);
        }
    }

    // Temporaries -> fresh synthetic places.
    for t in 0..signature.temporaries {
        let temp = create_temporary_place(ctx, &receiver.loc);
        subst.insert(SigPlace::Temporary(t), vec![temp]);
    }

    let mut effects: Vec<AliasingEffect> = Vec::new();
    for sig_effect in &signature.effects {
        match sig_effect {
            SigEffect::Capture { from, into } => {
                let from_places = subst.get(from).cloned().unwrap_or_default();
                let into_places = subst.get(into).cloned().unwrap_or_default();
                for f in &from_places {
                    for t in &into_places {
                        effects.push(AliasingEffect::Capture {
                            from: f.clone(),
                            into: t.clone(),
                        });
                    }
                }
            }
            SigEffect::CreateFrom { from, into } => {
                let from_places = subst.get(from).cloned().unwrap_or_default();
                let into_places = subst.get(into).cloned().unwrap_or_default();
                for f in &from_places {
                    for t in &into_places {
                        effects.push(AliasingEffect::CreateFrom {
                            from: f.clone(),
                            into: t.clone(),
                        });
                    }
                }
            }
            SigEffect::ImmutableCapture { from, into } => {
                let from_places = subst.get(from).cloned().unwrap_or_default();
                let into_places = subst.get(into).cloned().unwrap_or_default();
                for f in &from_places {
                    for t in &into_places {
                        effects.push(AliasingEffect::ImmutableCapture {
                            from: f.clone(),
                            into: t.clone(),
                        });
                    }
                }
            }
            SigEffect::Mutate(p) => {
                for place in subst.get(p).cloned().unwrap_or_default() {
                    effects.push(AliasingEffect::Mutate {
                        value: place,
                        reason: None,
                    });
                }
            }
            SigEffect::Create { into, value, reason } => {
                for place in subst.get(into).cloned().unwrap_or_default() {
                    effects.push(AliasingEffect::Create {
                        into: place,
                        value: *value,
                        reason: *reason,
                    });
                }
            }
            SigEffect::Freeze { value, reason } => {
                for place in subst.get(value).cloned().unwrap_or_default() {
                    effects.push(AliasingEffect::Freeze {
                        value: place,
                        reason: *reason,
                    });
                }
            }
            SigEffect::Alias { from, into } => {
                let from_places = subst.get(from).cloned().unwrap_or_default();
                let into_places = subst.get(into).cloned().unwrap_or_default();
                for f in &from_places {
                    for t in &into_places {
                        effects.push(AliasingEffect::Alias {
                            from: f.clone(),
                            into: t.clone(),
                        });
                    }
                }
            }
            SigEffect::Assign { from, into } => {
                let from_places = subst.get(from).cloned().unwrap_or_default();
                let into_places = subst.get(into).cloned().unwrap_or_default();
                for f in &from_places {
                    for t in &into_places {
                        effects.push(AliasingEffect::Assign {
                            from: f.clone(),
                            into: t.clone(),
                        });
                    }
                }
            }
            SigEffect::Apply {
                receiver: r,
                function: f,
                args: sargs,
                into,
                mutates_function,
            } => {
                let ar = single_subst(&subst, r)?;
                let af = single_subst(&subst, f)?;
                let ai = single_subst(&subst, into)?;
                let mut apply_args: Vec<ApplyArg> = Vec::new();
                for sa in sargs {
                    match sa {
                        None => apply_args.push(ApplyArg::Hole),
                        Some(sp) => {
                            let p = single_subst(&subst, sp)?;
                            apply_args.push(ApplyArg::Identifier(p));
                        }
                    }
                }
                effects.push(AliasingEffect::Apply {
                    receiver: ar,
                    function: af,
                    mutates_function: *mutates_function,
                    args: apply_args,
                    into: ai,
                    signature: None,
                    loc: _loc.clone(),
                });
            }
        }
    }
    Some(effects)
}

fn single_subst(subst: &HashMap<SigPlace, Vec<Place>>, p: &SigPlace) -> Option<Place> {
    let v = subst.get(p)?;
    if v.len() != 1 {
        return None;
    }
    Some(v[0].clone())
}

/// `createTemporaryPlace` — a synthetic temporary place with a fresh identifier.
/// Temporaries here only need a unique identifier id for substitution bookkeeping;
/// they never print (they back synthetic values, expanded into pushed effects).
fn create_temporary_place(ctx: &mut Context, loc: &SourceLocation) -> Place {
    // Use a high id range to avoid colliding with real identifiers.
    let id = 1_000_000 + ctx.alloc_value();
    Place {
        identifier: Identifier::make_temporary(
            IdentifierId::new(id),
            crate::hir::ids::TypeId::new(0),
            loc.clone(),
        ),
        effect: Effect::Unknown,
        reactive: false,
        loc: loc.clone(),
    }
}
