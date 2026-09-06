use oxc_span::GetSpan;

mod implementation {
    include!("no_pass_live_state_to_parent.rs");

    mod data_rule {
        use super::*;
        use oxc_span::GetSpan;

        const DATA_MESSAGE: &str =
            "Handing data back to a parent from a useEffect costs your users an extra render.";
        const DATA_FUNCTION_WRAPPER_HOOKS: [&str; 8] = [
            "useCallback",
            "useCallbackRef",
            "useEffectEvent",
            "useEvent",
            "useEventCallback",
            "useMemo",
            "useMemoizedFn",
            "useStableCallback",
        ];

        #[derive(Debug, Default, Clone)]
        pub struct NoPassDataToParent;

        declare_oxc_lint!(
            /// Warns when child-owned data is handed to a parent from an effect.
            NoPassDataToParent,
            react_doctor_native,
            perf,
            version = "0.1.0",
            short_description = "Data passed to parent via effect.",
        );

        impl Rule for NoPassDataToParent {
            fn should_run(&self, ctx: &ContextHost) -> bool {
                !is_test_noise_file(ctx)
            }

            fn run_once<'a>(&self, ctx: &LintContext<'a>) {
                let write_analysis = build_possible_static_property_write_analysis(ctx);
                let node_index = build_local_callback_nearest_function_node_index(ctx);
                let mut owner_bindings_by_function = FxHashMap::default();
                for effect_node in ctx.nodes().iter() {
                    let AstKind::CallExpression(effect_call) = effect_node.kind() else {
                        continue;
                    };
                    if !is_react_hook_call(effect_call, &["useEffect"], ctx) {
                        continue;
                    }
                    let Some(callback_expression) = effect_call
                        .arguments
                        .first()
                        .and_then(Argument::as_expression)
                    else {
                        continue;
                    };
                    let Some(effect_function_id) =
                        exact_local_callback_function_id(callback_expression, ctx, &mut Vec::new())
                    else {
                        continue;
                    };
                    if data_effect_has_cleanup(effect_function_id, ctx) {
                        continue;
                    }
                    let Some(owner_function_id) =
                        live_state_nearest_function_id(effect_node.id(), ctx)
                    else {
                        continue;
                    };
                    let owner_bindings = owner_bindings_by_function
                        .entry(owner_function_id)
                        .or_insert_with(|| live_state_owner_bindings(owner_function_id, ctx));
                    if owner_bindings.names_by_symbol.is_empty()
                        && owner_bindings.whole_props_symbols.is_empty()
                    {
                        continue;
                    }

                    for &candidate_id in node_index.node_ids(effect_function_id) {
                        let candidate = ctx.nodes().get_node(candidate_id);
                        let AstKind::CallExpression(call) = candidate.kind() else {
                            continue;
                        };
                        if !data_call_is_synchronous(candidate, effect_function_id, ctx) {
                            continue;
                        }
                        if data_direct_call_reports(
                            candidate,
                            call,
                            owner_function_id,
                            owner_bindings,
                            &write_analysis,
                            &node_index,
                            ctx,
                        ) || data_helper_call_reports(
                            candidate,
                            call,
                            effect_function_id,
                            owner_function_id,
                            owner_bindings,
                            &write_analysis,
                            &node_index,
                            ctx,
                        ) {
                            ctx.diagnostic(OxcDiagnostic::warn(DATA_MESSAGE).with_label(call.span));
                        }
                    }
                }
            }
        }

