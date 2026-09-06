mod implementation {
    include!("no_adjust_state_on_prop_change.rs");

    mod reset_rule {
        use super::super::{
            LocalCallbackNearestFunctionNodeIndex,
            build_local_callback_nearest_function_node_index, is_node_reachable_within_function,
        };
        use super::*;

        const MESSAGE: &str = "Your users briefly see stale state when a prop changes because this useEffect clears all state.";

        struct ResetCall<'a> {
            call: &'a oxc_ast::ast::CallExpression<'a>,
            value: Option<&'a Expression<'a>>,
        }

        #[derive(Default)]
        struct ResetOwnerState {
            state_count: usize,
            state_symbols_by_setter: FxHashMap<SymbolId, SymbolId>,
        }

        #[derive(Clone)]
        enum ResetBooleanFormula {
            And(Box<Self>, Box<Self>),
            Atom(SymbolId),
            Constant(bool),
            Not(Box<Self>),
            Or(Box<Self>, Box<Self>),
        }

        struct ResetBooleanFacts {
            assignments: FxHashMap<SymbolId, bool>,
            did_conflict: bool,
            did_change: bool,
        }

        #[derive(Debug, Default, Clone)]
        pub struct NoResetAllStateOnPropChange;

        declare_oxc_lint!(
            /// Warns when an effect clears every state value after a prop changes.
            NoResetAllStateOnPropChange,
            react_doctor_native,
            perf,
            version = "0.1.0",
            short_description = "All state reset on prop change.",
        );

        impl Rule for NoResetAllStateOnPropChange {
            fn should_run(&self, ctx: &ContextHost) -> bool {
                !is_test_noise_file(ctx)
            }

            fn run_once<'a>(&self, ctx: &LintContext<'a>) {
                let effect_node_ids = ctx
                    .nodes()
                    .iter()
                    .filter_map(|node| {
                        let AstKind::CallExpression(call) = node.kind() else {
                            return None;
                        };
                        is_react_hook_call(call, &["useEffect"], ctx).then_some(node.id())
                    })
                    .collect::<Vec<_>>();
                if effect_node_ids.is_empty() {
                    return;
                }
                let function_node_index = build_local_callback_nearest_function_node_index(ctx);
                let state_setters_by_owner = reset_state_setters_by_owner(ctx);

                for effect_node_id in effect_node_ids {
                    let effect_node = ctx.nodes().get_node(effect_node_id);
                    let AstKind::CallExpression(effect_call) = effect_node.kind() else {
                        unreachable!();
                    };
                    let Some(owner_function_id) =
                        no_adjust_nearest_function_node_id(effect_node.id(), ctx)
                    else {
                        continue;
                    };
                    if reset_owner_is_custom_hook(owner_function_id, ctx) {
                        continue;
                    }
                    let Some(owner_state) = state_setters_by_owner.get(&owner_function_id) else {
                        continue;
                    };
                    let Some(Expression::ArrayExpression(dependencies)) = effect_call
                        .arguments
                        .get(1)
                        .and_then(Argument::as_expression)
                    else {
                        continue;
                    };
                    if !dependencies
                        .elements
                        .iter()
                        .filter_map(no_adjust_array_element_expression)
                        .any(|dependency| {
                            no_adjust_dependency_expression_has_prop_source(
                                dependency,
                                owner_function_id,
                                ctx,
                                &mut Vec::new(),
                            )
                        })
                    {
                        continue;
                    }
                    let Some(callback_expression) = effect_call
                        .arguments
                        .first()
                        .and_then(Argument::as_expression)
                    else {
                        continue;
                    };
                    let Some(callback_function_id) =
                        no_adjust_effect_callback_function_id(callback_expression, ctx)
                    else {
                        continue;
                    };
                    if no_adjust_function_is_async(callback_function_id, ctx) {
                        continue;
                    }

                    let synchronous_function_ids = FxHashSet::from_iter([callback_function_id]);
                    let mut reset_calls_by_setter: FxHashMap<SymbolId, Vec<ResetCall<'a>>> =
                        FxHashMap::default();
                    for function_id in &synchronous_function_ids {
                        for &candidate_id in function_node_index.node_ids(*function_id) {
                            let candidate = ctx.nodes().get_node(candidate_id);
                            let AstKind::CallExpression(call) = candidate.kind() else {
                                continue;
                            };
                            let Expression::Identifier(identifier) =
                                call.callee.get_inner_expression()
                            else {
                                continue;
                            };
                            let Some(setter_symbol_id) =
                                resolve_const_identifier_root_symbol(identifier, ctx)
                            else {
                                continue;
                            };
                            if !owner_state
                                .state_symbols_by_setter
                                .contains_key(&setter_symbol_id)
                                || !reset_setter_call_is_synchronous(
                                    candidate,
                                    callback_function_id,
                                    ctx,
                                )
                            {
                                continue;
                            }
                            reset_calls_by_setter
                                .entry(setter_symbol_id)
                                .or_default()
                                .push(ResetCall {
                                    call,
                                    value: call.arguments.first().and_then(Argument::as_expression),
                                });
                        }
                    }
                    if reset_calls_by_setter.len() != owner_state.state_count
                        || reset_calls_by_setter.values().any(|calls| {
                            calls.is_empty()
                                || calls.iter().any(|reset_call| {
                                    !reset_call_matches_initializer(
                                        reset_call,
                                        owner_function_id,
                                        ctx,
                                    )
                                })
                        })
                    {
                        continue;
                    }

                    if reset_has_synchronous_resource_lifecycle_transition(
                        callback_function_id,
                        &function_node_index,
                        ctx,
                    ) {
                        continue;
                    }

                    let prop_dependency_symbols =
                        no_adjust_prop_dependency_symbols(dependencies, owner_function_id, ctx);
                    if reset_calls_by_setter.values().all(|calls| {
                        calls.iter().all(|reset_call| {
                            reset_call.value.is_some_and(|value| {
                                no_adjust_has_resource_lifecycle_setter_writer(
                                    reset_setter_symbol(reset_call.call, ctx),
                                    reset_call.call,
                                    value,
                                    effect_call.span,
                                    &prop_dependency_symbols,
                                    owner_function_id,
                                    ctx,
                                )
                            })
                        })
                    }) {
                        continue;
                    }
                    if reset_every_setter_reloads_asynchronously(
                        callback_function_id,
                        &synchronous_function_ids,
                        reset_calls_by_setter.keys().copied(),
                        &function_node_index,
                        ctx,
                    ) {
                        continue;
                    }
                    if reset_all_state_exposure_is_visibility_guarded(
                        owner_function_id,
                        dependencies,
                        owner_state,
                        &reset_calls_by_setter,
                        ctx,
                    ) {
                        continue;
                    }

                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(effect_call.span));
                }
            }
        }

        fn reset_state_setters_by_owner(
            ctx: &LintContext<'_>,
        ) -> FxHashMap<NodeId, ResetOwnerState> {
            let mut setters_by_owner = FxHashMap::default();
            for node in ctx.nodes().iter() {
                let AstKind::VariableDeclarator(declarator) = node.kind() else {
                    continue;
                };
                let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                    continue;
                };
                let Some(BindingPattern::BindingIdentifier(state)) =
                    pattern.elements.first().and_then(Option::as_ref)
                else {
                    continue;
                };
                let Some(initializer) = declarator.init.as_ref() else {
                    continue;
                };
                if !no_adjust_expression_is_use_state_tuple(initializer, ctx, &mut Vec::new()) {
                    continue;
                }
                let Some(owner_function_id) = no_adjust_nearest_function_node_id(node.id(), ctx)
                else {
                    continue;
                };
                let owner_state = setters_by_owner
                    .entry(owner_function_id)
                    .or_insert_with(ResetOwnerState::default);
                owner_state.state_count += 1;
                let Some(BindingPattern::BindingIdentifier(setter)) =
                    pattern.elements.get(1).and_then(Option::as_ref)
                else {
                    continue;
                };
                owner_state
                    .state_symbols_by_setter
                    .insert(setter.symbol_id(), state.symbol_id());
            }
            setters_by_owner
        }

        fn reset_setter_call_is_synchronous(
            call_node: &AstNode<'_>,
            callback_function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> bool {
            for ancestor in ctx.nodes().ancestors(call_node.id()) {
                if ancestor.id() == callback_function_id {
                    return true;
                }
                if matches!(ancestor.kind(), AstKind::AwaitExpression(_))
                    || matches!(ancestor.kind(), AstKind::UnaryExpression(unary)
                        if unary.operator == oxc_syntax::operator::UnaryOperator::Void)
                    || matches!(
                        ancestor.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    )
                {
                    return false;
                }
            }
            false
        }

        fn reset_resource_synchronous_function_ids(
            callback_function_id: NodeId,
            function_node_index: &LocalCallbackNearestFunctionNodeIndex,
            ctx: &LintContext<'_>,
        ) -> FxHashSet<NodeId> {
            let mut function_ids = FxHashSet::default();
            let mut pending_function_ids = vec![callback_function_id];
            while let Some(function_id) = pending_function_ids.pop() {
                if !function_ids.insert(function_id) {
                    continue;
                }
                for &candidate_id in function_node_index.node_ids(function_id) {
                    let AstKind::CallExpression(call) = ctx.nodes().get_node(candidate_id).kind()
                    else {
                        continue;
                    };
                    if let Some(called_function_id) =
                        no_adjust_state_fact_callback_function_id(&call.callee, ctx)
                        && !no_adjust_function_is_async(called_function_id, ctx)
                    {
                        pending_function_ids.push(called_function_id);
                    }
                    let Some(member) = call.callee.get_inner_expression().as_member_expression()
                    else {
                        continue;
                    };
                    if member.is_computed() {
                        continue;
                    }
                    let callback_index = match member.static_property_name() {
                        Some(
                            "every" | "filter" | "flatMap" | "forEach" | "map" | "reduce"
                            | "reduceRight" | "some",
                        ) => 0,
                        Some("from") if matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Array") => {
                            1
                        }
                        _ => continue,
                    };
                    let Some(expression) = call
                        .arguments
                        .get(callback_index)
                        .and_then(Argument::as_expression)
                    else {
                        continue;
                    };
                    if let Some(function_id) =
                        no_adjust_state_fact_callback_function_id(expression, ctx)
                        && !no_adjust_function_is_async(function_id, ctx)
                    {
                        pending_function_ids.push(function_id);
                    }
                }
            }
            function_ids
        }

        fn reset_call_matches_initializer<'a>(
            reset_call: &ResetCall<'a>,
            owner_function_id: NodeId,
            ctx: &LintContext<'a>,
        ) -> bool {
            let setter_symbol_id = reset_setter_symbol(reset_call.call, ctx);
            let declaration = ctx.symbol_declaration(setter_symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let Some(Expression::CallExpression(use_state_call)) = declarator
                .init
                .as_ref()
                .map(Expression::get_inner_expression)
            else {
                return false;
            };
            let initial_value = use_state_call
                .arguments
                .first()
                .and_then(Argument::as_expression);
            if reset_value_is_undefined(initial_value) && reset_value_is_undefined(reset_call.value)
            {
                return true;
            }
            match (initial_value, reset_call.value) {
                (Some(initial_value), Some(reset_value)) => {
                    if reset_same_live_value(initial_value, reset_value, owner_function_id, ctx) {
                        return false;
                    }
                    reset_structurally_equal(initial_value, reset_value, ctx)
                }
                _ => false,
            }
        }

        fn reset_value_is_undefined(expression: Option<&Expression<'_>>) -> bool {
            expression.is_none_or(|expression| {
                matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "undefined")
            })
        }

        fn reset_setter_symbol<'a>(
            call: &oxc_ast::ast::CallExpression<'a>,
            ctx: &LintContext<'a>,
        ) -> SymbolId {
            let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                unreachable!();
            };
            resolve_const_identifier_root_symbol(identifier, ctx).unwrap_or_else(|| {
                ctx.scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .expect("state setter must resolve")
            })
        }

        fn reset_structurally_equal(
            initial_value: &Expression<'_>,
            reset_value: &Expression<'_>,
            ctx: &LintContext<'_>,
        ) -> bool {
            let initial_value = initial_value.get_inner_expression();
            let reset_value = reset_value.get_inner_expression();
            reset_compact_source(ctx.source_range(initial_value.span()))
                == reset_compact_source(ctx.source_range(reset_value.span()))
        }

        fn reset_compact_source(source: &str) -> String {
            let mut compact_source = String::with_capacity(source.len());
            let mut quote = None;
            let mut is_escaped = false;
            for character in source.chars() {
                if let Some(active_quote) = quote {
                    compact_source.push(character);
                    if is_escaped {
                        is_escaped = false;
                    } else if character == '\\' {
                        is_escaped = true;
                    } else if character == active_quote {
                        quote = None;
                    }
                    continue;
                }
                if matches!(character, '\'' | '"' | '`') {
                    quote = Some(character);
                    compact_source.push(character);
                } else if !character.is_whitespace() {
                    if matches!(character, ')' | ']' | '}') && compact_source.ends_with(',') {
                        compact_source.pop();
                    }
                    compact_source.push(character);
                }
            }
            compact_source
        }

        fn reset_same_live_value(
            initial_value: &Expression<'_>,
            reset_value: &Expression<'_>,
            owner_function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> bool {
            if let (Some(initial_identity), Some(reset_identity)) = (
                reset_live_prop_identity(initial_value, owner_function_id, ctx, &mut Vec::new()),
                reset_live_prop_identity(reset_value, owner_function_id, ctx, &mut Vec::new()),
            ) && initial_identity == reset_identity
            {
                return true;
            }
            let (
                Expression::Identifier(initial_identifier),
                Expression::Identifier(reset_identifier),
            ) = (
                initial_value.get_inner_expression(),
                reset_value.get_inner_expression(),
            )
            else {
                return false;
            };
            let initial_symbol_id = ctx
                .scoping()
                .get_reference(initial_identifier.reference_id())
                .symbol_id();
            if initial_symbol_id.is_none()
                || initial_symbol_id
                    != ctx
                        .scoping()
                        .get_reference(reset_identifier.reference_id())
                        .symbol_id()
            {
                return false;
            }
            let symbol_id = initial_symbol_id.unwrap();
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            if !matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                || declarator
                    .id
                    .get_binding_identifier()
                    .is_none_or(|identifier| identifier.symbol_id() != symbol_id)
            {
                return false;
            }
            if no_adjust_nearest_function_node_id(declaration.id(), ctx) != Some(owner_function_id)
            {
                return false;
            }
            let Some(initializer) = declarator.init.as_ref() else {
                return false;
            };
            !reset_is_constant_expression(initializer, ctx, &mut FxHashSet::default())
                && !reset_is_mount_snapshot(initializer, ctx)
                && !reset_expression_reads_ref_current(initializer, ctx)
        }

        fn reset_live_prop_identity(
            expression: &Expression<'_>,
            owner_function_id: NodeId,
            ctx: &LintContext<'_>,
            visited_symbol_ids: &mut Vec<SymbolId>,
        ) -> Option<(SymbolId, Vec<String>, i8)> {
            match expression.get_inner_expression() {
                Expression::Identifier(identifier) => {
                    let symbol_id = ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()?;
                    if visited_symbol_ids.contains(&symbol_id) {
                        return None;
                    }
                    visited_symbol_ids.push(symbol_id);
                    let declaration = ctx.symbol_declaration(symbol_id);
                    if let AstKind::VariableDeclarator(declarator) = declaration.kind()
                        && matches!(
                            ctx.nodes().parent_node(declaration.id()).kind(),
                            AstKind::VariableDeclaration(declaration)
                                if declaration.kind.is_const()
                        )
                        && declarator
                            .id
                            .get_binding_identifier()
                            .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
                        && let Some(initializer) = declarator.init.as_ref()
                    {
                        return reset_live_prop_identity(
                            initializer,
                            owner_function_id,
                            ctx,
                            visited_symbol_ids,
                        );
                    }
                    no_adjust_symbol_has_upstream_prop_source(
                        symbol_id,
                        owner_function_id,
                        ctx,
                        &mut Vec::new(),
                    )
                    .then_some((symbol_id, Vec::new(), 0))
                }
                expression if expression.as_member_expression().is_some() => {
                    let member = expression.as_member_expression()?;
                    let property_name = member.static_property_name()?.to_owned();
                    let mut identity = reset_live_prop_identity(
                        member.object(),
                        owner_function_id,
                        ctx,
                        visited_symbol_ids,
                    )?;
                    identity.1.push(property_name);
                    Some(identity)
                }
                Expression::UnaryExpression(unary)
                    if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
                {
                    let mut identity = reset_live_prop_identity(
                        &unary.argument,
                        owner_function_id,
                        ctx,
                        visited_symbol_ids,
                    )?;
                    identity.2 = if identity.2 == -1 { 1 } else { -1 };
                    Some(identity)
                }
                Expression::CallExpression(call)
                    if call.arguments.len() == 1
                        && matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                            if identifier.name == "Boolean" && no_adjust_identifier_is_global(identifier, ctx)) =>
                {
                    let mut identity = reset_live_prop_identity(
                        call.arguments.first()?.as_expression()?,
                        owner_function_id,
                        ctx,
                        visited_symbol_ids,
                    )?;
                    if identity.2 == 0 {
                        identity.2 = 1;
                    }
                    Some(identity)
                }
                _ => None,
            }
        }

        fn reset_is_constant_expression(
            expression: &Expression<'_>,
            ctx: &LintContext<'_>,
            visited_symbol_ids: &mut FxHashSet<SymbolId>,
        ) -> bool {
            match expression.get_inner_expression() {
                Expression::NullLiteral(_)
                | Expression::BooleanLiteral(_)
                | Expression::StringLiteral(_)
                | Expression::NumericLiteral(_)
                | Expression::BigIntLiteral(_)
                | Expression::RegExpLiteral(_) => true,
                Expression::Identifier(identifier) => {
                    let Some(symbol_id) = ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                    else {
                        return false;
                    };
                    if !visited_symbol_ids.insert(symbol_id) {
                        return false;
                    }
                    let declaration = ctx.symbol_declaration(symbol_id);
                    matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
                    if matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                        && declarator.id.get_binding_identifier().is_some_and(|identifier| identifier.symbol_id() == symbol_id)
                        && declarator.init.as_ref().is_some_and(|initializer| {
                            reset_is_constant_expression(initializer, ctx, visited_symbol_ids)
                        }))
                }
                Expression::UnaryExpression(unary)
                    if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
                {
                    reset_is_constant_expression(&unary.argument, ctx, visited_symbol_ids)
                }
                Expression::CallExpression(call)
                    if call.arguments.len() == 1
                        && matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                            if identifier.name == "Boolean" && no_adjust_identifier_is_global(identifier, ctx)) =>
                {
                    call.arguments
                        .first()
                        .and_then(Argument::as_expression)
                        .is_some_and(|argument| {
                            reset_is_constant_expression(argument, ctx, visited_symbol_ids)
                        })
                }
                _ => false,
            }
        }

        fn reset_is_mount_snapshot<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
            reset_is_mount_snapshot_inner(expression, ctx, &mut FxHashSet::default())
        }

        fn reset_is_mount_snapshot_inner<'a>(
            expression: &Expression<'a>,
            ctx: &LintContext<'a>,
            visited_symbol_ids: &mut FxHashSet<SymbolId>,
        ) -> bool {
            match expression.get_inner_expression() {
                Expression::CallExpression(call) => {
                    is_react_api_call(call, "useMemo", ctx)
                        && matches!(
                            call.arguments.get(1).and_then(Argument::as_expression),
                            Some(Expression::ArrayExpression(dependencies)) if dependencies.elements.is_empty()
                        )
                }
                Expression::Identifier(identifier) => {
                    let Some(symbol_id) = ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                    else {
                        return false;
                    };
                    if !visited_symbol_ids.insert(symbol_id) {
                        return false;
                    }
                    let declaration = ctx.symbol_declaration(symbol_id);
                    matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
                    if matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                        && declarator.id.get_binding_identifier().is_some_and(|identifier| identifier.symbol_id() == symbol_id)
                        && declarator.init.as_ref().is_some_and(|initializer| {
                            reset_is_mount_snapshot_inner(initializer, ctx, visited_symbol_ids)
                        }))
                }
                _ => false,
            }
        }

        fn reset_expression_reads_ref_current(
            expression: &Expression<'_>,
            ctx: &LintContext<'_>,
        ) -> bool {
            ctx.nodes().iter().any(|candidate| {
                expression.span().contains_inclusive(candidate.span())
                    && match candidate.kind() {
                        AstKind::StaticMemberExpression(member) => {
                            member.property.name == "current"
                        }
                        AstKind::ComputedMemberExpression(member) => {
                            matches!(member.expression.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "current")
                        }
                        _ => false,
                    }
            })
        }

        fn reset_every_setter_reloads_asynchronously(
            callback_function_id: NodeId,
            synchronous_function_ids: &FxHashSet<NodeId>,
            setter_symbol_ids: impl Iterator<Item = SymbolId>,
            function_node_index: &LocalCallbackNearestFunctionNodeIndex,
            ctx: &LintContext<'_>,
        ) -> bool {
            let target_setter_symbol_ids = setter_symbol_ids.collect::<FxHashSet<_>>();
            let mut reloaded_setter_symbol_ids = FxHashSet::default();
            let callback_span = ctx.nodes().get_node(callback_function_id).span();
            let mut invoked_async_function_ids = FxHashSet::default();
            for function_id in synchronous_function_ids {
                for &candidate_id in function_node_index.node_ids(*function_id) {
                    let candidate = ctx.nodes().get_node(candidate_id);
                    let AstKind::CallExpression(call) = candidate.kind() else {
                        continue;
                    };
                    if !is_node_reachable_within_function(
                        candidate,
                        ctx.nodes().get_node(*function_id),
                        ctx,
                    ) {
                        continue;
                    }
                    if let Some(called_function_id) =
                        no_adjust_state_fact_callback_function_id(&call.callee, ctx)
                        && no_adjust_function_is_async(called_function_id, ctx)
                    {
                        invoked_async_function_ids.insert(called_function_id);
                    }
                }
            }
            for candidate in ctx.nodes().iter() {
                let AstKind::CallExpression(call) = candidate.kind() else {
                    continue;
                };
                let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                    continue;
                };
                let Some(setter_symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx)
                else {
                    continue;
                };
                if !target_setter_symbol_ids.contains(&setter_symbol_id) {
                    continue;
                }
                let enclosing_function_id = no_adjust_nearest_function_node_id(candidate.id(), ctx);
                let is_nested_deferred_write = callback_span.contains_inclusive(candidate.span())
                    && !synchronous_function_ids
                        .contains(&enclosing_function_id.unwrap_or(callback_function_id));
                let is_reloading_async_helper_write =
                    enclosing_function_id.is_some_and(|function_id| {
                        invoked_async_function_ids.contains(&function_id)
                            && is_node_reachable_within_function(
                                candidate,
                                ctx.nodes().get_node(function_id),
                                ctx,
                            )
                            && reset_function_has_await_before(
                                function_id,
                                candidate,
                                function_node_index,
                                ctx,
                            )
                    });
                if is_nested_deferred_write || is_reloading_async_helper_write {
                    reloaded_setter_symbol_ids.insert(setter_symbol_id);
                }
            }
            reloaded_setter_symbol_ids == target_setter_symbol_ids
        }

        fn reset_function_has_await_before<'a>(
            function_id: NodeId,
            boundary_node: &AstNode<'a>,
            function_node_index: &LocalCallbackNearestFunctionNodeIndex,
            ctx: &LintContext<'a>,
        ) -> bool {
            function_node_index
                .node_ids(function_id)
                .iter()
                .any(|&node_id| {
                    let node = ctx.nodes().get_node(node_id);
                    matches!(node.kind(), AstKind::AwaitExpression(_))
                        && is_node_reachable_within_function(
                            node,
                            ctx.nodes().get_node(function_id),
                            ctx,
                        )
                        && reset_node_is_unconditional_from_entry(node, ctx)
                        && node_dominates_node(node, boundary_node, ctx)
                })
        }

        fn reset_node_is_unconditional_from_entry<'a>(
            node: &AstNode<'a>,
            ctx: &LintContext<'a>,
        ) -> bool {
            let owner = crate::ast_util::get_enclosing_function(node, ctx)
                .or_else(|| ctx.nodes().iter().next())
                .expect("program node");
            let entry_block = ctx.nodes().cfg_id(owner.id());
            let target_block = ctx.nodes().cfg_id(node.id());
            let reachable_blocks = reset_reachable_cfg_blocks(entry_block, None, ctx);
            reachable_blocks.contains(&target_block)
                && !reset_reachable_cfg_blocks(entry_block, Some(target_block), ctx)
                    .into_iter()
                    .any(|block_id| {
                        ctx.cfg()
                            .basic_block(block_id)
                            .instructions()
                            .iter()
                            .any(|instruction| {
                                matches!(
                                    instruction.kind,
                                    oxc_cfg::InstructionKind::ImplicitReturn
                                        | oxc_cfg::InstructionKind::Return(_)
                                )
                            })
                    })
        }

        fn reset_reachable_cfg_blocks(
            entry_block: oxc_cfg::BlockNodeId,
            excluded_block: Option<oxc_cfg::BlockNodeId>,
            ctx: &LintContext<'_>,
        ) -> FxHashSet<oxc_cfg::BlockNodeId> {
            let mut visited = FxHashSet::default();
            let mut pending = Vec::new();
            if Some(entry_block) != excluded_block {
                pending.push(entry_block);
            }
            while let Some(block_id) = pending.pop() {
                if !visited.insert(block_id) {
                    continue;
                }
                for edge in ctx
                    .cfg()
                    .graph()
                    .edges_directed(block_id, oxc_cfg::graph::Direction::Outgoing)
                {
                    if matches!(
                        edge.weight(),
                        oxc_cfg::EdgeType::NewFunction
                            | oxc_cfg::EdgeType::Unreachable
                            | oxc_cfg::EdgeType::Error(_)
                    ) {
                        continue;
                    }
                    let target = oxc_cfg::graph::visit::EdgeRef::target(&edge);
                    if Some(target) != excluded_block {
                        pending.push(target);
                    }
                }
            }
            visited
        }

        fn reset_has_synchronous_resource_lifecycle_transition(
            callback_function_id: NodeId,
            function_node_index: &LocalCallbackNearestFunctionNodeIndex,
            ctx: &LintContext<'_>,
        ) -> bool {
            let resource_ref_symbols = reset_resource_identity_ref_symbols(ctx);
            let mut root_function_ids = vec![callback_function_id];
            reset_collect_cleanup_function_ids(
                callback_function_id,
                function_node_index,
                ctx,
                &mut root_function_ids,
            );
            root_function_ids.into_iter().any(|root_function_id| {
                reset_resource_synchronous_function_ids(root_function_id, function_node_index, ctx)
                    .into_iter()
                    .any(|function_id| {
                        function_node_index
                            .node_ids(function_id)
                            .iter()
                            .any(|&node_id| {
                                reset_node_is_resource_lifecycle_transition(
                                    ctx.nodes().get_node(node_id),
                                    callback_function_id,
                                    &resource_ref_symbols,
                                    ctx,
                                )
                            })
                    })
            })
        }

        fn reset_collect_cleanup_function_ids(
            callback_function_id: NodeId,
            function_node_index: &LocalCallbackNearestFunctionNodeIndex,
            ctx: &LintContext<'_>,
            function_ids: &mut Vec<NodeId>,
        ) {
            let callback_node = ctx.nodes().get_node(callback_function_id);
            if let AstKind::ArrowFunctionExpression(function) = callback_node.kind()
                && let Some(expression) = function.get_expression()
                && let Some(function_id) = no_adjust_effect_callback_function_id(expression, ctx)
            {
                function_ids.push(function_id);
            }
            for &node_id in function_node_index.node_ids(callback_function_id) {
                let AstKind::ReturnStatement(statement) = ctx.nodes().get_node(node_id).kind()
                else {
                    continue;
                };
                if let Some(function_id) = statement
                    .argument
                    .as_ref()
                    .and_then(|expression| no_adjust_effect_callback_function_id(expression, ctx))
                {
                    function_ids.push(function_id);
                }
            }
        }

        fn reset_resource_identity_ref_symbols(ctx: &LintContext<'_>) -> FxHashSet<SymbolId> {
            ctx.nodes()
                .iter()
                .filter_map(|node| {
                    let AstKind::VariableDeclarator(declarator) = node.kind() else {
                        return None;
                    };
                    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                        return None;
                    };
                    if !reset_name_is_resource_identity_ref(identifier.name.as_str()) {
                        return None;
                    }
                    let Expression::CallExpression(call) =
                        declarator.init.as_ref()?.get_inner_expression()
                    else {
                        return None;
                    };
                    is_react_api_call(call, "useRef", ctx).then(|| identifier.symbol_id())
                })
                .collect()
        }

        fn reset_name_is_resource_identity_ref(name: &str) -> bool {
            let lowercase_name = name.to_ascii_lowercase();
            if lowercase_name == "workref" || lowercase_name == "workrefs" {
                return true;
            }
            [
                "abort",
                "activation",
                "attempt",
                "controller",
                "epoch",
                "gen",
                "generation",
                "localization",
                "pending",
                "request",
                "session",
                "token",
                "version",
            ]
            .iter()
            .any(|term| {
                lowercase_name.starts_with(term)
                    || lowercase_name.ends_with(term)
                    || lowercase_name.ends_with(&format!("{term}ref"))
                    || lowercase_name.ends_with(&format!("{term}refs"))
            })
        }

        fn reset_node_is_resource_lifecycle_transition(
            node: &AstNode<'_>,
            callback_function_id: NodeId,
            resource_ref_symbols: &FxHashSet<SymbolId>,
            ctx: &LintContext<'_>,
        ) -> bool {
            match node.kind() {
                AstKind::UpdateExpression(update) => {
                    update.argument.get_expression().is_some_and(|expression| {
                        reset_expression_is_owned_resource(
                            expression,
                            callback_function_id,
                            resource_ref_symbols,
                            ctx,
                            &mut FxHashSet::default(),
                        )
                    })
                }
                AstKind::AssignmentExpression(assignment) => {
                    if reset_assignment_target_is_resource_ref_current(
                        &assignment.left,
                        resource_ref_symbols,
                        ctx,
                    ) {
                        return true;
                    }
                    let Some(member) = assignment.left.as_member_expression() else {
                        return false;
                    };
                    assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign
                        && member.static_property_name().as_deref() == Some("superseded")
                        && matches!(assignment.right.get_inner_expression(), Expression::BooleanLiteral(literal) if literal.value)
                        && reset_expression_is_owned_resource(
                            member.object(),
                            callback_function_id,
                            resource_ref_symbols,
                            ctx,
                            &mut FxHashSet::default(),
                        )
                }
                AstKind::CallExpression(call) => {
                    let Some(member) = call.callee.get_inner_expression().as_member_expression()
                    else {
                        return false;
                    };
                    let Some(method_name) = member.static_property_name() else {
                        return false;
                    };
                    if method_name == "clear"
                        && reset_expression_is_resource_ref_current(
                            member.object(),
                            resource_ref_symbols,
                            ctx,
                        )
                    {
                        return true;
                    }
                    matches!(
                        method_name,
                        "unsubscribe"
                            | "removeEventListener"
                            | "removeListener"
                            | "off"
                            | "unwatch"
                            | "unlisten"
                            | "unsub"
                            | "abort"
                            | "disconnect"
                            | "unobserve"
                            | "close"
                    ) && reset_expression_is_owned_resource(
                        member.object(),
                        callback_function_id,
                        resource_ref_symbols,
                        ctx,
                        &mut FxHashSet::default(),
                    )
                }
                _ => false,
            }
        }

        fn reset_assignment_target_is_resource_ref_current(
            target: &oxc_ast::ast::AssignmentTarget<'_>,
            resource_ref_symbols: &FxHashSet<SymbolId>,
            ctx: &LintContext<'_>,
        ) -> bool {
            target.as_member_expression().is_some_and(|member| {
                member.static_property_name().as_deref() == Some("current")
                    && reset_expression_is_resource_ref_identifier(
                        member.object(),
                        resource_ref_symbols,
                        ctx,
                    )
            })
        }

        fn reset_expression_is_resource_ref_current(
            expression: &Expression<'_>,
            resource_ref_symbols: &FxHashSet<SymbolId>,
            ctx: &LintContext<'_>,
        ) -> bool {
            expression
                .get_inner_expression()
                .as_member_expression()
                .is_some_and(|member| {
                    member.static_property_name().as_deref() == Some("current")
                        && reset_expression_is_resource_ref_identifier(
                            member.object(),
                            resource_ref_symbols,
                            ctx,
                        )
                })
        }

        fn reset_expression_is_resource_ref_identifier(
            expression: &Expression<'_>,
            resource_ref_symbols: &FxHashSet<SymbolId>,
            ctx: &LintContext<'_>,
        ) -> bool {
            let Expression::Identifier(identifier) = expression.get_inner_expression() else {
                return false;
            };
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_some_and(|symbol_id| resource_ref_symbols.contains(&symbol_id))
        }

        fn reset_expression_is_owned_resource(
            expression: &Expression<'_>,
            callback_function_id: NodeId,
            resource_ref_symbols: &FxHashSet<SymbolId>,
            ctx: &LintContext<'_>,
            visited_symbol_ids: &mut FxHashSet<SymbolId>,
        ) -> bool {
            if reset_expression_is_resource_ref_current(expression, resource_ref_symbols, ctx) {
                return true;
            }
            let expression = expression.get_inner_expression();
            if let Some(member) = expression.as_member_expression() {
                return reset_expression_is_owned_resource(
                    member.object(),
                    callback_function_id,
                    resource_ref_symbols,
                    ctx,
                    visited_symbol_ids,
                );
            }
            if let Expression::CallExpression(call) = expression {
                return ctx.nodes().iter().any(|candidate| {
                    call.span.contains_inclusive(candidate.span())
                        && matches!(candidate.kind(), AstKind::StaticMemberExpression(member)
                        if member.property.name == "current"
                            && reset_expression_is_resource_ref_identifier(
                                &member.object,
                                resource_ref_symbols,
                                ctx,
                            ))
                });
            }
            let Expression::Identifier(identifier) = expression else {
                return false;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            for ancestor in ctx.nodes().ancestors(declaration.id()) {
                if let AstKind::ForOfStatement(statement) = ancestor.kind()
                    && reset_expression_contains_resource_ref_current(
                        &statement.right,
                        resource_ref_symbols,
                        ctx,
                    )
                {
                    return true;
                }
                if matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ) {
                    break;
                }
            }
            if let Some(initializer) = declarator.init.as_ref() {
                if matches!(
                    initializer.get_inner_expression(),
                    Expression::NewExpression(_)
                ) && ctx
                    .nodes()
                    .get_node(callback_function_id)
                    .span()
                    .contains_inclusive(declaration.span())
                {
                    return true;
                }
                if reset_expression_is_owned_resource(
                    initializer,
                    callback_function_id,
                    resource_ref_symbols,
                    ctx,
                    visited_symbol_ids,
                ) {
                    return true;
                }
            }
            ctx.nodes().iter().any(|candidate| {
                let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                    return false;
                };
                if !ctx
                    .nodes()
                    .get_node(callback_function_id)
                    .span()
                    .contains_inclusive(candidate.span())
                    || no_adjust_nearest_function_node_id(candidate.id(), ctx)
                        != Some(callback_function_id)
                    || !matches!(assignment.right.get_inner_expression(), Expression::NewExpression(_))
                {
                    return false;
                }
                matches!(&assignment.left, oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(target)
                    if ctx.scoping().get_reference(target.reference_id()).symbol_id() == Some(symbol_id))
            })
        }

        fn reset_expression_contains_resource_ref_current(
            expression: &Expression<'_>,
            resource_ref_symbols: &FxHashSet<SymbolId>,
            ctx: &LintContext<'_>,
        ) -> bool {
            ctx.nodes().iter().any(|candidate| {
                if !expression.span().contains_inclusive(candidate.span()) {
                    return false;
                }
                candidate
                    .kind()
                    .as_member_expression_kind()
                    .is_some_and(|member| {
                        member.static_property_name().as_deref() == Some("current")
                            && reset_expression_is_resource_ref_identifier(
                                member.object(),
                                resource_ref_symbols,
                                ctx,
                            )
                    })
            })
        }

        fn reset_all_state_exposure_is_visibility_guarded<'a>(
            owner_function_id: NodeId,
            dependencies: &oxc_ast::ast::ArrayExpression<'a>,
            owner_state: &ResetOwnerState,
            reset_calls_by_setter: &FxHashMap<SymbolId, Vec<ResetCall<'a>>>,
            ctx: &LintContext<'a>,
        ) -> bool {
            let Some(dependency_symbol_id) =
                reset_single_boolean_dependency_symbol(dependencies, owner_function_id, ctx)
            else {
                return false;
            };
            let protected_symbols = FxHashSet::from_iter([dependency_symbol_id]);
            let mut visible_value = None;
            for state_symbol_id in owner_state.state_symbols_by_setter.values() {
                let mut read_count = 0;
                for reference in ctx.scoping().get_resolved_references(*state_symbol_id) {
                    if !reference.is_read() || reference.is_write() {
                        continue;
                    }
                    let Some(reference_value) = reset_reference_visibility_value(
                        reference.node_id(),
                        owner_function_id,
                        &protected_symbols,
                        dependency_symbol_id,
                        ctx,
                    ) else {
                        return false;
                    };
                    if visible_value.is_some_and(|value| value != reference_value) {
                        return false;
                    }
                    visible_value = Some(reference_value);
                    read_count += 1;
                }
                if read_count == 0 {
                    return false;
                }
            }
            let Some(visible_value) = visible_value else {
                return false;
            };
            let reset_call_spans = reset_calls_by_setter
                .values()
                .flatten()
                .map(|reset_call| reset_call.call.span)
                .collect::<FxHashSet<_>>();
            for setter_symbol_id in reset_calls_by_setter.keys() {
                for reference in ctx.scoping().get_resolved_references(*setter_symbol_id) {
                    let reference_node = ctx.nodes().get_node(reference.node_id());
                    let Some(call_node_id) = reset_direct_call_node(reference_node, ctx) else {
                        return false;
                    };
                    let call_node = ctx.nodes().get_node(call_node_id);
                    if reset_call_spans.contains(&call_node.span()) {
                        continue;
                    }
                    if reset_reference_visibility_value(
                        call_node.id(),
                        owner_function_id,
                        &protected_symbols,
                        dependency_symbol_id,
                        ctx,
                    ) != Some(visible_value)
                    {
                        return false;
                    }
                }
            }
            true
        }

        fn reset_single_boolean_dependency_symbol(
            dependencies: &oxc_ast::ast::ArrayExpression<'_>,
            owner_function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> Option<SymbolId> {
            let mut references = Vec::new();
            for dependency in dependencies
                .elements
                .iter()
                .filter_map(no_adjust_array_element_expression)
            {
                for candidate in ctx.nodes().iter() {
                    let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                        continue;
                    };
                    if dependency.span().contains_inclusive(identifier.span) {
                        references.push(identifier);
                    }
                }
            }
            let identifier = references
                .as_slice()
                .first()
                .filter(|_| references.len() == 1)?;
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| reference.is_write())
                || !no_adjust_symbol_has_upstream_prop_source(
                    symbol_id,
                    owner_function_id,
                    ctx,
                    &mut Vec::new(),
                )
                || !reset_symbol_is_boolean(symbol_id, ctx, &mut FxHashSet::default())
            {
                return None;
            }
            Some(symbol_id)
        }

        fn reset_symbol_is_boolean(
            symbol_id: SymbolId,
            ctx: &LintContext<'_>,
            visited_symbol_ids: &mut FxHashSet<SymbolId>,
        ) -> bool {
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            if reset_symbol_type_annotation(symbol_id, ctx).is_some_and(reset_type_is_boolean) {
                return true;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
            if matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                && declarator.id.get_binding_identifier().is_some_and(|identifier| identifier.symbol_id() == symbol_id)
                && declarator.init.as_ref().is_some_and(|initializer| {
                    reset_expression_is_boolean(initializer, ctx, visited_symbol_ids)
                }))
        }

        fn reset_symbol_type_annotation<'a>(
            symbol_id: SymbolId,
            ctx: &LintContext<'a>,
        ) -> Option<&'a oxc_ast::ast::TSType<'a>> {
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::VariableDeclarator(declarator) => declarator
                    .id
                    .get_binding_identifier()
                    .filter(|identifier| identifier.symbol_id() == symbol_id)
                    .and(declarator.type_annotation.as_ref())
                    .map(|annotation| &annotation.type_annotation),
                AstKind::FormalParameter(parameter) => {
                    if parameter
                        .pattern
                        .get_binding_identifier()
                        .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
                    {
                        return parameter
                            .type_annotation
                            .as_ref()
                            .map(|annotation| &annotation.type_annotation);
                    }
                    let BindingPattern::ObjectPattern(pattern) = &parameter.pattern else {
                        return None;
                    };
                    let property_name = pattern.properties.iter().find_map(|property| {
                        property
                            .value
                            .get_binding_identifier()
                            .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
                            .then(|| property.key.static_name())
                            .flatten()
                    })?;
                    reset_property_type(
                        &parameter.type_annotation.as_ref()?.type_annotation,
                        property_name.as_ref(),
                        ctx,
                    )
                }
                _ => None,
            }
        }

        fn reset_property_type<'a>(
            parameter_type: &'a oxc_ast::ast::TSType<'a>,
            property_name: &str,
            ctx: &LintContext<'a>,
        ) -> Option<&'a oxc_ast::ast::TSType<'a>> {
            match parameter_type {
                oxc_ast::ast::TSType::TSTypeLiteral(literal) => {
                    reset_property_type_from_members(&literal.members, property_name)
                }
                oxc_ast::ast::TSType::TSTypeReference(reference) => {
                    let oxc_ast::ast::TSTypeName::IdentifierReference(type_name) =
                        &reference.type_name
                    else {
                        return None;
                    };
                    let mut matching_interface = None;
                    let mut matching_type_bindings = 0usize;
                    for candidate in ctx.nodes().iter() {
                        match candidate.kind() {
                            AstKind::TSInterfaceDeclaration(interface)
                                if interface.id.name == type_name.name =>
                            {
                                matching_type_bindings += 1;
                                if reset_type_declaration_is_top_level(candidate.id(), ctx) {
                                    matching_interface = Some(interface);
                                }
                            }
                            AstKind::TSTypeAliasDeclaration(alias)
                                if alias.id.name == type_name.name =>
                            {
                                matching_type_bindings += 1;
                            }
                            AstKind::Class(class)
                                if class
                                    .id
                                    .as_ref()
                                    .is_some_and(|id| id.name == type_name.name) =>
                            {
                                matching_type_bindings += 1;
                            }
                            AstKind::TSEnumDeclaration(enumeration)
                                if enumeration.id.name == type_name.name =>
                            {
                                matching_type_bindings += 1;
                            }
                            AstKind::TSTypeParameter(parameter)
                                if parameter.name.name == type_name.name =>
                            {
                                matching_type_bindings += 1;
                            }
                            _ => {}
                        }
                    }
                    (matching_type_bindings == 1)
                        .then(|| {
                            reset_property_type_from_members(
                                &matching_interface?.body.body,
                                property_name,
                            )
                        })
                        .flatten()
                }
                _ => None,
            }
        }

        fn reset_type_declaration_is_top_level(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
            let parent = ctx.nodes().parent_node(node_id);
            if matches!(parent.kind(), AstKind::Program(_)) {
                return true;
            }
            matches!(parent.kind(), AstKind::ExportNamedDeclaration(_))
                && matches!(
                    ctx.nodes().parent_node(parent.id()).kind(),
                    AstKind::Program(_)
                )
        }

        fn reset_property_type_from_members<'a>(
            members: &'a oxc_allocator::Vec<'a, oxc_ast::ast::TSSignature<'a>>,
            property_name: &str,
        ) -> Option<&'a oxc_ast::ast::TSType<'a>> {
            members.iter().find_map(|member| {
                let oxc_ast::ast::TSSignature::TSPropertySignature(property) = member else {
                    return None;
                };
                (property.key.static_name().as_deref() == Some(property_name))
                    .then(|| {
                        property
                            .type_annotation
                            .as_ref()
                            .map(|annotation| &annotation.type_annotation)
                    })
                    .flatten()
            })
        }

        fn reset_type_is_boolean(type_annotation: &oxc_ast::ast::TSType<'_>) -> bool {
            match type_annotation {
                oxc_ast::ast::TSType::TSBooleanKeyword(_) => true,
                oxc_ast::ast::TSType::TSUnionType(union) => union.types.iter().all(|member| {
                    matches!(
                        member,
                        oxc_ast::ast::TSType::TSBooleanKeyword(_)
                            | oxc_ast::ast::TSType::TSNullKeyword(_)
                            | oxc_ast::ast::TSType::TSUndefinedKeyword(_)
                    )
                }),
                _ => false,
            }
        }

        fn reset_expression_is_boolean(
            expression: &Expression<'_>,
            ctx: &LintContext<'_>,
            visited_symbol_ids: &mut FxHashSet<SymbolId>,
        ) -> bool {
            match expression.get_inner_expression() {
                Expression::BooleanLiteral(_) => true,
                Expression::UnaryExpression(unary)
                    if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
                {
                    true
                }
                Expression::BinaryExpression(binary)
                    if matches!(
                        binary.operator,
                        oxc_syntax::operator::BinaryOperator::Equality
                            | oxc_syntax::operator::BinaryOperator::Inequality
                            | oxc_syntax::operator::BinaryOperator::StrictEquality
                            | oxc_syntax::operator::BinaryOperator::StrictInequality
                            | oxc_syntax::operator::BinaryOperator::LessThan
                            | oxc_syntax::operator::BinaryOperator::LessEqualThan
                            | oxc_syntax::operator::BinaryOperator::GreaterThan
                            | oxc_syntax::operator::BinaryOperator::GreaterEqualThan
                    ) =>
                {
                    true
                }
                Expression::CallExpression(call)
                    if matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                        if identifier.name == "Boolean" && no_adjust_identifier_is_global(identifier, ctx)) =>
                {
                    true
                }
                Expression::LogicalExpression(logical) => {
                    reset_expression_is_boolean(&logical.left, ctx, &mut visited_symbol_ids.clone())
                        && reset_expression_is_boolean(
                            &logical.right,
                            ctx,
                            &mut visited_symbol_ids.clone(),
                        )
                }
                Expression::ConditionalExpression(conditional) => {
                    reset_expression_is_boolean(
                        &conditional.consequent,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    ) && reset_expression_is_boolean(
                        &conditional.alternate,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    )
                }
                Expression::Identifier(identifier) => ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_some_and(|symbol_id| {
                        reset_symbol_is_boolean(symbol_id, ctx, visited_symbol_ids)
                    }),
                _ => false,
            }
        }

        fn reset_reference_visibility_value(
            reference_node_id: NodeId,
            owner_function_id: NodeId,
            protected_symbols: &FxHashSet<SymbolId>,
            dependency_symbol_id: SymbolId,
            ctx: &LintContext<'_>,
        ) -> Option<bool> {
            let conditions = reset_collect_exposure_conditions(
                reference_node_id,
                owner_function_id,
                protected_symbols,
                ctx,
            )?;
            let implies_true = reset_conditions_imply(
                &conditions,
                &ResetBooleanFormula::Atom(dependency_symbol_id),
            );
            let implies_false = reset_conditions_imply(
                &conditions,
                &ResetBooleanFormula::Not(Box::new(ResetBooleanFormula::Atom(
                    dependency_symbol_id,
                ))),
            );
            (implies_true != implies_false).then_some(implies_true)
        }

        fn reset_collect_exposure_conditions(
            node_id: NodeId,
            owner_function_id: NodeId,
            protected_symbols: &FxHashSet<SymbolId>,
            ctx: &LintContext<'_>,
        ) -> Option<Vec<ResetBooleanFormula>> {
            let mut conditions = Vec::new();
            let mut child_id = node_id;
            loop {
                if child_id == owner_function_id {
                    return Some(conditions);
                }
                let child = ctx.nodes().get_node(child_id);
                let parent = ctx.nodes().parent_node(child_id);
                match parent.kind() {
                    AstKind::LogicalExpression(logical)
                        if logical.right.span().contains_inclusive(child.span()) =>
                    {
                        if logical.operator == oxc_syntax::operator::LogicalOperator::And {
                            reset_required_truthy_conditions(
                                &logical.left,
                                protected_symbols,
                                ctx,
                                &mut conditions,
                            );
                        } else if logical.operator == oxc_syntax::operator::LogicalOperator::Or
                            && let Some(formula) = reset_boolean_formula(
                                &logical.left,
                                protected_symbols,
                                ctx,
                                &mut FxHashSet::default(),
                            )
                        {
                            conditions.push(ResetBooleanFormula::Not(Box::new(formula)));
                        }
                    }
                    AstKind::ConditionalExpression(conditional) => {
                        if let Some(formula) = reset_boolean_formula(
                            &conditional.test,
                            protected_symbols,
                            ctx,
                            &mut FxHashSet::default(),
                        ) {
                            if conditional
                                .consequent
                                .span()
                                .contains_inclusive(child.span())
                            {
                                conditions.push(formula);
                            } else if conditional
                                .alternate
                                .span()
                                .contains_inclusive(child.span())
                            {
                                conditions.push(ResetBooleanFormula::Not(Box::new(formula)));
                            }
                        }
                    }
                    AstKind::IfStatement(statement) => {
                        if let Some(formula) = reset_boolean_formula(
                            &statement.test,
                            protected_symbols,
                            ctx,
                            &mut FxHashSet::default(),
                        ) {
                            if statement.consequent.span().contains_inclusive(child.span()) {
                                conditions.push(formula);
                            } else if statement.alternate.as_ref().is_some_and(|alternate| {
                                alternate.span().contains_inclusive(child.span())
                            }) {
                                conditions.push(ResetBooleanFormula::Not(Box::new(formula)));
                            }
                        }
                    }
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                        if parent.id() != owner_function_id =>
                    {
                        if reset_function_is_inside_jsx_attribute(parent.id(), ctx) {
                            child_id = parent.id();
                            continue;
                        }
                        if let Some(call_node_id) =
                            reset_synchronous_callback_call_node(parent.id(), ctx)
                        {
                            child_id = call_node_id;
                            continue;
                        }
                        let call_node_id = reset_single_direct_function_call(parent.id(), ctx)?;
                        child_id = call_node_id;
                        continue;
                    }
                    _ => {}
                }
                if parent.id() == child_id {
                    return None;
                }
                child_id = parent.id();
            }
        }

        fn reset_required_truthy_conditions(
            expression: &Expression<'_>,
            protected_symbols: &FxHashSet<SymbolId>,
            ctx: &LintContext<'_>,
            conditions: &mut Vec<ResetBooleanFormula>,
        ) {
            if let Some(formula) = reset_boolean_formula(
                expression,
                protected_symbols,
                ctx,
                &mut FxHashSet::default(),
            ) {
                conditions.push(formula);
                return;
            }
            if let Expression::LogicalExpression(logical) = expression.get_inner_expression()
                && logical.operator == oxc_syntax::operator::LogicalOperator::And
            {
                reset_required_truthy_conditions(&logical.left, protected_symbols, ctx, conditions);
                reset_required_truthy_conditions(
                    &logical.right,
                    protected_symbols,
                    ctx,
                    conditions,
                );
            }
        }

        fn reset_boolean_formula(
            expression: &Expression<'_>,
            protected_symbols: &FxHashSet<SymbolId>,
            ctx: &LintContext<'_>,
            visited_symbol_ids: &mut FxHashSet<SymbolId>,
        ) -> Option<ResetBooleanFormula> {
            match expression.get_inner_expression() {
                Expression::NullLiteral(_) => Some(ResetBooleanFormula::Constant(false)),
                Expression::BooleanLiteral(literal) => {
                    Some(ResetBooleanFormula::Constant(literal.value))
                }
                Expression::StringLiteral(literal) => {
                    Some(ResetBooleanFormula::Constant(!literal.value.is_empty()))
                }
                Expression::NumericLiteral(literal) => Some(ResetBooleanFormula::Constant(
                    literal.value != 0.0 && !literal.value.is_nan(),
                )),
                Expression::BigIntLiteral(literal) => {
                    Some(ResetBooleanFormula::Constant(literal.value != "0"))
                }
                Expression::RegExpLiteral(_) => Some(ResetBooleanFormula::Constant(true)),
                Expression::Identifier(identifier) => {
                    if identifier.name == "undefined"
                        && no_adjust_identifier_is_global(identifier, ctx)
                    {
                        return Some(ResetBooleanFormula::Constant(false));
                    }
                    let symbol_id = ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()?;
                    if protected_symbols.contains(&symbol_id) {
                        return Some(ResetBooleanFormula::Atom(symbol_id));
                    }
                    if visited_symbol_ids.insert(symbol_id) {
                        let declaration = ctx.symbol_declaration(symbol_id);
                        if let AstKind::VariableDeclarator(declarator) = declaration.kind()
                            && matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                            && declarator
                                .id
                                .get_binding_identifier()
                                .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
                            && let Some(initializer) = declarator.init.as_ref()
                            && let Some(formula) = reset_boolean_formula(
                                initializer,
                                protected_symbols,
                                ctx,
                                visited_symbol_ids,
                            )
                        {
                            return Some(formula);
                        }
                    }
                    Some(ResetBooleanFormula::Atom(symbol_id))
                }
                Expression::UnaryExpression(unary)
                    if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
                {
                    Some(ResetBooleanFormula::Not(Box::new(reset_boolean_formula(
                        &unary.argument,
                        protected_symbols,
                        ctx,
                        visited_symbol_ids,
                    )?)))
                }
                Expression::CallExpression(call)
                    if call.arguments.len() == 1
                        && matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                            if identifier.name == "Boolean" && no_adjust_identifier_is_global(identifier, ctx)) =>
                {
                    reset_boolean_formula(
                        call.arguments.first()?.as_expression()?,
                        protected_symbols,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                Expression::LogicalExpression(logical)
                    if matches!(
                        logical.operator,
                        oxc_syntax::operator::LogicalOperator::And
                            | oxc_syntax::operator::LogicalOperator::Or
                    ) =>
                {
                    let left = reset_boolean_formula(
                        &logical.left,
                        protected_symbols,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    )?;
                    let right = reset_boolean_formula(
                        &logical.right,
                        protected_symbols,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    )?;
                    Some(
                        if logical.operator == oxc_syntax::operator::LogicalOperator::And {
                            ResetBooleanFormula::And(Box::new(left), Box::new(right))
                        } else {
                            ResetBooleanFormula::Or(Box::new(left), Box::new(right))
                        },
                    )
                }
                Expression::ConditionalExpression(conditional) => {
                    let test = reset_boolean_formula(
                        &conditional.test,
                        protected_symbols,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    )?;
                    let consequent = reset_boolean_formula(
                        &conditional.consequent,
                        protected_symbols,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    )?;
                    let alternate = reset_boolean_formula(
                        &conditional.alternate,
                        protected_symbols,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    )?;
                    Some(ResetBooleanFormula::Or(
                        Box::new(ResetBooleanFormula::And(
                            Box::new(test.clone()),
                            Box::new(consequent),
                        )),
                        Box::new(ResetBooleanFormula::And(
                            Box::new(ResetBooleanFormula::Not(Box::new(test))),
                            Box::new(alternate),
                        )),
                    ))
                }
                Expression::BinaryExpression(binary)
                    if matches!(
                        binary.operator,
                        oxc_syntax::operator::BinaryOperator::Equality
                            | oxc_syntax::operator::BinaryOperator::Inequality
                            | oxc_syntax::operator::BinaryOperator::StrictEquality
                            | oxc_syntax::operator::BinaryOperator::StrictInequality
                    ) =>
                {
                    let (compared, expected) = match (
                        binary.left.get_inner_expression(),
                        binary.right.get_inner_expression(),
                    ) {
                        (Expression::BooleanLiteral(literal), right) => (right, literal.value),
                        (left, Expression::BooleanLiteral(literal)) => (left, literal.value),
                        _ => return None,
                    };
                    let formula = reset_boolean_formula(
                        compared,
                        protected_symbols,
                        ctx,
                        visited_symbol_ids,
                    )?;
                    let is_equality = matches!(
                        binary.operator,
                        oxc_syntax::operator::BinaryOperator::Equality
                            | oxc_syntax::operator::BinaryOperator::StrictEquality
                    );
                    (is_equality == expected)
                        .then_some(formula.clone())
                        .or_else(|| Some(ResetBooleanFormula::Not(Box::new(formula))))
                }
                _ => None,
            }
        }

        fn reset_conditions_imply(
            conditions: &[ResetBooleanFormula],
            target: &ResetBooleanFormula,
        ) -> bool {
            let mut facts = ResetBooleanFacts {
                assignments: FxHashMap::default(),
                did_conflict: false,
                did_change: true,
            };
            while facts.did_change && !facts.did_conflict {
                facts.did_change = false;
                for condition in conditions {
                    reset_add_required_boolean_facts(condition, true, &mut facts);
                }
            }
            facts.did_conflict || reset_evaluate_formula(target, &facts.assignments) == Some(true)
        }

        fn reset_assign_boolean_fact(
            facts: &mut ResetBooleanFacts,
            symbol_id: SymbolId,
            value: bool,
        ) {
            if let Some(existing_value) = facts.assignments.get(&symbol_id) {
                if *existing_value != value {
                    facts.did_conflict = true;
                }
            } else {
                facts.assignments.insert(symbol_id, value);
                facts.did_change = true;
            }
        }

        fn reset_evaluate_formula(
            formula: &ResetBooleanFormula,
            assignments: &FxHashMap<SymbolId, bool>,
        ) -> Option<bool> {
            match formula {
                ResetBooleanFormula::And(left, right) => {
                    let left_value = reset_evaluate_formula(left, assignments);
                    let right_value = reset_evaluate_formula(right, assignments);
                    if left_value == Some(false) || right_value == Some(false) {
                        Some(false)
                    } else if left_value == Some(true) && right_value == Some(true) {
                        Some(true)
                    } else {
                        None
                    }
                }
                ResetBooleanFormula::Atom(symbol_id) => assignments.get(symbol_id).copied(),
                ResetBooleanFormula::Constant(value) => Some(*value),
                ResetBooleanFormula::Not(inner) => {
                    reset_evaluate_formula(inner, assignments).map(|value| !value)
                }
                ResetBooleanFormula::Or(left, right) => {
                    let left_value = reset_evaluate_formula(left, assignments);
                    let right_value = reset_evaluate_formula(right, assignments);
                    if left_value == Some(true) || right_value == Some(true) {
                        Some(true)
                    } else if left_value == Some(false) && right_value == Some(false) {
                        Some(false)
                    } else {
                        None
                    }
                }
            }
        }

        fn reset_add_required_boolean_facts(
            formula: &ResetBooleanFormula,
            expected_value: bool,
            facts: &mut ResetBooleanFacts,
        ) {
            if let Some(existing_value) = reset_evaluate_formula(formula, &facts.assignments) {
                if existing_value != expected_value {
                    facts.did_conflict = true;
                }
                return;
            }
            match formula {
                ResetBooleanFormula::Atom(symbol_id) => {
                    reset_assign_boolean_fact(facts, *symbol_id, expected_value);
                }
                ResetBooleanFormula::Not(inner) => {
                    reset_add_required_boolean_facts(inner, !expected_value, facts);
                }
                ResetBooleanFormula::And(left, right) if expected_value => {
                    reset_add_required_boolean_facts(left, true, facts);
                    reset_add_required_boolean_facts(right, true, facts);
                }
                ResetBooleanFormula::And(left, right) => {
                    let left_value = reset_evaluate_formula(left, &facts.assignments);
                    let right_value = reset_evaluate_formula(right, &facts.assignments);
                    if left_value == Some(true) {
                        reset_add_required_boolean_facts(right, false, facts);
                    }
                    if right_value == Some(true) {
                        reset_add_required_boolean_facts(left, false, facts);
                    }
                }
                ResetBooleanFormula::Or(left, right) if !expected_value => {
                    reset_add_required_boolean_facts(left, false, facts);
                    reset_add_required_boolean_facts(right, false, facts);
                }
                ResetBooleanFormula::Or(left, right) => {
                    let left_value = reset_evaluate_formula(left, &facts.assignments);
                    let right_value = reset_evaluate_formula(right, &facts.assignments);
                    if left_value == Some(false) {
                        reset_add_required_boolean_facts(right, true, facts);
                    }
                    if right_value == Some(false) {
                        reset_add_required_boolean_facts(left, true, facts);
                    }
                }
                ResetBooleanFormula::Constant(_) => {}
            }
        }

        fn reset_direct_call_node<'a>(
            reference_node: &AstNode<'a>,
            ctx: &LintContext<'a>,
        ) -> Option<NodeId> {
            let parent = ctx.nodes().parent_node(reference_node.id());
            matches!(parent.kind(), AstKind::CallExpression(call)
                if call.callee.span() == reference_node.span())
            .then_some(parent.id())
        }

        fn reset_function_is_inside_jsx_attribute(
            function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> bool {
            for ancestor in ctx.nodes().ancestors(function_id) {
                if matches!(ancestor.kind(), AstKind::JSXAttribute(_)) {
                    return true;
                }
                if matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ) {
                    return false;
                }
            }
            false
        }

        fn reset_synchronous_callback_call_node(
            function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> Option<NodeId> {
            let function_node = ctx.nodes().get_node(function_id);
            let call_node = ctx.nodes().parent_node(function_id);
            let AstKind::CallExpression(call) = call_node.kind() else {
                return None;
            };
            if !call
                .arguments
                .iter()
                .filter_map(Argument::as_expression)
                .any(|argument| argument.span() == function_node.span())
            {
                return None;
            }
            let member = call.callee.get_inner_expression().as_member_expression()?;
            matches!(
                member.static_property_name(),
                Some(
                    "every"
                        | "filter"
                        | "find"
                        | "findIndex"
                        | "flatMap"
                        | "forEach"
                        | "map"
                        | "reduce"
                        | "reduceRight"
                        | "some"
                )
            )
            .then_some(call_node.id())
        }

        fn reset_single_direct_function_call(
            function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> Option<NodeId> {
            let function_node = ctx.nodes().get_node(function_id);
            let function_symbol_id = match function_node.kind() {
                AstKind::Function(function) if function.id.is_some() => {
                    function.id.as_ref().map(|id| id.symbol_id())
                }
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                    let declaration = ctx.nodes().parent_node(function_id);
                    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                        return None;
                    };
                    declarator
                        .init
                        .as_ref()
                        .is_some_and(|initializer| initializer.span() == function_node.span())
                        .then(|| declarator.id.get_binding_identifier())
                        .flatten()
                        .map(|identifier| identifier.symbol_id())
                }
                _ => None,
            }?;
            let mut call_node_id = None;
            for reference in ctx.scoping().get_resolved_references(function_symbol_id) {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let direct_call_id = reset_direct_call_node(reference_node, ctx)?;
                if call_node_id.replace(direct_call_id).is_some() {
                    return None;
                }
            }
            call_node_id
        }

        fn reset_owner_is_custom_hook<'a>(function_id: NodeId, ctx: &LintContext<'a>) -> bool {
            reset_function_name(function_id, ctx).is_some_and(|name| {
                name.starts_with("use")
                    && name.as_bytes().get(3).is_some_and(|character| {
                        character.is_ascii_uppercase() || character.is_ascii_digit()
                    })
            })
        }

        fn reset_function_name<'a>(function_id: NodeId, ctx: &LintContext<'a>) -> Option<&'a str> {
            let function_node = ctx.nodes().get_node(function_id);
            if let AstKind::Function(function) = function_node.kind()
                && let Some(identifier) = &function.id
            {
                return Some(identifier.name.as_str());
            }
            let mut ancestor = ctx.nodes().parent_node(function_id);
            loop {
                if let AstKind::VariableDeclarator(declarator) = ancestor.kind()
                    && let BindingPattern::BindingIdentifier(identifier) = &declarator.id
                {
                    return Some(identifier.name.as_str());
                }
                if matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ) {
                    return None;
                }
                let parent = ctx.nodes().parent_node(ancestor.id());
                if parent.id() == ancestor.id() {
                    return None;
                }
                ancestor = parent;
            }
        }
    }

    pub use reset_rule::NoResetAllStateOnPropChange;
}

pub use implementation::NoResetAllStateOnPropChange;