        fn data_effect_has_cleanup(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
            if let AstKind::ArrowFunctionExpression(function) =
                ctx.nodes().get_node(function_id).kind()
                && function
                    .get_expression()
                    .is_some_and(|expression| data_expression_can_be_cleanup(expression, ctx))
            {
                return true;
            }
            ctx.nodes().iter().any(|candidate| {
                if live_state_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
                    return false;
                }
                let AstKind::ReturnStatement(statement) = candidate.kind() else {
                    return false;
                };
                statement
                    .argument
                    .as_ref()
                    .is_some_and(|argument| data_expression_can_be_cleanup(argument, ctx))
            })
        }

        fn data_expression_can_be_cleanup<'a>(
            expression: &Expression<'a>,
            ctx: &LintContext<'a>,
        ) -> bool {
            match expression.get_inner_expression() {
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
                Expression::Identifier(identifier) => {
                    let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                        return false;
                    };
                    let declaration = ctx.symbol_declaration(symbol_id);
                    matches!(declaration.kind(), AstKind::FormalParameter(_))
                        || ctx
                            .nodes()
                            .ancestors(declaration.id())
                            .any(|ancestor| matches!(ancestor.kind(), AstKind::FormalParameter(_)))
                        || exact_local_callback_function_id(expression, ctx, &mut Vec::new())
                            .is_some()
                }
                Expression::ConditionalExpression(conditional) => {
                    data_expression_can_be_cleanup(&conditional.consequent, ctx)
                        || data_expression_can_be_cleanup(&conditional.alternate, ctx)
                }
                expression => expression.as_member_expression().is_some(),
            }
        }

        #[allow(clippy::too_many_arguments)]
        fn data_direct_call_reports<'a>(
            call_node: &AstNode<'a>,
            call: &oxc_ast::ast::CallExpression<'a>,
            owner_function_id: NodeId,
            owner_bindings: &LiveStateOwnerBindings,
            write_analysis: &PossibleStaticPropertyWriteAnalysis,
            node_index: &LocalCallbackNearestFunctionNodeIndex,
            ctx: &LintContext<'a>,
        ) -> bool {
            if owner_bindings.is_custom_hook
                && call.callee.get_inner_expression().as_member_expression().is_some_and(|member| {
                    member.static_property_name() == Some("current")
                        && live_state_member_receiver_is_react_ref(member.object(), ctx)
                })
            {
                return false;
            }
            let mut callback_names = live_state_resolve_parent_callback_names(
                &call.callee,
                owner_function_id,
                owner_bindings,
                call.span.start,
                write_analysis,
                ctx,
                &mut FxHashSet::default(),
            );
            if data_callee_resolves_to_use_latest(&call.callee, ctx, &mut FxHashSet::default())
                || data_wrapped_callee_notifies_parent(&call.callee, owner_bindings, node_index, ctx)
                    == Some(false)
            {
                callback_names.clear();
            }
            if callback_names.is_empty()
                && let Some(callback_name) = data_parent_props_context_merge_callback_name(
                    &call.callee,
                    owner_bindings,
                    ctx,
                    &mut FxHashSet::default(),
                )
            {
                callback_names.insert(callback_name);
            }
            if callback_names.is_empty()
                && let Some(callback_name) = data_parent_props_object_merge_callback_alias_name(
                    &call.callee,
                    owner_bindings,
                    ctx,
                    &mut FxHashSet::default(),
                )
            {
                callback_names.insert(callback_name);
            }
            if callback_names.is_empty()
                && let Some(callback_name) =
                    data_alias_parent_callback_name(&call.callee, owner_bindings, ctx)
            {
                callback_names.insert(callback_name);
            }
            if !data_callback_call_is_notification(
                call_node,
                call,
                &callback_names,
                owner_bindings,
                ctx,
            ) {
                return false;
            }
            data_call_arguments_have_child_data(call, owner_function_id, owner_bindings, ctx)
                || data_setter_functional_updater_has_child_data(
                    call,
                    &callback_names,
                    owner_function_id,
                    owner_bindings,
                    ctx,
                )
        }

        #[allow(clippy::too_many_arguments)]
        fn data_helper_call_reports<'a>(
            _call_node: &AstNode<'a>,
            call: &oxc_ast::ast::CallExpression<'a>,
            effect_function_id: NodeId,
            owner_function_id: NodeId,
            owner_bindings: &LiveStateOwnerBindings,
            write_analysis: &PossibleStaticPropertyWriteAnalysis,
            node_index: &LocalCallbackNearestFunctionNodeIndex,
            ctx: &LintContext<'a>,
        ) -> bool {
            if data_wrapped_callee_notifies_parent(&call.callee, owner_bindings, node_index, ctx)
                != Some(true)
                || data_call_arguments_are_prop_echoes(call, owner_function_id, owner_bindings, ctx)
            {
                return false;
            }
            let Some(helper_function_id) = live_state_local_helper_function_id(&call.callee, ctx)
                .filter(|function_id| match ctx.nodes().parent_node(*function_id).kind() {
                    AstKind::CallExpression(wrapper) => data_wrapper_call_is_transparent(wrapper, ctx),
                    _ => true,
                })
            else {
                let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                    return false;
                };
                let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                    return false;
                };
                let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
                    return false;
                };
                let Some(Expression::CallExpression(wrapper)) = declarator.init.as_ref().map(Expression::get_inner_expression) else {
                    return false;
                };
                let Some(argument) = wrapper.arguments.first().and_then(Argument::as_expression) else {
                    return false;
                };
                return data_call_arguments_have_child_data(call, owner_function_id, owner_bindings, ctx)
                    || ctx.nodes().iter().any(|candidate| {
                        argument.span().contains_inclusive(candidate.span())
                            && matches!(candidate.kind(), AstKind::Function(_) | AstKind::ArrowFunctionExpression(_))
                            && data_function_id_has_child_source(candidate.id(), owner_function_id, owner_bindings, true, ctx)
                    });
            };
            if helper_function_id == effect_function_id {
                return false;
            }
            if data_call_arguments_have_child_data(call, owner_function_id, owner_bindings, ctx) {
                return true;
            }
            for function_id in
                live_state_reachable_helper_functions(helper_function_id, node_index, ctx)
            {
                if data_function_id_has_child_source(
                    function_id,
                    owner_function_id,
                    owner_bindings,
                    true,
                    ctx,
                ) {
                    return true;
                }
                for &candidate_id in node_index.node_ids(function_id) {
                    let candidate = ctx.nodes().get_node(candidate_id);
                    let AstKind::CallExpression(inner_call) = candidate.kind() else {
                        continue;
                    };
                    if !data_call_is_synchronous(candidate, function_id, ctx) {
                        continue;
                    }
                    let callback_names = live_state_resolve_parent_callback_names(
                        &inner_call.callee,
                        owner_function_id,
                        owner_bindings,
                        inner_call.span.start,
                        write_analysis,
                        ctx,
                        &mut FxHashSet::default(),
                    );
                    if !data_callback_call_is_notification(
                        candidate,
                        inner_call,
                        &callback_names,
                        owner_bindings,
                        ctx,
                    ) {
                        continue;
                    }
                    if data_call_arguments_have_child_data(
                            inner_call,
                            owner_function_id,
                            owner_bindings,
                            ctx,
                        )
                        || data_setter_functional_updater_has_child_data(
                            inner_call,
                            &callback_names,
                            owner_function_id,
                            owner_bindings,
                            ctx,
                        )
                    {
                        return true;
                    }
                }
            }
            false
        }

        fn data_wrapper_call_is_transparent<'a>(
            call: &oxc_ast::ast::CallExpression<'a>,
            ctx: &LintContext<'a>,
        ) -> bool {
            if is_react_hook_call(call, &["useCallback", "useEffectEvent", "useMemo"], ctx) {
                return true;
            }
            live_state_callee_name(&call.callee).is_some_and(|name| {
                name != "useEffectEvent" && DATA_FUNCTION_WRAPPER_HOOKS.contains(&name)
            })
        }

        fn data_callee_resolves_to_use_latest<'a>(
            expression: &Expression<'a>,
            ctx: &LintContext<'a>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> bool {
            let Expression::Identifier(identifier) = expression.get_inner_expression() else {
                return false;
            };
            let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                return false;
            };
            if !visited_symbols.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_write())
            {
                return false;
            }
            let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind()
            else {
                return false;
            };
            let Some(initializer) = &declarator.init else {
                return false;
            };
            match initializer.get_inner_expression() {
                Expression::CallExpression(call) => {
                    live_state_callee_name(&call.callee) == Some("useLatest")
                }
                Expression::Identifier(_) => {
                    data_callee_resolves_to_use_latest(initializer, ctx, visited_symbols)
                }
                _ => false,
            }
        }

        fn data_wrapped_callee_notifies_parent<'a>(
            expression: &Expression<'a>,
            owner_bindings: &LiveStateOwnerBindings,
            node_index: &LocalCallbackNearestFunctionNodeIndex,
            ctx: &LintContext<'a>,
        ) -> Option<bool> {
            let Expression::Identifier(identifier) = expression.get_inner_expression() else {
                return None;
            };
            let symbol_id = live_state_symbol_id(identifier, ctx)?;
            if ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| reference.is_write())
            {
                return Some(false);
            }
            let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind()
            else {
                return None;
            };
            let Expression::CallExpression(wrapper_call) =
                declarator.init.as_ref()?.get_inner_expression()
            else {
                return None;
            };
            if !data_wrapper_call_is_transparent(wrapper_call, ctx) {
                return None;
            }
            let wrapped_expression = wrapper_call.arguments.first()?.as_expression()?;
            if let Some(wrapped_function_id) =
                exact_local_callback_function_id(wrapped_expression, ctx, &mut Vec::new())
            {
                if matches!(wrapped_expression.get_inner_expression(), Expression::Identifier(_)) {
                    if !is_react_hook_call(wrapper_call, &["useCallback", "useEffectEvent"], ctx) {
                        return Some(false);
                    }
                    let wrapped_span = ctx.nodes().get_node(wrapped_function_id).span();
                    return Some(data_expression_references_owner_parameter(
                        wrapped_expression, owner_bindings, ctx, &mut FxHashSet::default(),
                    ) || ctx.nodes().iter().any(|candidate| {
                        wrapped_span.contains_inclusive(candidate.span())
                            && match candidate.kind() {
                                AstKind::CallExpression(call) => {
                                    data_expression_has_immutable_owner_parameter_origin(
                                        &call.callee, owner_bindings, ctx, &mut FxHashSet::default(),
                                    )
                                }
                                AstKind::IdentifierReference(identifier) => {
                                    live_state_symbol_id(identifier, ctx)
                                        .is_some_and(|symbol_id| owner_bindings.is_parameter(symbol_id))
                                }
                                _ => false,
                            }
                    }));
                }
                if matches!(ctx.nodes().get_node(wrapped_function_id).kind(),
                    AstKind::Function(function) if function.r#async)
                    || matches!(ctx.nodes().get_node(wrapped_function_id).kind(),
                        AstKind::ArrowFunctionExpression(function) if function.r#async)
                {
                    return Some(false);
                }
                for function_id in live_state_reachable_helper_functions(wrapped_function_id, node_index, ctx) {
                    for &candidate_id in node_index.node_ids(function_id) {
                        let AstKind::CallExpression(call) = ctx.nodes().get_node(candidate_id).kind() else {
                            continue;
                        };
                        let mut callee_root = call.callee.get_inner_expression();
                        while let Some(member) = callee_root.as_member_expression() {
                            if member.static_property_name().as_deref() == Some("current") {
                                return Some(false);
                            }
                            callee_root = member.object().get_inner_expression();
                        }
                        if live_state_member_receiver_is_react_ref(callee_root, ctx) {
                            return Some(false);
                        }
                    }
                }
            }
            let wrapped_span = wrapped_expression.span();
            Some(ctx.nodes().iter().any(|candidate| {
                if !wrapped_span.contains_inclusive(candidate.span()) {
                    return false;
                }
                match candidate.kind() {
                    AstKind::CallExpression(call) => {
                        data_expression_has_immutable_owner_parameter_origin(
                            &call.callee, owner_bindings, ctx, &mut FxHashSet::default(),
                        )
                    }
                    AstKind::IdentifierReference(inner_identifier) => {
                        live_state_symbol_id(inner_identifier, ctx).is_some_and(|inner_symbol_id| {
                            owner_bindings
                                .parameter_name(inner_symbol_id)
                                .is_some_and(data_is_handler_callback_name)
                        })
                    }
                    _ => false,
                }
            }))
        }

        fn data_call_is_synchronous(
            call_node: &AstNode<'_>,
            function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> bool {
            for ancestor in ctx.nodes().ancestors(call_node.id()) {
                if ancestor.id() == function_id {
                    return true;
                }
                if matches!(
                    ancestor.kind(),
                    AstKind::AwaitExpression(_)
                        | AstKind::Function(_)
                        | AstKind::ArrowFunctionExpression(_)
                ) || matches!(ancestor.kind(), AstKind::UnaryExpression(unary) if unary.operator.is_void())
                {
                    return false;
                }
            }
            false
        }

        fn data_callback_call_is_notification<'a>(
            _call_node: &AstNode<'a>,
            call: &oxc_ast::ast::CallExpression<'a>,
            callback_names: &FxHashSet<String>,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
        ) -> bool {
            !callback_names.is_empty()
                && !call.arguments.is_empty()
                && !callback_names
                    .iter()
                    .any(|name| data_is_command_callback_name(name))
                && (call
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .is_some_and(|member| member.static_property_name() == Some("current"))
                    || !live_state_is_data_sink_call(call, owner_bindings, ctx))
        }

        fn data_is_command_callback_name(name: &str) -> bool {
            ["fetch", "load", "refetch", "dispatch", "register", "render"]
                .iter()
                .any(|prefix| {
                    name.strip_prefix(prefix).is_some_and(|suffix| {
                        suffix.is_empty()
                            || suffix.starts_with('_')
                            || suffix
                                .as_bytes()
                                .first()
                                .is_some_and(u8::is_ascii_uppercase)
                    })
                })
        }

        fn data_is_handler_callback_name(name: &str) -> bool {
            ["on", "handle"].iter().any(|prefix| {
                name.strip_prefix(prefix)
                    .and_then(|suffix| suffix.as_bytes().first())
                    .is_some_and(u8::is_ascii_uppercase)
            })
        }

        fn data_parent_props_context_merge_callback_name<'a>(
            expression: &Expression<'a>,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> Option<String> {
            let Expression::Identifier(identifier) = expression.get_inner_expression() else {
                return None;
            };
            let symbol_id = live_state_symbol_id(identifier, ctx)?;
            if !visited_symbols.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_write())
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) {
                return None;
            }
            let initializer = declarator.init.as_ref()?;
            match &declarator.id {
                BindingPattern::ObjectPattern(_)
                    if !data_binding_symbol_has_default(&declarator.id, symbol_id) =>
                {
                    let property_name =
                        binding_property_name_for_symbol(&declarator.id, symbol_id)?;
                    data_expression_is_parent_props_context_merge(
                        initializer,
                        owner_bindings,
                        ctx,
                        &mut FxHashSet::default(),
                    )
                    .then_some(property_name)
                }
                BindingPattern::BindingIdentifier(binding)
                    if binding.symbol_id() == symbol_id
                        && matches!(
                            initializer.get_inner_expression(),
                            Expression::Identifier(_)
                        ) =>
                {
                    data_parent_props_context_merge_callback_name(
                        initializer,
                        owner_bindings,
                        ctx,
                        visited_symbols,
                    )
                }
                _ => None,
            }
        }

        fn data_parent_props_object_merge_callback_alias_name<'a>(
            expression: &Expression<'a>,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> Option<String> {
            let Expression::Identifier(identifier) = expression.get_inner_expression() else {
                return None;
            };
            let symbol_id = live_state_symbol_id(identifier, ctx)?;
            if !visited_symbols.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_write())
            {
                return None;
            }
            let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind()
            else {
                return None;
            };
            let initializer = declarator.init.as_ref()?;
            match &declarator.id {
                BindingPattern::ObjectPattern(_)
                    if binding_pattern_has_symbol(&declarator.id, symbol_id)
                        && matches!(
                            initializer.get_inner_expression(),
                            Expression::Identifier(_)
                                | Expression::StaticMemberExpression(_)
                                | Expression::ComputedMemberExpression(_)
                                | Expression::PrivateFieldExpression(_)
                        )
                        && data_expression_has_whole_props_spread(
                            initializer,
                            owner_bindings,
                            ctx,
                            &mut FxHashSet::default(),
                        ) =>
                {
                    Some(identifier.name.to_string())
                }
                BindingPattern::BindingIdentifier(binding)
                    if binding.symbol_id() == symbol_id
                        && matches!(
                            initializer.get_inner_expression(),
                            Expression::Identifier(_)
                        ) =>
                {
                    data_parent_props_object_merge_callback_alias_name(
                        initializer,
                        owner_bindings,
                        ctx,
                        visited_symbols,
                    )
                }
                _ => None,
            }
        }

        fn data_expression_has_whole_props_spread<'a>(
            expression: &Expression<'a>,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> bool {
            match expression.get_inner_expression() {
                Expression::Identifier(identifier) => {
                    let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                        return false;
                    };
                    if !visited_symbols.insert(symbol_id)
                        || ctx
                            .scoping()
                            .get_resolved_references(symbol_id)
                            .any(|reference| reference.is_write())
                    {
                        return false;
                    }
                    let declaration = ctx.symbol_declaration(symbol_id);
                    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                        return false;
                    };
                    matches!(&declarator.id, BindingPattern::BindingIdentifier(binding)
                        if binding.symbol_id() == symbol_id)
                        && declarator.init.as_ref().is_some_and(|initializer| {
                            data_expression_has_whole_props_spread(
                                initializer,
                                owner_bindings,
                                ctx,
                                visited_symbols,
                            )
                        })
                }
                Expression::ObjectExpression(object) => object.properties.iter().any(|property| {
                    let oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread) = property else {
                        return false;
                    };
                    data_expression_resolves_to_whole_props(
                        &spread.argument,
                        owner_bindings,
                        ctx,
                        &mut FxHashSet::default(),
                    )
                }),
                _ => false,
            }
        }

        fn data_expression_resolves_to_whole_props<'a>(
            expression: &Expression<'a>,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> bool {
            let Expression::Identifier(identifier) = expression.get_inner_expression() else {
                return false;
            };
            let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                return false;
            };
            if owner_bindings.whole_props_symbols.contains(&symbol_id) {
                return true;
            }
            if !visited_symbols.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_write())
            {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            matches!(&declarator.id, BindingPattern::BindingIdentifier(binding)
                if binding.symbol_id() == symbol_id)
                && declarator.init.as_ref().is_some_and(|initializer| {
                    data_expression_resolves_to_whole_props(
                        initializer,
                        owner_bindings,
                        ctx,
                        visited_symbols,
                    )
                })
        }

        fn data_binding_symbol_has_default(
            pattern: &BindingPattern<'_>,
            symbol_id: SymbolId,
        ) -> bool {
            match pattern {
                BindingPattern::AssignmentPattern(assignment) => {
                    binding_pattern_has_symbol(&assignment.left, symbol_id)
                }
                BindingPattern::ObjectPattern(object) => object
                    .properties
                    .iter()
                    .any(|property| data_binding_symbol_has_default(&property.value, symbol_id)),
                BindingPattern::ArrayPattern(array) => array
                    .elements
                    .iter()
                    .flatten()
                    .any(|element| data_binding_symbol_has_default(element, symbol_id)),
                BindingPattern::BindingIdentifier(_) => false,
            }
        }

        fn data_expression_is_parent_props_context_merge<'a>(
            expression: &Expression<'a>,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> bool {
            match expression.get_inner_expression() {
                Expression::Identifier(identifier) => {
                    let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                        return false;
                    };
                    if !visited_symbols.insert(symbol_id)
                        || ctx
                            .scoping()
                            .get_resolved_references(symbol_id)
                            .any(|reference| reference.is_write())
                    {
                        return false;
                    }
                    let declaration = ctx.symbol_declaration(symbol_id);
                    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                        return false;
                    };
                    matches!(&declarator.id, BindingPattern::BindingIdentifier(binding)
                        if binding.symbol_id() == symbol_id)
                        && matches!(ctx.nodes().parent_node(declaration.id()).kind(),
                            AstKind::VariableDeclaration(variable_declaration)
                                if variable_declaration.kind.is_const())
                        && declarator.init.as_ref().is_some_and(|initializer| {
                            data_expression_is_parent_props_context_merge(
                                initializer,
                                owner_bindings,
                                ctx,
                                visited_symbols,
                            )
                        })
                }
                Expression::ObjectExpression(object) => {
                    let [
                        oxc_ast::ast::ObjectPropertyKind::SpreadProperty(context_spread),
                        oxc_ast::ast::ObjectPropertyKind::SpreadProperty(props_spread),
                    ] = object.properties.as_slice()
                    else {
                        return false;
                    };
                    let Expression::Identifier(props_identifier) =
                        props_spread.argument.get_inner_expression()
                    else {
                        return false;
                    };
                    let Some(props_symbol_id) = live_state_symbol_id(props_identifier, ctx) else {
                        return false;
                    };
                    if !owner_bindings
                        .whole_props_symbols
                        .contains(&props_symbol_id)
                        || ctx
                            .scoping()
                            .get_resolved_references(props_symbol_id)
                            .count()
                            != 1
                    {
                        return false;
                    }
                    let Expression::Identifier(context_identifier) =
                        context_spread.argument.get_inner_expression()
                    else {
                        return false;
                    };
                    let Some(context_symbol_id) = live_state_symbol_id(context_identifier, ctx)
                    else {
                        return false;
                    };
                    if ctx
                        .scoping()
                        .get_resolved_references(context_symbol_id)
                        .count()
                        != 1
                    {
                        return false;
                    }
                    let context_declaration = ctx.symbol_declaration(context_symbol_id);
                    let AstKind::VariableDeclarator(context_declarator) =
                        context_declaration.kind()
                    else {
                        return false;
                    };
                    if !matches!(&context_declarator.id, BindingPattern::BindingIdentifier(binding)
                        if binding.symbol_id() == context_symbol_id)
                        || !matches!(ctx.nodes().parent_node(context_declaration.id()).kind(),
                            AstKind::VariableDeclaration(variable_declaration)
                                if variable_declaration.kind.is_const())
                    {
                        return false;
                    }
                    let Some(Expression::CallExpression(context_call)) = context_declarator
                        .init
                        .as_ref()
                        .map(Expression::get_inner_expression)
                    else {
                        return false;
                    };
                    let Expression::Identifier(context_hook) =
                        context_call.callee.get_inner_expression()
                    else {
                        return false;
                    };
                    let context_hook_name = context_hook.name.as_str();
                    context_hook_name
                        .strip_prefix("use")
                        .and_then(|suffix| suffix.strip_suffix("Context"))
                        .and_then(|context_name| context_name.as_bytes().first())
                        .is_some_and(u8::is_ascii_uppercase)
                        && live_state_symbol_id(context_hook, ctx)
                            .is_some_and(|symbol_id| data_symbol_is_import(symbol_id, ctx))
                }
                _ => false,
            }
        }

        fn data_expression_is_transparent_prop_echo<'a>(
            expression: &Expression<'a>,
            owner_function_id: NodeId,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
        ) -> bool {
            data_expression_references_owner_parameter(
                expression,
                owner_bindings,
                ctx,
                &mut FxHashSet::default(),
            ) && !data_expression_has_child_source(
                expression,
                owner_function_id,
                owner_bindings,
                ctx,
                &mut FxHashSet::default(),
            )
        }

        fn data_expression_references_owner_parameter<'a>(
            expression: &Expression<'a>,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> bool {
            let expression_span = expression.span();
            ctx.nodes().iter().any(|candidate| {
                if !expression_span.contains_inclusive(candidate.span()) {
                    return false;
                }
                let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                    return false;
                };
                let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                    return false;
                };
                if owner_bindings.is_parameter(symbol_id) {
                    return true;
                }
                if !visited_symbols.insert(symbol_id)
                    || ctx
                        .scoping()
                        .get_resolved_references(symbol_id)
                        .any(|reference| reference.is_write())
                {
                    return false;
                }
                let declaration = ctx.symbol_declaration(symbol_id);
                matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
                if declarator.init.as_ref().is_some_and(|initializer| {
                    data_expression_references_owner_parameter(
                        initializer,
                        owner_bindings,
                        ctx,
                        visited_symbols,
                    )
                }))
            })
        }

        fn data_call_arguments_are_prop_echoes<'a>(
            call: &oxc_ast::ast::CallExpression<'a>,
            owner_function_id: NodeId,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
        ) -> bool {
            let mut direct_data_argument_count = 0;
            let all_direct_data_arguments_are_prop_echoes = call.arguments.iter().all(|argument| {
                let Some(expression) = argument.as_expression() else {
                    return true;
                };
                if matches!(
                    expression.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                ) {
                    return true;
                }
                direct_data_argument_count += 1;
                data_expression_is_transparent_prop_echo(
                    expression,
                    owner_function_id,
                    owner_bindings,
                    ctx,
                )
            });
            direct_data_argument_count > 0 && all_direct_data_arguments_are_prop_echoes
        }

        fn data_call_arguments_have_child_data<'a>(
            call: &oxc_ast::ast::CallExpression<'a>,
            owner_function_id: NodeId,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
        ) -> bool {
            if data_call_arguments_are_prop_echoes(call, owner_function_id, owner_bindings, ctx) {
                return false;
            }
            call.arguments.iter().any(|argument| {
                let expression = match argument {
                    Argument::SpreadElement(spread) => &spread.argument,
                    argument => {
                        let Some(expression) = argument.as_expression() else {
                            return false;
                        };
                        expression
                    }
                };
                {
                    if matches!(
                        expression.get_inner_expression(),
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    ) || data_expression_is_handler_bag(expression, ctx)
                    {
                        return false;
                    }
                    ctx.nodes().iter().any(|candidate| {
                        expression.span().contains_inclusive(candidate.span())
                            && matches!(candidate.kind(), AstKind::IdentifierReference(identifier)
                                if ctx.is_reference_to_global_variable(identifier)
                                    && matches!(identifier.name.as_str(), "Boolean" | "Number" | "String" | "Array" | "Object" | "Math"))
                    }) || data_expression_has_child_source(
                        expression,
                        owner_function_id,
                        owner_bindings,
                        ctx,
                        &mut FxHashSet::default(),
                    )
                }
            })
        }

        fn data_setter_functional_updater_has_child_data<'a>(
            call: &oxc_ast::ast::CallExpression<'a>,
            callback_names: &FxHashSet<String>,
            owner_function_id: NodeId,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
        ) -> bool {
            if callback_names.is_empty()
                || !callback_names.iter().all(|name| {
                    name.strip_prefix("set").is_some_and(|suffix| {
                        suffix
                            .as_bytes()
                            .first()
                            .is_some_and(u8::is_ascii_uppercase)
                    })
                })
            {
                return false;
            }
            call.arguments.iter().any(|argument| {
                argument.as_expression().is_some_and(|expression| {
                    data_function_has_child_source(
                        expression,
                        owner_function_id,
                        owner_bindings,
                        ctx,
                    )
                })
            })
        }

        fn data_function_has_child_source<'a>(
            expression: &Expression<'a>,
            owner_function_id: NodeId,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
        ) -> bool {
            let Some(function_id) =
                exact_local_callback_function_id(expression, ctx, &mut Vec::new())
            else {
                return false;
            };
            data_function_id_has_child_source(function_id, owner_function_id, owner_bindings, false, ctx)
        }

        fn data_function_id_has_child_source<'a>(
            function_id: NodeId,
            owner_function_id: NodeId,
            owner_bindings: &LiveStateOwnerBindings,
            include_wrapper_sources: bool,
            ctx: &LintContext<'a>,
        ) -> bool {
            let function_node = ctx.nodes().get_node(function_id);
            let function_span = function_node.span();
            let function_root = transparent_expression_root(function_node, ctx);
            let is_memo_callback = matches!(ctx.nodes().parent_node(function_root.id()).kind(),
                AstKind::CallExpression(call) if is_react_hook_call(call, &["useMemo"], ctx)
                    && call.arguments.first().is_some_and(|argument| argument.span() == function_root.span()));
            let mut has_nested_parameter_state_source = None;
            ctx.nodes().iter().any(|candidate| {
                if !function_span.contains_inclusive(candidate.span()) {
                    return false;
                }
                if live_state_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
                    if !is_memo_callback {
                        return false;
                    }
                    let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                        return false;
                    };
                    if live_state_nearest_function_id(candidate.id(), ctx).is_some_and(|nested_function_id| {
                        data_identifier_is_function_parameter(identifier, nested_function_id, ctx)
                    }) {
                        return *has_nested_parameter_state_source.get_or_insert_with(|| {
                            ctx.nodes().iter().any(|source_node| {
                                function_span.contains_inclusive(source_node.span())
                                    && matches!(source_node.kind(), AstKind::IdentifierReference(source_identifier)
                                        if live_state_identifier_has_state_source(
                                            source_identifier,
                                            owner_function_id,
                                            owner_bindings,
                                            ctx,
                                            &mut FxHashSet::default(),
                                        ))
                            })
                        });
                    }
                    return live_state_symbol_id(identifier, ctx).is_some_and(|symbol_id| {
                        live_state_nearest_function_id(ctx.symbol_declaration(symbol_id).id(), ctx)
                            == Some(function_id)
                            && data_identifier_has_child_source(
                                identifier,
                                owner_function_id,
                                owner_bindings,
                                ctx,
                                &mut FxHashSet::default(),
                            )
                    });
                }
                match candidate.kind() {
                    AstKind::IdentifierReference(identifier) => {
                        if data_identifier_is_function_parameter(identifier, function_id, ctx) {
                            return include_wrapper_sources;
                        }
                        data_identifier_has_child_source(
                                identifier,
                                owner_function_id,
                                owner_bindings,
                                ctx,
                                &mut FxHashSet::default(),
                            )
                    }
                    AstKind::CallExpression(call) => {
                        !data_call_callee_is_owner_callback(call, owner_bindings, ctx)
                            && !live_state_call_is_local_state_setter(call, ctx)
                            && live_state_local_helper_function_id(&call.callee, ctx).is_none()
                            && (include_wrapper_sources || !matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                                if live_state_symbol_id(identifier, ctx)
                                    .is_some_and(|symbol_id| data_symbol_is_import(symbol_id, ctx))))
                            && (data_unknown_call_produces_data(call, owner_bindings, ctx)
                                || include_wrapper_sources
                                    && matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                                        if ctx.is_reference_to_global_variable(identifier)
                                            && matches!(identifier.name.as_str(), "Boolean" | "Number" | "String" | "Array" | "Object" | "Math")))
                    }
                    AstKind::NewExpression(_) => true,
                    AstKind::VariableDeclarator(declarator) if is_memo_callback => declarator.init.as_ref().is_some_and(|initializer| {
                        data_expression_has_child_source(
                            initializer,
                            owner_function_id,
                            owner_bindings,
                            ctx,
                            &mut FxHashSet::default(),
                        )
                    }),
                    _ => false,
                }
            })
        }

        fn data_identifier_is_function_parameter(
            identifier: &oxc_ast::ast::IdentifierReference<'_>,
            function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> bool {
            let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                return false;
            };
            let declaration = ctx.symbol_declaration(symbol_id);
            let parameter = if matches!(declaration.kind(), AstKind::FormalParameter(_)) {
                Some(declaration)
            } else {
                ctx.nodes()
                    .ancestors(declaration.id())
                    .take_while(|ancestor| ancestor.id() != function_id)
                    .find(|ancestor| matches!(ancestor.kind(), AstKind::FormalParameter(_)))
            };
            parameter.is_some_and(|parameter| {
                live_state_nearest_function_id(parameter.id(), ctx) == Some(function_id)
            })
        }

        fn data_expression_is_handler_bag<'a>(
            expression: &Expression<'a>,
            ctx: &LintContext<'a>,
        ) -> bool {
            let Expression::ObjectExpression(object) = expression.get_inner_expression() else {
                return false;
            };
            !object.properties.is_empty()
                && object.properties.iter().all(|property| {
                    let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property
                    else {
                        return false;
                    };
                    if matches!(
                        property.value.get_inner_expression(),
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    ) || exact_local_callback_function_id(&property.value, ctx, &mut Vec::new())
                        .is_some()
                    {
                        return true;
                    }
                    let Expression::Identifier(identifier) = &property.value else {
                        return false;
                    };
                    let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                        return false;
                    };
                    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
                        return false;
                    };
                    let Some(Expression::CallExpression(call)) = &declarator.init else {
                        return false;
                    };
                    let is_callback_wrapper = match &call.callee {
                        Expression::Identifier(callee) => callee.name == "useCallback",
                        Expression::StaticMemberExpression(member) => member.property.name == "useCallback",
                        Expression::ComputedMemberExpression(member) => matches!(&member.expression,
                            Expression::Identifier(property) if property.name == "useCallback"),
                        _ => false,
                    };
                    is_callback_wrapper && matches!(call.arguments.first().and_then(Argument::as_expression),
                        Some(Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)))
                })
        }

        fn data_expression_has_child_source<'a>(
            expression: &Expression<'a>,
            owner_function_id: NodeId,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> bool {
            if let Expression::LogicalExpression(logical) = expression.get_inner_expression()
                && data_expression_has_immutable_owner_parameter_origin(
                    expression,
                    owner_bindings,
                    ctx,
                    &mut visited_symbols.clone(),
                )
            {
                return matches!(logical.left.get_inner_expression(), Expression::CallExpression(_))
                    && data_expression_has_child_source(
                        &logical.left,
                        owner_function_id,
                        owner_bindings,
                        ctx,
                        &mut visited_symbols.clone(),
                    );
            }
            match expression.get_inner_expression() {
                Expression::CallExpression(call) => {
                    if data_call_callee_is_owner_callback(call, owner_bindings, ctx)
                        || data_parent_wired_hook_result(
                            call,
                            owner_function_id,
                            owner_bindings,
                            ctx,
                        )
                    {
                        return false;
                    }
                    if data_call_has_child_source(call, owner_function_id, owner_bindings, ctx) {
                        return true;
                    }
                }
                Expression::NewExpression(_) => return true,
                _ => {}
            }
            let expression_span = expression.span();
            if ctx.nodes().iter().any(|candidate| {
                if !expression_span.contains_inclusive(candidate.span())
                    || live_state_identifier_is_inside_spread(candidate.id(), expression_span, ctx)
                    || live_state_identifier_is_inside_nested_function(
                        candidate.id(),
                        expression_span,
                        ctx,
                    )
                {
                    return false;
                }
                match candidate.kind() {
                    AstKind::CallExpression(call) if call.span != expression_span => {
                        data_call_has_child_source(call, owner_function_id, owner_bindings, ctx)
                    }
                    AstKind::NewExpression(_) => true,
                    AstKind::IdentifierReference(identifier) => data_identifier_has_child_source(
                        identifier,
                        owner_function_id,
                        owner_bindings,
                        ctx,
                        &mut visited_symbols.clone(),
                    ),
                    _ => false,
                }
            }) {
                return true;
            }
            false
        }

        fn data_call_has_child_source<'a>(
            call: &oxc_ast::ast::CallExpression<'a>,
            owner_function_id: NodeId,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
        ) -> bool {
            if data_call_callee_is_owner_callback(call, owner_bindings, ctx)
                || data_parent_wired_hook_result(call, owner_function_id, owner_bindings, ctx)
            {
                return false;
            }
            let call_root = transparent_expression_root(ctx.nodes().get_node(call.node_id.get()), ctx);
            let call_is_initializer = matches!(ctx.nodes().parent_node(call_root.id()).kind(),
                AstKind::VariableDeclarator(declarator)
                    if declarator.init.as_ref().is_some_and(|initializer| {
                        initializer.get_inner_expression().span() == call.span
                    }));
            (!call_is_initializer && call.callee.as_member_expression().is_some_and(|member| {
                member.static_property_name().is_some_and(|name| {
                    matches!(name.as_ref(),
                        "every" | "filter" | "find" | "findIndex" | "findLast" | "findLastIndex"
                            | "flatMap" | "forEach" | "map" | "reduce" | "reduceRight" | "some")
                })
            }) && call.arguments.iter().any(|argument| {
                argument.as_expression().is_some_and(|argument| {
                    data_function_has_child_source(argument, owner_function_id, owner_bindings, ctx)
                })
            })) || data_unknown_call_produces_data(call, owner_bindings, ctx)
        }

        fn data_identifier_has_child_source<'a>(
            identifier: &oxc_ast::ast::IdentifierReference<'a>,
            owner_function_id: NodeId,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> bool {
            let reference = ctx.scoping().get_reference(identifier.reference_id());
            if reference.is_type() {
                return false;
            }
            let Some(symbol_id) = reference.symbol_id() else {
                return !matches!(
                    identifier.name.as_str(),
                    "Boolean"
                        | "JSON"
                        | "Math"
                        | "Number"
                        | "Object"
                        | "String"
                        | "undefined"
                );
            };
            if owner_bindings.is_parameter(symbol_id) || !visited_symbols.insert(symbol_id) {
                return false;
            }
            let root_symbol_id = live_state_const_root_symbol(symbol_id, ctx);
            if matches!(ctx.symbol_declaration(root_symbol_id).kind(), AstKind::VariableDeclarator(declarator)
                if declarator.init.as_ref().is_some_and(|initializer| {
                    matches!(initializer.get_inner_expression(), Expression::CallExpression(call)
                        if is_react_hook_call(call, &["useRef"], ctx))
                }))
            {
                return false;
            }
            if data_state_is_reducer_symbol(symbol_id, ctx) {
                return true;
            }
            if data_symbol_is_react_state_setter(symbol_id, ctx) {
                return false;
            }
            if live_state_is_react_state_symbol(symbol_id, ctx) {
                return data_react_state_initializer_has_child_source(
                        symbol_id,
                        owner_function_id,
                        owner_bindings,
                        ctx,
                        visited_symbols,
                    );
            }
            if data_symbol_is_import(symbol_id, ctx) {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            if let Some(default_value) =
                live_state_parameter_default_value(declaration, symbol_id, ctx)
                && data_expression_has_child_source(
                    default_value,
                    owner_function_id,
                    owner_bindings,
                    ctx,
                    visited_symbols,
                )
            {
                return true;
            }
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            if declarator.init.is_none() {
                let variable_declaration = ctx.nodes().parent_node(declaration.id());
                if matches!(ctx.nodes().parent_node(variable_declaration.id()).kind(),
                    AstKind::ForOfStatement(statement)
                        if statement.left.span().contains_inclusive(declarator.span))
                {
                    return true;
                }
            }
            let initializer_has_child_source =
                declarator.init.as_ref().is_some_and(|initializer| {
                    if let Expression::CallExpression(call) = initializer.get_inner_expression() {
                        if is_react_hook_call(call, &["useRef"], ctx) {
                            return false;
                        }
                        if data_wrapper_call_is_transparent(call, ctx)
                            && (!is_react_hook_call(call, &["useMemo"], ctx)
                                || matches!(call.callee.get_inner_expression(), Expression::Identifier(_)))
                            && call
                                .arguments
                                .first()
                                .and_then(Argument::as_expression)
                                .is_some_and(|argument| {
                                    data_function_has_child_source(
                                        argument,
                                        owner_function_id,
                                        owner_bindings,
                                        ctx,
                                    )
                                })
                        {
                            return true;
                        }
                        if data_call_callee_is_owner_callback(call, owner_bindings, ctx) {
                            return false;
                        }
                        if data_parent_wired_hook_result(
                            call,
                            owner_function_id,
                            owner_bindings,
                            ctx,
                        ) {
                            return false;
                        }
                        if data_external_subscription_result_is_safe(
                            symbol_id, declarator, call, ctx,
                        ) {
                            return false;
                        }
                        if is_react_hook_call(call, &["useMemo"], ctx)
                            && matches!(call.callee.get_inner_expression(), Expression::Identifier(_))
                            && let Some(Expression::ArrowFunctionExpression(callback)) =
                                call.arguments.first().and_then(Argument::as_expression)
                            && let Some(returned_function) = callback.get_expression()
                            && matches!(returned_function.get_inner_expression(),
                                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_))
                        {
                            if !matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                                if live_state_is_hook_name(identifier.name.as_str()))
                                || !data_expression_references_owner_parameter(
                                    initializer,
                                    owner_bindings,
                                    ctx,
                                    &mut FxHashSet::default(),
                                )
                            {
                                return true;
                            }
                            let has_parent_callback = ctx.nodes().iter().any(|candidate| {
                                if !returned_function.span().contains_inclusive(candidate.span()) {
                                    return false;
                                }
                                let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                                    return false;
                                };
                                live_state_symbol_id(identifier, ctx).is_some_and(|symbol_id| {
                                    if owner_bindings.whole_props_symbols.contains(&symbol_id) {
                                        return ctx.nodes().parent_node(candidate.id()).kind()
                                            .as_member_expression_kind()
                                            .and_then(|member| member.static_property_name())
                                            .is_some_and(|name| data_is_handler_callback_name(name.as_ref()));
                                    }
                                    owner_bindings.is_parameter(symbol_id)
                                        && data_is_handler_callback_name(identifier.name.as_str())
                                })
                            });
                            return !has_parent_callback && (
                                data_function_has_child_source(
                                    returned_function, owner_function_id, owner_bindings, ctx,
                                ) || live_state_function_has_state_source(
                                    returned_function, owner_function_id, owner_bindings, ctx,
                                    &mut FxHashSet::default(),
                                )
                            );
                        }
                        if let Some(member) = call.callee.get_inner_expression().as_member_expression()
                            && member.static_property_name().is_some_and(|name| matches!(name.as_ref(),
                                "every" | "filter" | "find" | "findIndex" | "findLast" | "findLastIndex"
                                    | "flatMap" | "forEach" | "map" | "reduce" | "reduceRight" | "some"))
                            && call.arguments.iter().any(|argument| matches!(argument.as_expression().map(Expression::get_inner_expression),
                                Some(Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_))))
                        {
                            return data_expression_has_child_source(
                                member.object(), owner_function_id, owner_bindings, ctx, visited_symbols,
                            ) || call.arguments.iter().filter_map(Argument::as_expression).any(|argument| {
                                !matches!(argument.get_inner_expression(), Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_))
                                    && data_expression_has_child_source(argument, owner_function_id, owner_bindings, ctx, &mut visited_symbols.clone())
                            });
                        }
                        if data_unknown_call_produces_data(call, owner_bindings, ctx) {
                            return true;
                        }
                    }
                    if initializer
                        .get_inner_expression()
                        .as_member_expression()
                        .is_some_and(|member| {
                            member.static_property_name().as_deref() == Some("current")
                                && live_state_member_receiver_is_react_ref(member.object(), ctx)
                        })
                    {
                        return false;
                    }
                    data_expression_has_child_source(
                        initializer,
                        owner_function_id,
                        owner_bindings,
                        ctx,
                        visited_symbols,
                    )
                });
            if initializer_has_child_source {
                return true;
            }
            let mut original_initializer = declarator.init.as_ref();
            let mut visited_initializers = FxHashSet::default();
            while let Some(Expression::Identifier(initializer_identifier)) =
                original_initializer.map(Expression::get_inner_expression)
            {
                let Some(initializer_symbol) = live_state_symbol_id(initializer_identifier, ctx) else {
                    break;
                };
                if !visited_initializers.insert(initializer_symbol) {
                    break;
                }
                let AstKind::VariableDeclarator(initializer_declaration) =
                    ctx.symbol_declaration(initializer_symbol).kind()
                else {
                    break;
                };
                original_initializer = initializer_declaration.init.as_ref();
            }
            if original_initializer.is_some_and(|initializer| matches!(initializer.get_inner_expression(),
                Expression::StringLiteral(_) | Expression::NumericLiteral(_)
                    | Expression::BooleanLiteral(_) | Expression::NullLiteral(_)
                    | Expression::BigIntLiteral(_) | Expression::RegExpLiteral(_)
                    | Expression::TemplateLiteral(_) | Expression::ArrayExpression(_)
                    | Expression::ObjectExpression(_)))
            {
                return false;
            }
            if ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| {
                    let reference_node = ctx.nodes().get_node(reference.node_id());
                    let mut reference_root = transparent_expression_root(reference_node, ctx);
                    loop {
                        let parent = ctx.nodes().parent_node(reference_root.id());
                        let Some(member) = parent.kind().as_member_expression_kind() else {
                            break;
                        };
                        if member.object().span() != reference_root.span() {
                            break;
                        }
                        reference_root = transparent_expression_root(parent, ctx);
                    }
                    let parent = ctx.nodes().parent_node(reference_root.id());
                    match parent.kind() {
                        AstKind::AssignmentExpression(assignment)
                            if assignment.left.span() == reference_root.span() =>
                        {
                            data_expression_has_child_source(
                                &assignment.right,
                                owner_function_id,
                                owner_bindings,
                                ctx,
                                &mut visited_symbols.clone(),
                            )
                        }
                        AstKind::UpdateExpression(update)
                            if update.argument.span() == reference_root.span() =>
                        {
                            true
                        }
                        _ => false,
                    }
                })
            {
                return true;
            }
            ctx.scoping()
                .get_resolved_references(symbol_id)
                .filter(|reference| reference.is_write())
                .any(|reference| {
                    let reference_node = ctx.nodes().get_node(reference.node_id());
                    let reference_root = transparent_expression_root(reference_node, ctx);
                    let parent = ctx.nodes().parent_node(reference_root.id());
                    match parent.kind() {
                        AstKind::AssignmentExpression(assignment)
                            if assignment.left.span() == reference_root.span() =>
                        {
                            data_expression_has_child_source(
                                &assignment.right,
                                owner_function_id,
                                owner_bindings,
                                ctx,
                                &mut visited_symbols.clone(),
                            )
                        }
                        AstKind::UpdateExpression(update)
                            if update.argument.span() == reference_root.span() =>
                        {
                            true
                        }
                        _ => false,
                    }
                })
        }

        fn data_call_callee_is_owner_callback(
            call: &oxc_ast::ast::CallExpression<'_>,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'_>,
        ) -> bool {
            match call.callee.get_inner_expression() {
                Expression::Identifier(identifier) => live_state_symbol_id(identifier, ctx)
                    .is_some_and(|symbol_id| owner_bindings.is_parameter(symbol_id)),
                expression => expression.as_member_expression().is_some_and(|member| {
                    matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                        if live_state_symbol_id(identifier, ctx)
                            .is_some_and(|symbol_id| owner_bindings.whole_props_symbols.contains(&symbol_id)))
                }),
            }
        }

        fn data_expression_has_immutable_owner_parameter_origin<'a>(
            expression: &Expression<'a>,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> bool {
            match expression.get_inner_expression() {
                Expression::Identifier(identifier) => {
                    let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                        return false;
                    };
                    if owner_bindings.is_parameter(symbol_id) {
                        return true;
                    }
                    if !visited_symbols.insert(symbol_id)
                        || ctx
                            .scoping()
                            .get_resolved_references(symbol_id)
                            .any(|reference| reference.is_write())
                    {
                        return false;
                    }
                    let declaration = ctx.symbol_declaration(symbol_id);
                    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                        return false;
                    };
                    let Some(initializer) = &declarator.init else {
                        return false;
                    };
                    matches!(
                        initializer.get_inner_expression(),
                        Expression::Identifier(_)
                            | Expression::StaticMemberExpression(_)
                            | Expression::ComputedMemberExpression(_)
                            | Expression::PrivateFieldExpression(_)
                            | Expression::CallExpression(_)
                            | Expression::LogicalExpression(_)
                    ) && data_expression_has_immutable_owner_parameter_origin(
                        initializer,
                        owner_bindings,
                        ctx,
                        visited_symbols,
                    )
                }
                Expression::LogicalExpression(logical)
                    if matches!(logical.operator,
                        oxc_syntax::operator::LogicalOperator::Or
                            | oxc_syntax::operator::LogicalOperator::Coalesce) =>
                {
                    data_expression_has_immutable_owner_parameter_origin(
                        &logical.left,
                        owner_bindings,
                        ctx,
                        &mut visited_symbols.clone(),
                    ) && ctx.nodes().iter().all(|candidate| {
                        if !logical.right.span().contains_inclusive(candidate.span()) {
                            return true;
                        }
                        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                            return true;
                        };
                        live_state_symbol_id(identifier, ctx).is_some_and(|symbol_id| {
                            owner_bindings.is_parameter(symbol_id) || data_symbol_is_import(symbol_id, ctx)
                        }) || (identifier.name == "undefined" && live_state_symbol_id(identifier, ctx).is_none())
                    })
                }
                Expression::CallExpression(call) => call.callee.as_member_expression().is_some_and(|member| {
                    data_expression_has_immutable_owner_parameter_origin(
                        member.object(),
                        owner_bindings,
                        ctx,
                        visited_symbols,
                    )
                }),
                expression => expression.as_member_expression().is_some_and(|member| {
                    data_expression_has_immutable_owner_parameter_origin(
                        member.object(),
                        owner_bindings,
                        ctx,
                        visited_symbols,
                    )
                }),
            }
        }

        fn data_alias_parent_callback_name<'a>(
            expression: &Expression<'a>,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
        ) -> Option<String> {
            let Expression::Identifier(identifier) = expression.get_inner_expression() else {
                return None;
            };
            let symbol_id = live_state_symbol_id(identifier, ctx)?;
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let initializer = declarator.init.as_ref()?;
            if !ctx.scoping().get_resolved_references(symbol_id).any(|reference| reference.is_write())
                && matches!(initializer.get_inner_expression(),
                    Expression::Identifier(_) | Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_))
                && data_expression_references_owner_parameter(
                    initializer,
                    owner_bindings,
                    ctx,
                    &mut FxHashSet::default(),
                )
            {
                return Some(identifier.name.to_string());
            }
            if !data_expression_has_immutable_owner_parameter_origin(
                initializer,
                owner_bindings,
                ctx,
                &mut FxHashSet::default(),
            ) {
                return None;
            }
            let mut has_binding_write = false;
            for reference in ctx.scoping().get_resolved_references(symbol_id) {
                if !reference.is_write() {
                    continue;
                }
                has_binding_write = true;
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let reference_root = transparent_expression_root(reference_node, ctx);
                let assignment_node = ctx.nodes().parent_node(reference_root.id());
                let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
                    return None;
                };
                if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign
                    || assignment.left.span() != reference_root.span()
                    || !data_expression_references_only_direct_owner_parameters(
                        &assignment.right,
                        owner_bindings,
                        ctx,
                    )
                {
                    return None;
                }
            }
            has_binding_write.then(|| identifier.name.to_string())
        }

        fn data_expression_references_only_direct_owner_parameters(
            expression: &Expression<'_>,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'_>,
        ) -> bool {
            let expression_span = expression.span();
            let mut reference_count = 0;
            let only_owner_parameters = ctx.nodes().iter().all(|candidate| {
                if !expression_span.contains_inclusive(candidate.span()) {
                    return true;
                }
                let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                    return true;
                };
                reference_count += 1;
                live_state_symbol_id(identifier, ctx)
                    .is_some_and(|symbol_id| owner_bindings.is_parameter(symbol_id))
            });
            reference_count > 0 && only_owner_parameters
        }

        fn data_symbol_is_react_state_setter(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                return false;
            };
            if !matches!(pattern.elements.get(1).and_then(Option::as_ref),
            Some(BindingPattern::BindingIdentifier(binding)) if binding.symbol_id() == symbol_id)
                || pattern.elements.len() != 2
            {
                return false;
            }
            declarator.init.as_ref().is_some_and(|initializer| {
                live_state_expression_is_use_state_tuple(
                    initializer,
                    ctx,
                    &mut FxHashSet::default(),
                )
            })
        }

        fn data_parent_wired_hook_result(
            call: &oxc_ast::ast::CallExpression<'_>,
            owner_function_id: NodeId,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'_>,
        ) -> bool {
            matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if live_state_is_hook_name(identifier.name.as_str()))
                && call.arguments.iter().any(|argument| {
                    argument.as_expression().is_some_and(|expression| {
                        let span = expression.span();
                        ctx.nodes().iter().any(|candidate| {
                            if !span.contains_inclusive(candidate.span()) {
                                return false;
                            }
                            let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                                return false;
                            };
                            live_state_symbol_id(identifier, ctx).is_some_and(|symbol_id| {
                                live_state_nearest_function_id(candidate.id(), ctx)
                                    == Some(owner_function_id)
                                    && owner_bindings
                                        .parameter_name(symbol_id)
                                        .is_some_and(data_is_handler_callback_name)
                            })
                        })
                    })
                })
        }

        fn data_external_subscription_result_is_safe(
            symbol_id: SymbolId,
            declarator: &oxc_ast::ast::VariableDeclarator<'_>,
            call: &oxc_ast::ast::CallExpression<'_>,
            ctx: &LintContext<'_>,
        ) -> bool {
            if !matches!(ctx.nodes().parent_node(ctx.symbol_declaration(symbol_id).id()).kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                || data_external_subscription_binding_has_unsafe_use(
                    symbol_id,
                    ctx,
                    &mut FxHashSet::default(),
                )
            {
                return false;
            }
            let Some(allow_whole_result) = data_external_subscription_hook(call, ctx) else {
                return false;
            };
            match &declarator.id {
                BindingPattern::BindingIdentifier(binding) => {
                    binding.symbol_id() == symbol_id && allow_whole_result
                }
                pattern => data_safe_destructured_binding(pattern, symbol_id),
            }
        }

        fn data_safe_destructured_binding(
            pattern: &BindingPattern<'_>,
            symbol_id: SymbolId,
        ) -> bool {
            match pattern {
                BindingPattern::BindingIdentifier(binding) => binding.symbol_id() == symbol_id,
                BindingPattern::AssignmentPattern(_) => false,
                BindingPattern::ObjectPattern(object) => object
                    .properties
                    .iter()
                    .any(|property| data_safe_destructured_binding(&property.value, symbol_id)),
                BindingPattern::ArrayPattern(array) => array
                    .elements
                    .iter()
                    .flatten()
                    .any(|element| data_safe_destructured_binding(element, symbol_id)),
            }
        }

        fn data_external_subscription_binding_has_unsafe_use(
            symbol_id: SymbolId,
            ctx: &LintContext<'_>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> bool {
            if !visited_symbols.insert(symbol_id) {
                return false;
            }
            ctx.scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| {
                    if reference.is_write() {
                        return true;
                    }
                    let reference_node = ctx.nodes().get_node(reference.node_id());
                    let mut usage_root = transparent_expression_root(reference_node, ctx);
                    loop {
                        let parent = ctx.nodes().parent_node(usage_root.id());
                        let Some(member) = parent.kind().as_member_expression_kind() else {
                            break;
                        };
                        if member.object().span() != usage_root.span() {
                            break;
                        }
                        usage_root = transparent_expression_root(parent, ctx);
                    }
                    let usage_parent = ctx.nodes().parent_node(usage_root.id());
                    if matches!(usage_parent.kind(), AstKind::AssignmentExpression(assignment)
                    if assignment.left.span() == usage_root.span())
                        || matches!(usage_parent.kind(), AstKind::UpdateExpression(update)
                        if update.argument.span() == usage_root.span())
                        || matches!(usage_parent.kind(), AstKind::UnaryExpression(unary)
                        if unary.operator == oxc_syntax::operator::UnaryOperator::Delete
                            && unary.argument.span() == usage_root.span())
                    {
                        return true;
                    }
                    for ancestor in ctx.nodes().ancestors(usage_root.id()) {
                        match ancestor.kind() {
                            AstKind::VariableDeclarator(declarator)
                                if declarator.init.as_ref().is_some_and(|initializer| {
                                    initializer.span().contains_inclusive(usage_root.span())
                                }) =>
                            {
                                let mut alias_symbol_ids = Vec::new();
                                data_collect_binding_symbol_ids(
                                    &declarator.id,
                                    &mut alias_symbol_ids,
                                );
                                return alias_symbol_ids.into_iter().any(|alias_symbol_id| {
                                    data_external_subscription_binding_has_unsafe_use(
                                        alias_symbol_id,
                                        ctx,
                                        visited_symbols,
                                    )
                                });
                            }
                            AstKind::Function(_)
                            | AstKind::ArrowFunctionExpression(_)
                            | AstKind::Program(_) => break,
                            _ => {}
                        }
                    }
                    false
                })
        }

        fn data_collect_binding_symbol_ids(
            pattern: &BindingPattern<'_>,
            symbol_ids: &mut Vec<SymbolId>,
        ) {
            match pattern {
                BindingPattern::BindingIdentifier(identifier) => {
                    symbol_ids.push(identifier.symbol_id());
                }
                BindingPattern::AssignmentPattern(assignment) => {
                    data_collect_binding_symbol_ids(&assignment.left, symbol_ids);
                }
                BindingPattern::ObjectPattern(object) => {
                    for property in &object.properties {
                        data_collect_binding_symbol_ids(&property.value, symbol_ids);
                    }
                    if let Some(rest) = &object.rest {
                        data_collect_binding_symbol_ids(&rest.argument, symbol_ids);
                    }
                }
                BindingPattern::ArrayPattern(array) => {
                    for element in array.elements.iter().flatten() {
                        data_collect_binding_symbol_ids(element, symbol_ids);
                    }
                    if let Some(rest) = &array.rest {
                        data_collect_binding_symbol_ids(&rest.argument, symbol_ids);
                    }
                }
            }
        }

        fn data_external_subscription_hook(
            call: &oxc_ast::ast::CallExpression<'_>,
            ctx: &LintContext<'_>,
        ) -> Option<bool> {
            const EXTERNAL_HOOKS: &[&str] = &[
                "useIntersectionObserver",
                "useMatchMedia",
                "useMediaJobProgress",
                "useMediaQuery",
                "useMediaQueryState",
                "useResizeObserver",
                "useVisibility",
                "useWindowSize",
            ];
            const PRIMITIVE_HOOKS: &[&str] = &["useMatchMedia", "useMediaQuery", "useVisibility"];
            match call.callee.get_inner_expression() {
                Expression::Identifier(identifier) => {
                    let symbol_id = live_state_symbol_id(identifier, ctx)?;
                    for entry in &ctx.module_record().import_entries {
                        if ctx
                            .scoping()
                            .get_root_binding(entry.local_name.name().into())
                            != Some(symbol_id)
                        {
                            continue;
                        }
                        let hook_name = match &entry.import_name {
                            crate::module_record::ImportImportName::Name(imported_name) => {
                                imported_name.name()
                            }
                            crate::module_record::ImportImportName::Default(_) => {
                                identifier.name.as_str()
                            }
                            crate::module_record::ImportImportName::NamespaceObject => return None,
                        };
                        return EXTERNAL_HOOKS
                            .contains(&hook_name)
                            .then(|| PRIMITIVE_HOOKS.contains(&hook_name));
                    }
                    data_local_external_store_hook(symbol_id, ctx).then_some(true)
                }
                expression => {
                    let member = expression.as_member_expression()?;
                    let hook_name = member.static_property_name()?;
                    if !EXTERNAL_HOOKS.contains(&hook_name) {
                        return None;
                    }
                    let Expression::Identifier(namespace) = member.object().get_inner_expression()
                    else {
                        return None;
                    };
                    let namespace_symbol_id = live_state_symbol_id(namespace, ctx)?;
                    ctx.module_record()
                        .import_entries
                        .iter()
                        .any(|entry| {
                            matches!(
                                entry.import_name,
                                crate::module_record::ImportImportName::NamespaceObject
                            ) && ctx
                                .scoping()
                                .get_root_binding(entry.local_name.name().into())
                                == Some(namespace_symbol_id)
                        })
                        .then(|| PRIMITIVE_HOOKS.contains(&hook_name))
                }
            }
        }

        fn data_local_external_store_hook(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
            let declaration = ctx.symbol_declaration(symbol_id);
            let function_id = match declaration.kind() {
                AstKind::Function(function) => function.node_id.get(),
                AstKind::VariableDeclarator(declarator) => declarator
                    .init
                    .as_ref()
                    .and_then(|initializer| {
                        exact_local_callback_function_id(initializer, ctx, &mut Vec::new())
                    })
                    .unwrap_or(declaration.id()),
                _ => return false,
            };
            if function_id == declaration.id()
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_write())
            {
                return false;
            }
            let function_node = ctx.nodes().get_node(function_id);
            if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
            && function.get_expression().is_some_and(|expression| {
                matches!(expression.get_inner_expression(), Expression::CallExpression(call) if is_react_hook_call(call, &["useSyncExternalStore"], ctx))
            })
        {
            return true;
        }
            let returns = ctx
                .nodes()
                .iter()
                .filter(|candidate| {
                    live_state_nearest_function_id(candidate.id(), ctx) == Some(function_id)
                        && matches!(candidate.kind(), AstKind::ReturnStatement(_))
                })
                .collect::<Vec<_>>();
            if !returns.is_empty()
                && returns.iter().all(|candidate| {
                    matches!(candidate.kind(), AstKind::ReturnStatement(statement)
                    if statement.argument.as_ref().is_some_and(|argument| {
                        matches!(argument.get_inner_expression(), Expression::CallExpression(call)
                            if is_react_hook_call(call, &["useSyncExternalStore"], ctx))
                    }))
                })
            {
                return true;
            }
            let mut returned_reference_count = 0;
            let all_returned_references_are_external_state = returns.iter().all(|candidate| {
                let AstKind::ReturnStatement(statement) = candidate.kind() else {
                    return false;
                };
                let Some(argument) = &statement.argument else {
                    return false;
                };
                let argument_span = argument.span();
                ctx.nodes().iter().all(|returned_candidate| {
                    let AstKind::IdentifierReference(identifier) = returned_candidate.kind() else {
                        return true;
                    };
                    if !argument_span.contains_inclusive(identifier.span) {
                        return true;
                    }
                    returned_reference_count += 1;
                    live_state_symbol_id(identifier, ctx).is_some_and(|returned_symbol_id| {
                        live_state_is_react_state_symbol(returned_symbol_id, ctx)
                            && data_state_is_externally_driven(returned_symbol_id, function_id, ctx)
                    })
                })
            });
            returned_reference_count > 0 && all_returned_references_are_external_state
        }

        fn data_state_is_externally_driven(
            state_symbol_id: SymbolId,
            owner_function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> bool {
            let declaration = ctx.symbol_declaration(state_symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                return false;
            };
            let Some(BindingPattern::BindingIdentifier(setter)) =
                pattern.elements.get(1).and_then(Option::as_ref)
            else {
                return false;
            };
            let mut has_deferred_writer = false;
            for reference in ctx.scoping().get_resolved_references(setter.symbol_id()) {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let reference_root = transparent_expression_root(reference_node, ctx);
                if data_node_is_deferred_callback_position(reference_root, ctx) {
                    has_deferred_writer = true;
                    continue;
                }
                let parent = ctx.nodes().parent_node(reference_root.id());
                if !matches!(parent.kind(), AstKind::CallExpression(call)
                if call.callee.span() == reference_root.span())
                {
                    continue;
                }
                if !data_state_writer_is_deferred(parent.id(), owner_function_id, ctx) {
                    return false;
                }
                has_deferred_writer = true;
            }
            has_deferred_writer
        }

        fn data_state_is_reducer_symbol(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                return false;
            };
            if !matches!(pattern.elements.len(), 1 | 2)
                || !matches!(pattern.elements.first().and_then(Option::as_ref),
            Some(BindingPattern::BindingIdentifier(binding)) if binding.symbol_id() == symbol_id)
            {
                return false;
            }
            declarator.init.as_ref().is_some_and(|initializer| {
                data_expression_is_reducer_tuple(initializer, ctx, &mut FxHashSet::default())
            })
        }

        fn data_react_state_initializer_has_child_source<'a>(
            symbol_id: SymbolId,
            owner_function_id: NodeId,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> bool {
            let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind()
            else {
                return false;
            };
            let Some(Expression::CallExpression(call)) = declarator
                .init
                .as_ref()
                .map(Expression::get_inner_expression)
            else {
                return false;
            };
            if !is_react_hook_call(call, &["useState"], ctx) {
                return false;
            }
            call.arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|initializer| {
                    let has_bare_hook_callee = matches!(call.callee.get_inner_expression(), Expression::Identifier(_));
                    if has_bare_hook_callee && ctx.nodes().iter().any(|candidate| {
                        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                            return false;
                        };
                        initializer.span().contains_inclusive(identifier.span)
                            && live_state_nearest_function_id(candidate.id(), ctx).is_some_and(|function_id| {
                                function_id != owner_function_id
                                    && data_identifier_is_function_parameter(identifier, function_id, ctx)
                            })
                    }) {
                        return true;
                    }
                    if matches!(
                        initializer.get_inner_expression(),
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    ) {
                        return has_bare_hook_callee && data_function_has_child_source(
                            initializer,
                            owner_function_id,
                            owner_bindings,
                            ctx,
                        );
                    }
                    data_expression_has_child_source(
                        initializer,
                        owner_function_id,
                        owner_bindings,
                        ctx,
                        visited_symbols,
                    )
                })
        }

        fn data_expression_is_reducer_tuple<'a>(
            expression: &Expression<'a>,
            ctx: &LintContext<'a>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> bool {
            match expression.get_inner_expression() {
                Expression::CallExpression(call) => is_react_hook_call(call, &["useReducer"], ctx),
                Expression::Identifier(identifier) => {
                    let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                        return false;
                    };
                    if !visited_symbols.insert(symbol_id)
                        || ctx
                            .scoping()
                            .get_resolved_references(symbol_id)
                            .any(|reference| reference.is_write())
                    {
                        return false;
                    }
                    let declaration = ctx.symbol_declaration(symbol_id);
                    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                        return false;
                    };
                    matches!(&declarator.id, BindingPattern::BindingIdentifier(binding)
                        if binding.symbol_id() == symbol_id)
                        && matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable_declaration)
                            if variable_declaration.kind.is_const())
                        && declarator.init.as_ref().is_some_and(|initializer| {
                            data_expression_is_reducer_tuple(initializer, ctx, visited_symbols)
                        })
                }
                _ => false,
            }
        }

        fn data_state_writer_is_deferred(
            node_id: NodeId,
            owner_function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> bool {
            for ancestor in ctx
                .nodes()
                .ancestors(node_id)
                .take_while(|ancestor| ancestor.id() != owner_function_id)
            {
                if !matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ) {
                    continue;
                }
                if data_node_is_deferred_callback_position(ancestor, ctx) {
                    return true;
                }
                let Some(function_symbol_id) = data_function_binding_symbol(ancestor, ctx) else {
                    continue;
                };
                if ctx
                    .scoping()
                    .get_resolved_references(function_symbol_id)
                    .any(|reference| {
                        data_node_is_deferred_callback_position(
                            ctx.nodes().get_node(reference.node_id()),
                            ctx,
                        )
                    })
                {
                    return true;
                }
            }
            false
        }

        fn data_function_binding_symbol<'a>(
            function_node: &AstNode<'a>,
            ctx: &LintContext<'a>,
        ) -> Option<SymbolId> {
            if let AstKind::Function(function) = function_node.kind()
                && let Some(identifier) = &function.id
            {
                return Some(identifier.symbol_id());
            }
            let mut root = transparent_expression_root(function_node, ctx);
            loop {
                let parent = ctx.nodes().parent_node(root.id());
                if matches!(parent.kind(), AstKind::CallExpression(_)) {
                    root = transparent_expression_root(parent, ctx);
                    continue;
                }
                let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                    return None;
                };
                return declarator
                    .id
                    .get_binding_identifier()
                    .map(|identifier| identifier.symbol_id());
            }
        }

        fn data_node_is_deferred_callback_position<'a>(
            expression_node: &AstNode<'a>,
            ctx: &LintContext<'a>,
        ) -> bool {
            let expression_root = transparent_expression_root(expression_node, ctx);
            let parent = ctx.nodes().parent_node(expression_root.id());
            match parent.kind() {
                AstKind::CallExpression(call)
                    if call.arguments.iter().any(|argument| {
                        argument
                            .as_expression()
                            .is_some_and(|argument| argument.span() == expression_root.span())
                    }) =>
                {
                    live_state_callee_name(&call.callee).is_some_and(|name| {
                        matches!(
                            name,
                            "setTimeout"
                                | "setInterval"
                                | "setImmediate"
                                | "requestAnimationFrame"
                                | "requestIdleCallback"
                                | "queueMicrotask"
                                | "addEventListener"
                                | "addListener"
                                | "subscribe"
                                | "observe"
                                | "watch"
                                | "watchPosition"
                                | "then"
                                | "catch"
                                | "finally"
                                | "on"
                                | "once"
                        )
                    })
                }
                AstKind::NewExpression(construction)
                    if construction.arguments.iter().any(|argument| {
                        argument
                            .as_expression()
                            .is_some_and(|argument| argument.span() == expression_root.span())
                    }) =>
                {
                    live_state_callee_name(&construction.callee)
                        .is_some_and(|name| name == "Promise" || name.ends_with("Observer"))
                }
                AstKind::AssignmentExpression(assignment)
                    if assignment.right.span() == expression_root.span() =>
                {
                    assignment
                        .left
                        .as_member_expression()
                        .and_then(|member| member.static_property_name())
                        .is_some_and(|name| name.starts_with("on"))
                }
                _ => false,
            }
        }

        fn data_symbol_is_import(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
            ctx.module_record().import_entries.iter().any(|entry| {
                ctx.scoping()
                    .get_root_binding(entry.local_name.name().into())
                    == Some(symbol_id)
            })
        }

        fn data_unknown_call_produces_data<'a>(
            call: &oxc_ast::ast::CallExpression<'a>,
            owner_bindings: &LiveStateOwnerBindings,
            ctx: &LintContext<'a>,
        ) -> bool {
            let Some(name) = live_state_callee_name(&call.callee) else {
                return true;
            };
            if data_expression_has_immutable_owner_parameter_origin(
                &call.callee,
                owner_bindings,
                ctx,
                &mut FxHashSet::default(),
            ) {
                return false;
            }
            if is_react_hook_call(call, &["useMemo"], ctx)
                || live_state_is_local_non_state_comparison_memoizer(name, call, ctx)
                || matches!(name, "useState" | "useRef")
            {
                return false;
            }
            if matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if live_state_symbol_id(identifier, ctx).is_none()
                    && matches!(identifier.name.as_str(),
                        "Array" | "Boolean" | "JSON" | "Math" | "Number" | "Object" | "String" | "undefined"))
            {
                return false;
            }
            if call.callee.as_member_expression().is_some_and(|member| {
                let mut receiver = member.object().get_inner_expression();
                while let Some(receiver_member) = receiver.as_member_expression() {
                    receiver = receiver_member.object().get_inner_expression();
                }
                matches!(receiver, Expression::Identifier(identifier)
                    if live_state_symbol_id(identifier, ctx)
                        .is_some_and(|symbol_id| data_symbol_is_import(symbol_id, ctx)))
            }) {
                return false;
            }
            if call.callee.as_member_expression().is_some_and(|member| {
                member.static_property_name().as_deref() == Some("parse")
                && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "JSON" && live_state_symbol_id(identifier, ctx).is_none())
        }) {
                return false;
            }
            if call.callee.as_member_expression().is_some_and(|member| {
                matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                    if live_state_symbol_id(identifier, ctx).is_none()
                        && matches!(identifier.name.as_str(),
                            "Boolean" | "JSON" | "Math" | "Number" | "Object" | "String"))
            }) {
                return false;
            }
            if call.callee.as_member_expression().is_some_and(|member| {
                member.static_property_name().is_some_and(|property_name| {
                    matches!(property_name.as_ref(), "replace" | "toFixed" | "trim")
                })
            }) {
                return false;
            }
            if call.callee.as_member_expression().is_some_and(|member| {
                matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                    if live_state_symbol_id(identifier, ctx)
                        .is_some_and(|symbol_id| live_state_is_react_state_symbol(symbol_id, ctx)))
            }) {
                return false;
            }
            if call.callee.as_member_expression().is_some_and(|member| {
                data_expression_has_safe_external_subscription_origin(
                    member.object(),
                    ctx,
                    &mut FxHashSet::default(),
                )
            }) {
                return false;
            }
            if live_state_is_hook_name(name) {
                return true;
            }
            if call.callee.as_member_expression().is_some_and(|member| {
                member.static_property_name().is_some_and(|property_name| {
                    LIVE_STATE_DATA_SINK_METHODS.contains(&property_name.as_ref())
                        && matches!(
                            member.object().get_inner_expression(),
                            Expression::Identifier(identifier)
                                if live_state_symbol_id(identifier, ctx)
                                    .is_some_and(|symbol_id| owner_bindings.is_parameter(symbol_id))
                        )
                })
            }) {
                return false;
            }
            true
        }

        fn data_expression_has_safe_external_subscription_origin(
            expression: &Expression<'_>,
            ctx: &LintContext<'_>,
            visited_symbols: &mut FxHashSet<SymbolId>,
        ) -> bool {
            match expression.get_inner_expression() {
                Expression::Identifier(identifier) => {
                    let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                        return false;
                    };
                    if !visited_symbols.insert(symbol_id)
                        || ctx
                            .scoping()
                            .get_resolved_references(symbol_id)
                            .any(|reference| reference.is_write())
                    {
                        return false;
                    }
                    let declaration = ctx.symbol_declaration(symbol_id);
                    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                        return false;
                    };
                    let Some(initializer) = &declarator.init else {
                        return false;
                    };
                    if let Expression::CallExpression(call) = initializer.get_inner_expression()
                        && data_external_subscription_result_is_safe(
                            symbol_id, declarator, call, ctx,
                        )
                    {
                        return true;
                    }
                    data_expression_has_safe_external_subscription_origin(
                        initializer,
                        ctx,
                        visited_symbols,
                    )
                }
                expression => expression.as_member_expression().is_some_and(|member| {
                    data_expression_has_safe_external_subscription_origin(
                        member.object(),
                        ctx,
                        visited_symbols,
                    )
                }),
            }
        }
    }

    pub use data_rule::NoPassDataToParent;
}

pub use implementation::NoPassDataToParent;
