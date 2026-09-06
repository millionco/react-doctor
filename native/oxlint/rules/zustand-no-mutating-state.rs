use oxc_span::GetSpan;

mod implementation {
    include!("no_mutating_reducer_state.rs");

    mod zustand_rule {
        use super::super::{
            LocalCallbackNearestFunctionNodeIndex, LocalFunctionResolutionCache, ZustandApiName,
            are_nodes_in_mutually_exclusive_branches,
            build_local_callback_nearest_function_node_index, exact_local_callback_function_id,
            exact_local_function_id, local_callback_nearest_function_id,
            resolve_const_identifier_root_symbol, resolve_zustand_store_creator,
        };
        use super::*;
        use oxc_ast::ast::Argument;
        use oxc_span::GetSpan;
        use rustc_hash::FxHashMap;

        const ZUSTAND_MESSAGE: &str = "This Zustand state reference is mutated and reused, so subscribers can miss the update.";

        #[derive(Clone, Copy, Eq, PartialEq)]
        enum ReplacementDisposition {
            Fresh,
            Reused,
            Unknown,
        }

        enum ZustandMutationPath {
            Known(Vec<String>),
            Unknown,
        }

        struct ZustandBinding {
            creator_function_id: NodeId,
            get_symbol_id: Option<SymbolId>,
            has_non_immer_usage: bool,
            map_or_set_paths: FxHashSet<Vec<String>>,
            non_immer_store_symbol_ids: FxHashSet<SymbolId>,
            array_paths: FxHashSet<Vec<String>>,
            set_symbol_id: Option<SymbolId>,
            store_symbol_ids: FxHashSet<SymbolId>,
        }

        #[derive(Debug, Default, Clone)]
        pub struct ZustandNoMutatingState;

        declare_oxc_lint!(
            /// Disallow mutating and reusing Zustand state references.
            ZustandNoMutatingState,
            react_doctor_native,
            correctness,
            version = "0.1.0",
            short_description = "Zustand state mutated in place.",
        );

        impl Rule for ZustandNoMutatingState {
            fn run_once<'a>(&self, ctx: &LintContext<'a>) {
                let node_index = build_local_callback_nearest_function_node_index(ctx);
                let mut resolution_cache = LocalFunctionResolutionCache::default();
                let mut bindings = zustand_collect_bindings(ctx, &mut resolution_cache);
                if bindings.is_empty() {
                    return;
                }
                let mut reported_spans = FxHashSet::default();
                for binding in &mut bindings {
                    zustand_analyze_creator_set_updaters(
                        binding,
                        &node_index,
                        ctx,
                        &mut resolution_cache,
                        &mut reported_spans,
                    );
                    zustand_analyze_bound_set_state_updaters(
                        binding,
                        &node_index,
                        ctx,
                        &mut resolution_cache,
                        &mut reported_spans,
                    );
                    zustand_analyze_snapshot_mutations(binding, ctx, &mut reported_spans);
                }
            }
        }

        fn zustand_collect_bindings(
            ctx: &LintContext<'_>,
            resolution_cache: &mut LocalFunctionResolutionCache,
        ) -> Vec<ZustandBinding> {
            let mut bindings = Vec::<ZustandBinding>::new();
            let mut binding_index_by_creator = FxHashMap::default();
            for node in ctx.nodes().iter() {
                let AstKind::CallExpression(call) = node.kind() else {
                    continue;
                };
                let Some(creator) = resolve_zustand_store_creator(call, ctx, resolution_cache)
                else {
                    continue;
                };
                let is_non_immer = !creator.middleware_names.contains(&ZustandApiName::Immer);
                let binding_index = *binding_index_by_creator
                    .entry(creator.creator_function_id)
                    .or_insert_with(|| {
                        let (array_paths, map_or_set_paths) =
                            zustand_creator_collection_paths(creator.creator_function_id, ctx);
                        let binding_index = bindings.len();
                        bindings.push(ZustandBinding {
                            creator_function_id: creator.creator_function_id,
                            get_symbol_id: zustand_function_parameter_symbol(
                                creator.creator_function_id,
                                1,
                                ctx,
                            ),
                            has_non_immer_usage: is_non_immer,
                            map_or_set_paths,
                            non_immer_store_symbol_ids: FxHashSet::default(),
                            array_paths,
                            set_symbol_id: zustand_function_parameter_symbol(
                                creator.creator_function_id,
                                0,
                                ctx,
                            ),
                            store_symbol_ids: FxHashSet::default(),
                        });
                        binding_index
                    });
                let binding = &mut bindings[binding_index];
                binding.has_non_immer_usage |= is_non_immer;
                let Some(store_symbol_id) = zustand_store_binding_symbol(node, ctx) else {
                    continue;
                };
                binding.store_symbol_ids.insert(store_symbol_id);
                if is_non_immer {
                    binding.non_immer_store_symbol_ids.insert(store_symbol_id);
                }
            }
            bindings
        }

        fn zustand_function_parameter_symbol(
            function_id: NodeId,
            parameter_index: usize,
            ctx: &LintContext<'_>,
        ) -> Option<SymbolId> {
            let parameters = match ctx.nodes().get_node(function_id).kind() {
                AstKind::Function(function) => &function.params,
                AstKind::ArrowFunctionExpression(function) => &function.params,
                _ => return None,
            };
            let pattern = &parameters.items.get(parameter_index)?.pattern;
            match pattern {
                BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
                BindingPattern::AssignmentPattern(assignment) => assignment
                    .left
                    .get_binding_identifier()
                    .map(oxc_ast::ast::BindingIdentifier::symbol_id),
                _ => None,
            }
        }

        fn zustand_store_binding_symbol(
            call_node: &AstNode<'_>,
            ctx: &LintContext<'_>,
        ) -> Option<SymbolId> {
            let parent = ctx.nodes().parent_node(call_node.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                return None;
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != call_node.span())
            {
                return None;
            }
            declarator
                .id
                .get_binding_identifier()
                .map(oxc_ast::ast::BindingIdentifier::symbol_id)
        }

        fn zustand_creator_collection_paths(
            creator_function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> (FxHashSet<Vec<String>>, FxHashSet<Vec<String>>) {
            let mut array_paths = FxHashSet::default();
            let mut map_or_set_paths = FxHashSet::default();
            for expression in zustand_returned_expressions(creator_function_id, ctx) {
                if let Expression::ObjectExpression(object) = expression.get_inner_expression() {
                    zustand_collect_object_collection_paths(
                        object,
                        &[],
                        &mut array_paths,
                        &mut map_or_set_paths,
                    );
                }
            }
            (array_paths, map_or_set_paths)
        }

        fn zustand_collect_object_collection_paths(
            object: &oxc_ast::ast::ObjectExpression<'_>,
            parent_path: &[String],
            array_paths: &mut FxHashSet<Vec<String>>,
            map_or_set_paths: &mut FxHashSet<Vec<String>>,
        ) {
            for property in &object.properties {
                let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
                    continue;
                };
                let Some(property_name) = property.key.static_name() else {
                    continue;
                };
                let mut property_path = parent_path.to_vec();
                property_path.push(property_name.to_string());
                match property.value.get_inner_expression() {
                    Expression::ArrayExpression(_) => {
                        array_paths.insert(property_path);
                    }
                    Expression::NewExpression(construction)
                        if matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier)
                            if identifier.name == "Map" || identifier.name == "Set") =>
                    {
                        map_or_set_paths.insert(property_path);
                    }
                    Expression::ObjectExpression(nested) => {
                        zustand_collect_object_collection_paths(
                            nested,
                            &property_path,
                            array_paths,
                            map_or_set_paths,
                        );
                    }
                    _ => {}
                }
            }
        }

        fn zustand_analyze_creator_set_updaters<'a>(
            binding: &ZustandBinding,
            node_index: &LocalCallbackNearestFunctionNodeIndex,
            ctx: &LintContext<'a>,
            resolution_cache: &mut LocalFunctionResolutionCache,
            reported_spans: &mut FxHashSet<oxc_span::Span>,
        ) {
            if !binding.has_non_immer_usage {
                return;
            }
            let Some(set_symbol_id) = binding.set_symbol_id else {
                return;
            };
            for node in ctx.nodes().iter() {
                let AstKind::CallExpression(call) = node.kind() else {
                    continue;
                };
                if !zustand_call_targets_symbol(call, set_symbol_id, ctx)
                    || !ctx
                        .nodes()
                        .get_node(binding.creator_function_id)
                        .span()
                        .contains_inclusive(node.span())
                {
                    continue;
                }
                let Some(updater_expression) =
                    call.arguments.first().and_then(Argument::as_expression)
                else {
                    continue;
                };
                let Some(updater_function_id) = exact_local_function_id(
                    updater_expression,
                    ctx,
                    &mut Vec::new(),
                    resolution_cache,
                ) else {
                    continue;
                };
                zustand_analyze_updater(
                    updater_function_id,
                    binding,
                    node_index,
                    ctx,
                    reported_spans,
                );
            }
        }

        fn zustand_analyze_bound_set_state_updaters<'a>(
            binding: &ZustandBinding,
            node_index: &LocalCallbackNearestFunctionNodeIndex,
            ctx: &LintContext<'a>,
            resolution_cache: &mut LocalFunctionResolutionCache,
            reported_spans: &mut FxHashSet<oxc_span::Span>,
        ) {
            for node in ctx.nodes().iter() {
                let AstKind::CallExpression(call) = node.kind() else {
                    continue;
                };
                let Some(store_symbol_id) = zustand_store_method_symbol(call, "setState", ctx)
                else {
                    continue;
                };
                if !binding
                    .non_immer_store_symbol_ids
                    .contains(&store_symbol_id)
                {
                    continue;
                }
                let Some(updater_expression) =
                    call.arguments.first().and_then(Argument::as_expression)
                else {
                    continue;
                };
                let Some(updater_function_id) = exact_local_function_id(
                    updater_expression,
                    ctx,
                    &mut Vec::new(),
                    resolution_cache,
                ) else {
                    continue;
                };
                zustand_analyze_updater(
                    updater_function_id,
                    binding,
                    node_index,
                    ctx,
                    reported_spans,
                );
            }
        }

        fn zustand_analyze_updater<'a>(
            updater_function_id: NodeId,
            binding: &ZustandBinding,
            node_index: &LocalCallbackNearestFunctionNodeIndex,
            ctx: &LintContext<'a>,
            reported_spans: &mut FxHashSet<oxc_span::Span>,
        ) {
            if zustand_function_is_async_or_generator(updater_function_id, ctx)
                || zustand_function_has_unsupported_control_flow(updater_function_id, ctx)
            {
                return;
            }
            let Some(state_symbol_id) =
                zustand_function_parameter_symbol(updater_function_id, 0, ctx)
            else {
                return;
            };
            let returned_expressions = zustand_returned_expressions(updater_function_id, ctx);
            for &candidate_id in node_index.node_ids(updater_function_id) {
                let candidate = ctx.nodes().get_node(candidate_id);
                let Some(mutation_path) =
                    zustand_mutation_path_from_state(candidate, state_symbol_id, binding, ctx)
                else {
                    continue;
                };
                let reuses_mutated_reference = returned_expressions.is_empty()
                    || match &mutation_path {
                        ZustandMutationPath::Known(mutation_path) => {
                            returned_expressions.iter().any(|expression| {
                                zustand_binding_snapshot_path(expression, binding, ctx).is_some_and(
                                    |snapshot_path| {
                                        zustand_path_preserves_target(&snapshot_path, mutation_path)
                                    },
                                ) || zustand_update_expression_disposition(
                                    expression,
                                    mutation_path,
                                    candidate,
                                    state_symbol_id,
                                    ctx,
                                ) == ReplacementDisposition::Reused
                            })
                        }
                        ZustandMutationPath::Unknown => returned_expressions
                            .iter()
                            .any(|expression| zustand_expression_is_no_update(expression, ctx)),
                    };
                if reuses_mutated_reference && reported_spans.insert(candidate.span()) {
                    ctx.diagnostic(
                        OxcDiagnostic::error(ZUSTAND_MESSAGE).with_label(candidate.span()),
                    );
                }
            }
        }

        fn zustand_function_is_async_or_generator(
            function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> bool {
            match ctx.nodes().get_node(function_id).kind() {
                AstKind::Function(function) => function.r#async || function.generator,
                AstKind::ArrowFunctionExpression(function) => function.r#async,
                _ => true,
            }
        }

        fn zustand_returned_expressions<'a>(
            function_id: NodeId,
            ctx: &LintContext<'a>,
        ) -> Vec<&'a Expression<'a>> {
            let function_node = ctx.nodes().get_node(function_id);
            if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
                && let Some(expression) = function.get_expression()
            {
                return vec![expression];
            }
            ctx.nodes()
                .iter()
                .filter_map(|candidate| {
                    if local_callback_nearest_function_id(candidate.id(), ctx) != Some(function_id)
                    {
                        return None;
                    }
                    let AstKind::ReturnStatement(statement) = candidate.kind() else {
                        return None;
                    };
                    statement.argument.as_ref()
                })
                .collect()
        }

        fn zustand_function_has_unsupported_control_flow(
            function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> bool {
            let statements = match ctx.nodes().get_node(function_id).kind() {
                AstKind::Function(function) => function.body.as_ref().map(|body| &body.statements),
                AstKind::ArrowFunctionExpression(function)
                    if function.get_expression().is_none() =>
                {
                    function.get_function_body().map(|body| &body.statements)
                }
                _ => None,
            };
            statements.is_some_and(|statements| {
                statements.iter().any(|statement| {
                    matches!(
                        statement,
                        oxc_ast::ast::Statement::DoWhileStatement(_)
                            | oxc_ast::ast::Statement::ForInStatement(_)
                            | oxc_ast::ast::Statement::ForOfStatement(_)
                            | oxc_ast::ast::Statement::ForStatement(_)
                            | oxc_ast::ast::Statement::IfStatement(_)
                            | oxc_ast::ast::Statement::LabeledStatement(_)
                            | oxc_ast::ast::Statement::BlockStatement(_)
                            | oxc_ast::ast::Statement::SwitchStatement(_)
                            | oxc_ast::ast::Statement::TryStatement(_)
                            | oxc_ast::ast::Statement::WhileStatement(_)
                            | oxc_ast::ast::Statement::WithStatement(_)
                    )
                })
            })
        }

        fn zustand_mutation_path_from_state<'a>(
            node: &AstNode<'a>,
            state_symbol_id: SymbolId,
            binding: &ZustandBinding,
            ctx: &LintContext<'a>,
        ) -> Option<ZustandMutationPath> {
            match node.kind() {
                AstKind::AssignmentExpression(assignment) => {
                    let member = assignment.left.as_member_expression()?;
                    zustand_mutation_path_from_symbol_source(
                        member.object(),
                        state_symbol_id,
                        node,
                        ctx,
                    )
                }
                AstKind::UpdateExpression(update) => {
                    let member = update.argument.as_member_expression()?;
                    zustand_mutation_path_from_symbol_source(
                        member.object(),
                        state_symbol_id,
                        node,
                        ctx,
                    )
                }
                AstKind::UnaryExpression(unary)
                    if unary.operator == oxc_syntax::operator::UnaryOperator::Delete =>
                {
                    let member = unary
                        .argument
                        .get_inner_expression()
                        .as_member_expression()?;
                    zustand_mutation_path_from_symbol_source(
                        member.object(),
                        state_symbol_id,
                        node,
                        ctx,
                    )
                }
                AstKind::CallExpression(call) => {
                    zustand_mutating_call_path(call, node, state_symbol_id, binding, ctx)
                }
                _ => None,
            }
        }

        fn zustand_mutating_call_path<'a>(
            call: &oxc_ast::ast::CallExpression<'a>,
            call_node: &AstNode<'a>,
            state_symbol_id: SymbolId,
            binding: &ZustandBinding,
            ctx: &LintContext<'a>,
        ) -> Option<ZustandMutationPath> {
            let member = call.callee.get_inner_expression().as_member_expression()?;
            let method_name = member.static_property_name()?;
            if matches!(
                method_name,
                "assign" | "defineProperties" | "defineProperty"
            ) && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "Object" && zustand_identifier_is_global(identifier, ctx))
            {
                return call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .and_then(|expression| {
                        zustand_mutation_path_from_symbol_source(
                            expression,
                            state_symbol_id,
                            call_node,
                            ctx,
                        )
                    });
            }
            let path = zustand_path_from_symbol_source(
                member.object(),
                state_symbol_id,
                call_node,
                ctx,
                &mut Vec::new(),
            )?;
            let is_array_mutator = matches!(
                method_name,
                "push"
                    | "pop"
                    | "shift"
                    | "unshift"
                    | "splice"
                    | "sort"
                    | "reverse"
                    | "fill"
                    | "copyWithin"
            ) && binding.array_paths.contains(&path);
            let is_collection_mutator = matches!(method_name, "add" | "clear" | "delete" | "set")
                && binding.map_or_set_paths.contains(&path);
            (is_array_mutator || is_collection_mutator).then_some(ZustandMutationPath::Known(path))
        }

        fn zustand_mutation_path_from_symbol_source<'a>(
            expression: &Expression<'a>,
            source_symbol_id: SymbolId,
            target_node: &AstNode<'a>,
            ctx: &LintContext<'a>,
        ) -> Option<ZustandMutationPath> {
            if let Some(path) = zustand_path_from_symbol_source(
                expression,
                source_symbol_id,
                target_node,
                ctx,
                &mut Vec::new(),
            ) {
                return Some(ZustandMutationPath::Known(path));
            }
            zustand_expression_reaches_symbol_source(
                expression,
                source_symbol_id,
                target_node,
                ctx,
                &mut Vec::new(),
            )
            .then_some(ZustandMutationPath::Unknown)
        }

        fn zustand_expression_reaches_symbol_source<'a>(
            expression: &Expression<'a>,
            source_symbol_id: SymbolId,
            target_node: &AstNode<'a>,
            ctx: &LintContext<'a>,
            visited_symbol_ids: &mut Vec<SymbolId>,
        ) -> bool {
            let expression = expression.get_inner_expression();
            if let Some(member) = expression.as_member_expression() {
                return zustand_expression_reaches_symbol_source(
                    member.object(),
                    source_symbol_id,
                    target_node,
                    ctx,
                    visited_symbol_ids,
                );
            }
            match expression {
                Expression::Identifier(identifier) => {
                    let Some(symbol_id) = ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                    else {
                        return false;
                    };
                    if symbol_id == source_symbol_id {
                        return true;
                    }
                    if visited_symbol_ids.contains(&symbol_id) {
                        return false;
                    }
                    visited_symbol_ids.push(symbol_id);
                    if let Some(rebinding) =
                        latest_dominating_rebinding(symbol_id, target_node, ctx)
                    {
                        return zustand_expression_reaches_symbol_source(
                            rebinding,
                            source_symbol_id,
                            target_node,
                            ctx,
                            visited_symbol_ids,
                        );
                    }
                    let declaration = ctx.symbol_declaration(symbol_id);
                    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                        return false;
                    };
                    declarator.init.as_ref().is_some_and(|initializer| {
                        zustand_expression_reaches_symbol_source(
                            initializer,
                            source_symbol_id,
                            declaration,
                            ctx,
                            visited_symbol_ids,
                        )
                    })
                }
                _ => false,
            }
        }

        fn zustand_path_from_symbol_source<'a>(
            expression: &Expression<'a>,
            source_symbol_id: SymbolId,
            target_node: &AstNode<'a>,
            ctx: &LintContext<'a>,
            visited_symbol_ids: &mut Vec<SymbolId>,
        ) -> Option<Vec<String>> {
            match expression.get_inner_expression() {
                Expression::Identifier(identifier) => {
                    let symbol_id = ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()?;
                    if symbol_id == source_symbol_id {
                        return Some(Vec::new());
                    }
                    if visited_symbol_ids.contains(&symbol_id) {
                        return None;
                    }
                    visited_symbol_ids.push(symbol_id);
                    if let Some(rebinding) =
                        latest_dominating_rebinding(symbol_id, target_node, ctx)
                    {
                        return zustand_path_from_symbol_source(
                            rebinding,
                            source_symbol_id,
                            target_node,
                            ctx,
                            visited_symbol_ids,
                        );
                    }
                    let declaration = ctx.symbol_declaration(symbol_id);
                    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                        return None;
                    };
                    if let Some(binding_path) =
                        zustand_destructured_binding_path(&declarator.id, symbol_id)
                    {
                        let mut path = zustand_path_from_symbol_source(
                            declarator.init.as_ref()?,
                            source_symbol_id,
                            declaration,
                            ctx,
                            visited_symbol_ids,
                        )?;
                        path.extend(binding_path);
                        return Some(path);
                    }
                    zustand_path_from_symbol_source(
                        declarator.init.as_ref()?,
                        source_symbol_id,
                        declaration,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                expression if expression.as_member_expression().is_some() => {
                    let member = expression.as_member_expression()?;
                    let property_name = member.static_property_name()?.to_string();
                    let mut path = zustand_path_from_symbol_source(
                        member.object(),
                        source_symbol_id,
                        target_node,
                        ctx,
                        visited_symbol_ids,
                    )?;
                    path.push(property_name);
                    Some(path)
                }
                Expression::CallExpression(call) => {
                    if zustand_call_targets_symbol(call, source_symbol_id, ctx)
                        || zustand_store_method_symbol(call, "getState", ctx)
                            == Some(source_symbol_id)
                    {
                        Some(Vec::new())
                    } else {
                        None
                    }
                }
                _ => None,
            }
        }

        fn zustand_destructured_binding_path(
            pattern: &BindingPattern<'_>,
            symbol_id: SymbolId,
        ) -> Option<Vec<String>> {
            match pattern {
                BindingPattern::ObjectPattern(object) => {
                    object.properties.iter().find_map(|property| {
                        let mut path =
                            zustand_destructured_binding_path(&property.value, symbol_id)?;
                        path.insert(0, property.key.static_name()?.to_string());
                        Some(path)
                    })
                }
                BindingPattern::AssignmentPattern(assignment) => {
                    zustand_destructured_binding_path(&assignment.left, symbol_id)
                }
                BindingPattern::BindingIdentifier(identifier)
                    if identifier.symbol_id() == symbol_id =>
                {
                    Some(Vec::new())
                }
                _ => None,
            }
        }

        fn zustand_return_disposition<'a>(
            returned_expressions: &[&Expression<'a>],
            mutation_path: &[String],
            mutation_node: &AstNode<'_>,
            state_symbol_id: SymbolId,
            binding: &ZustandBinding,
            ctx: &LintContext<'a>,
        ) -> ReplacementDisposition {
            if returned_expressions.is_empty() {
                return ReplacementDisposition::Reused;
            }
            let mut disposition = ReplacementDisposition::Reused;
            for expression in returned_expressions {
                let next_disposition = if zustand_binding_snapshot_path(expression, binding, ctx)
                    .is_some_and(|snapshot_path| {
                        zustand_path_preserves_target(&snapshot_path, mutation_path)
                    }) {
                    ReplacementDisposition::Reused
                } else {
                    zustand_update_expression_disposition(
                        expression,
                        mutation_path,
                        mutation_node,
                        state_symbol_id,
                        ctx,
                    )
                };
                if next_disposition == ReplacementDisposition::Fresh {
                    return ReplacementDisposition::Fresh;
                }
                if next_disposition == ReplacementDisposition::Unknown {
                    disposition = ReplacementDisposition::Unknown;
                }
            }
            disposition
        }

        fn zustand_binding_snapshot_path<'a>(
            expression: &Expression<'a>,
            binding: &ZustandBinding,
            ctx: &LintContext<'a>,
        ) -> Option<Vec<String>> {
            let expression = expression.get_inner_expression();
            if let Some(member) = expression.as_member_expression() {
                let mut path = zustand_binding_snapshot_path(member.object(), binding, ctx)?;
                path.push(member.static_property_name()?.to_string());
                return Some(path);
            }
            let Expression::CallExpression(call) = expression else {
                return None;
            };
            (binding
                .get_symbol_id
                .is_some_and(|symbol_id| zustand_call_targets_symbol(call, symbol_id, ctx))
                || zustand_store_method_symbol(call, "getState", ctx)
                    .is_some_and(|symbol_id| binding.store_symbol_ids.contains(&symbol_id)))
            .then(Vec::new)
        }

        fn zustand_path_preserves_target(
            candidate_path: &[String],
            target_path: &[String],
        ) -> bool {
            candidate_path.len() <= target_path.len()
                && candidate_path
                    .iter()
                    .zip(target_path)
                    .all(|(candidate, target)| candidate == target)
        }

        fn zustand_expression_is_no_update(
            expression: &Expression<'_>,
            ctx: &LintContext<'_>,
        ) -> bool {
            match expression.get_inner_expression() {
                Expression::UnaryExpression(unary) => {
                    unary.operator == oxc_syntax::operator::UnaryOperator::Void
                }
                Expression::Identifier(identifier) => {
                    identifier.name == "undefined" && zustand_identifier_is_global(identifier, ctx)
                }
                _ => false,
            }
        }

        fn zustand_update_expression_disposition<'a>(
            expression: &Expression<'a>,
            mutation_path: &[String],
            mutation_node: &AstNode<'_>,
            source_symbol_id: SymbolId,
            ctx: &LintContext<'a>,
        ) -> ReplacementDisposition {
            let expression = expression.get_inner_expression();
            if expression.span() == mutation_node.span() {
                return ReplacementDisposition::Reused;
            }
            if let Expression::SequenceExpression(sequence) = expression {
                return sequence.expressions.last().map_or(
                    ReplacementDisposition::Unknown,
                    |last| {
                        zustand_update_expression_disposition(
                            last,
                            mutation_path,
                            mutation_node,
                            source_symbol_id,
                            ctx,
                        )
                    },
                );
            }
            if zustand_expression_is_no_update(expression, ctx) {
                return ReplacementDisposition::Reused;
            }
            if zustand_path_from_symbol_source(
                expression,
                source_symbol_id,
                ctx.nodes().get_node(expression.node_id()),
                ctx,
                &mut Vec::new(),
            )
            .is_some_and(|candidate_path| {
                zustand_path_preserves_target(&candidate_path, mutation_path)
            }) {
                return ReplacementDisposition::Reused;
            }
            if zustand_rebinding_is_fresh(expression, ctx) {
                return ReplacementDisposition::Fresh;
            }
            let Expression::ObjectExpression(object) = expression else {
                return if zustand_expression_is_fresh(expression, ctx) {
                    ReplacementDisposition::Fresh
                } else {
                    ReplacementDisposition::Unknown
                };
            };
            zustand_object_update_disposition(
                object,
                mutation_path,
                0,
                true,
                source_symbol_id,
                mutation_node,
                ctx,
            )
        }

        fn zustand_object_update_disposition<'a>(
            object: &oxc_ast::ast::ObjectExpression<'a>,
            mutation_path: &[String],
            path_offset: usize,
            is_partial_update_root: bool,
            source_symbol_id: SymbolId,
            mutation_node: &AstNode<'_>,
            ctx: &LintContext<'a>,
        ) -> ReplacementDisposition {
            let Some(property_name) = mutation_path.get(path_offset) else {
                return ReplacementDisposition::Fresh;
            };
            let mut disposition = if is_partial_update_root {
                ReplacementDisposition::Reused
            } else {
                ReplacementDisposition::Fresh
            };
            for property in &object.properties {
                match property {
                    oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread) => {
                        disposition = zustand_path_from_symbol_source(
                            &spread.argument,
                            source_symbol_id,
                            ctx.nodes().get_node(spread.argument.node_id()),
                            ctx,
                            &mut Vec::new(),
                        )
                        .filter(|candidate_path| {
                            zustand_path_preserves_target(
                                candidate_path,
                                &mutation_path[..path_offset],
                            )
                        })
                        .map_or(ReplacementDisposition::Unknown, |_| {
                            ReplacementDisposition::Reused
                        });
                    }
                    oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property)
                        if property.key.static_name().as_deref() == Some(property_name) =>
                    {
                        let value = match property.value.get_inner_expression() {
                            Expression::SequenceExpression(sequence) => {
                                sequence.expressions.last().unwrap_or(&property.value)
                            }
                            _ => &property.value,
                        };
                        disposition = if path_offset + 1 == mutation_path.len() {
                            if zustand_path_from_symbol_source(
                                value,
                                source_symbol_id,
                                ctx.nodes().get_node(value.node_id()),
                                ctx,
                                &mut Vec::new(),
                            )
                            .is_some_and(|candidate_path| {
                                zustand_path_preserves_target(&candidate_path, mutation_path)
                            }) {
                                ReplacementDisposition::Reused
                            } else if zustand_expression_is_fresh(value, ctx)
                                || zustand_rebinding_is_fresh(value, ctx)
                            {
                                ReplacementDisposition::Fresh
                            } else {
                                ReplacementDisposition::Unknown
                            }
                        } else if let Expression::ObjectExpression(nested) =
                            value.get_inner_expression()
                        {
                            zustand_object_update_disposition(
                                nested,
                                mutation_path,
                                path_offset + 1,
                                false,
                                source_symbol_id,
                                mutation_node,
                                ctx,
                            )
                        } else if zustand_path_from_symbol_source(
                            value,
                            source_symbol_id,
                            ctx.nodes().get_node(value.node_id()),
                            ctx,
                            &mut Vec::new(),
                        )
                        .is_some_and(|candidate_path| {
                            zustand_path_preserves_target(&candidate_path, mutation_path)
                        }) {
                            ReplacementDisposition::Reused
                        } else if zustand_expression_is_fresh(value, ctx) {
                            ReplacementDisposition::Fresh
                        } else {
                            ReplacementDisposition::Unknown
                        };
                    }
                    _ => {}
                }
            }
            disposition
        }

        fn zustand_expression_is_fresh(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
            match expression.get_inner_expression() {
                Expression::ObjectExpression(_)
                | Expression::ArrayExpression(_)
                | Expression::NewExpression(_)
                | Expression::BooleanLiteral(_)
                | Expression::NullLiteral(_)
                | Expression::NumericLiteral(_)
                | Expression::BigIntLiteral(_)
                | Expression::StringLiteral(_)
                | Expression::TemplateLiteral(_) => true,
                Expression::Identifier(identifier) => {
                    let Some(symbol_id) = ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                    else {
                        return false;
                    };
                    let declaration = ctx.symbol_declaration(symbol_id);
                    matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
                        if matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                            && declarator.init.as_ref().is_some_and(|initializer| zustand_expression_is_fresh(initializer, ctx)))
                }
                Expression::CallExpression(call) => call
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .and_then(|member| member.static_property_name())
                    .is_some_and(|method_name| {
                        matches!(
                            method_name,
                            "concat"
                                | "filter"
                                | "flat"
                                | "flatMap"
                                | "map"
                                | "slice"
                                | "toReversed"
                                | "toSorted"
                                | "toSpliced"
                                | "with"
                        )
                    }),
                _ => false,
            }
        }

        fn zustand_rebinding_is_fresh(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
            let Expression::Identifier(identifier) = expression.get_inner_expression() else {
                return false;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            let target_node = ctx.nodes().get_node(expression.node_id());
            latest_dominating_rebinding(symbol_id, target_node, ctx)
                .is_some_and(|rebinding| zustand_expression_is_fresh(rebinding, ctx))
        }

        fn zustand_analyze_snapshot_mutations(
            binding: &ZustandBinding,
            ctx: &LintContext<'_>,
            reported_spans: &mut FxHashSet<oxc_span::Span>,
        ) {
            let has_bound_store_notifier = ctx.nodes().iter().any(|node| {
                let AstKind::CallExpression(call) = node.kind() else {
                    return false;
                };
                zustand_store_method_symbol(call, "setState", ctx)
                    .is_some_and(|symbol_id| binding.store_symbol_ids.contains(&symbol_id))
            });
            let get_is_reactive = binding.get_symbol_id.is_some_and(|_| {
                binding.set_symbol_id.is_some_and(|set_symbol_id| {
                    ctx.scoping()
                        .get_resolved_references(set_symbol_id)
                        .next()
                        .is_some()
                }) || has_bound_store_notifier
            });
            for node in ctx.nodes().iter() {
                let Some((mutation_path, source_symbol_id)) =
                    zustand_snapshot_mutation(node, binding, get_is_reactive, ctx)
                else {
                    continue;
                };
                let owner_function_id = local_callback_nearest_function_id(node.id(), ctx);
                if owner_function_id.is_some_and(|function_id| {
                    zustand_function_has_unsupported_snapshot_flow(function_id, ctx)
                }) {
                    continue;
                }
                let disposition = zustand_following_notifier_disposition(
                    node,
                    &mutation_path,
                    source_symbol_id,
                    binding,
                    ctx,
                );
                if disposition == ReplacementDisposition::Reused
                    && reported_spans.insert(node.span())
                {
                    ctx.diagnostic(OxcDiagnostic::error(ZUSTAND_MESSAGE).with_label(node.span()));
                }
            }
        }

        fn zustand_snapshot_mutation<'a>(
            node: &AstNode<'a>,
            binding: &ZustandBinding,
            get_is_reactive: bool,
            ctx: &LintContext<'a>,
        ) -> Option<(ZustandMutationPath, SymbolId)> {
            let expression = match node.kind() {
                AstKind::AssignmentExpression(assignment) => {
                    assignment.left.as_member_expression()?.object()
                }
                AstKind::UpdateExpression(update) => {
                    update.argument.as_member_expression()?.object()
                }
                AstKind::UnaryExpression(unary)
                    if unary.operator == oxc_syntax::operator::UnaryOperator::Delete =>
                {
                    unary
                        .argument
                        .get_inner_expression()
                        .as_member_expression()?
                        .object()
                }
                AstKind::CallExpression(call) => call
                    .callee
                    .get_inner_expression()
                    .as_member_expression()?
                    .object(),
                _ => return None,
            };
            let (mutation_path, source_symbol_id) = if let Some((path, source_symbol_id)) =
                zustand_snapshot_path(expression, binding, get_is_reactive, node, ctx)
            {
                (ZustandMutationPath::Known(path), source_symbol_id)
            } else {
                (
                    ZustandMutationPath::Unknown,
                    zustand_snapshot_source_symbol(
                        expression,
                        binding,
                        get_is_reactive,
                        node,
                        ctx,
                        &mut Vec::new(),
                    )?,
                )
            };
            if let AstKind::CallExpression(call) = node.kind() {
                let method_name = call
                    .callee
                    .get_inner_expression()
                    .as_member_expression()?
                    .static_property_name()?;
                let is_array_mutator = matches!(
                    method_name,
                    "push"
                        | "pop"
                        | "shift"
                        | "unshift"
                        | "splice"
                        | "sort"
                        | "reverse"
                        | "fill"
                        | "copyWithin"
                ) && matches!(&mutation_path, ZustandMutationPath::Known(path) if binding.array_paths.contains(path));
                let is_collection_mutator = matches!(
                    method_name,
                    "add" | "clear" | "delete" | "set"
                ) && matches!(&mutation_path, ZustandMutationPath::Known(path) if binding.map_or_set_paths.contains(path));
                if !is_array_mutator && !is_collection_mutator {
                    return None;
                }
            }
            Some((mutation_path, source_symbol_id))
        }

        fn zustand_snapshot_source_symbol<'a>(
            expression: &Expression<'a>,
            binding: &ZustandBinding,
            get_is_reactive: bool,
            target_node: &AstNode<'a>,
            ctx: &LintContext<'a>,
            visited_symbol_ids: &mut Vec<SymbolId>,
        ) -> Option<SymbolId> {
            let expression = expression.get_inner_expression();
            if let Some(member) = expression.as_member_expression() {
                return zustand_snapshot_source_symbol(
                    member.object(),
                    binding,
                    get_is_reactive,
                    target_node,
                    ctx,
                    visited_symbol_ids,
                );
            }
            if let Expression::CallExpression(call) = expression {
                if get_is_reactive
                    && binding
                        .get_symbol_id
                        .is_some_and(|symbol_id| zustand_call_targets_symbol(call, symbol_id, ctx))
                {
                    return binding.get_symbol_id;
                }
                let store_symbol_id = zustand_store_method_symbol(call, "getState", ctx)?;
                return binding
                    .store_symbol_ids
                    .contains(&store_symbol_id)
                    .then_some(store_symbol_id);
            }
            let Expression::Identifier(identifier) = expression else {
                return None;
            };
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            if let Some(rebinding) = latest_dominating_rebinding(symbol_id, target_node, ctx) {
                return zustand_snapshot_source_symbol(
                    rebinding,
                    binding,
                    get_is_reactive,
                    target_node,
                    ctx,
                    visited_symbol_ids,
                );
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            zustand_snapshot_source_symbol(
                declarator.init.as_ref()?,
                binding,
                get_is_reactive,
                declaration,
                ctx,
                visited_symbol_ids,
            )
        }

        fn zustand_snapshot_path<'a>(
            expression: &Expression<'a>,
            binding: &ZustandBinding,
            get_is_reactive: bool,
            target_node: &AstNode<'a>,
            ctx: &LintContext<'a>,
        ) -> Option<(Vec<String>, SymbolId)> {
            let expression = expression.get_inner_expression();
            if let Some(member) = expression.as_member_expression() {
                let property_name = member.static_property_name()?.to_string();
                let (mut path, source_symbol_id) = zustand_snapshot_path(
                    member.object(),
                    binding,
                    get_is_reactive,
                    target_node,
                    ctx,
                )?;
                path.push(property_name);
                return Some((path, source_symbol_id));
            }
            if let Expression::CallExpression(call) = expression {
                if get_is_reactive
                    && binding
                        .get_symbol_id
                        .is_some_and(|symbol_id| zustand_call_targets_symbol(call, symbol_id, ctx))
                {
                    return Some((Vec::new(), binding.get_symbol_id?));
                }
                let store_symbol_id = zustand_store_method_symbol(call, "getState", ctx)?;
                return binding
                    .store_symbol_ids
                    .contains(&store_symbol_id)
                    .then_some((Vec::new(), store_symbol_id));
            }
            let Expression::Identifier(identifier) = expression else {
                return None;
            };
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if let Some(rebinding) = latest_dominating_rebinding(symbol_id, target_node, ctx) {
                return zustand_snapshot_path(
                    rebinding,
                    binding,
                    get_is_reactive,
                    target_node,
                    ctx,
                );
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let (mut path, source_symbol_id) = zustand_snapshot_path(
                declarator.init.as_ref()?,
                binding,
                get_is_reactive,
                declaration,
                ctx,
            )?;
            if let Some(binding_path) = zustand_destructured_binding_path(&declarator.id, symbol_id)
            {
                path.extend(binding_path);
            }
            Some((path, source_symbol_id))
        }

        fn zustand_following_notifier_disposition(
            mutation_node: &AstNode<'_>,
            mutation_path: &ZustandMutationPath,
            source_symbol_id: SymbolId,
            binding: &ZustandBinding,
            ctx: &LintContext<'_>,
        ) -> ReplacementDisposition {
            let owner_function_id = local_callback_nearest_function_id(mutation_node.id(), ctx);
            let updater_function_id = owner_function_id.filter(|function_id| {
                zustand_function_is_matching_notifier_updater(
                    *function_id,
                    source_symbol_id,
                    binding,
                    ctx,
                )
            });
            let mut found_notifier = updater_function_id.is_some();
            let mut disposition = ReplacementDisposition::Reused;
            if let Some(updater_function_id) = updater_function_id {
                let updater_disposition = zustand_notifier_return_disposition(
                    &zustand_returned_expressions(updater_function_id, ctx),
                    mutation_path,
                    mutation_node,
                    source_symbol_id,
                    binding,
                    ctx,
                );
                if updater_disposition == ReplacementDisposition::Fresh {
                    return ReplacementDisposition::Fresh;
                }
                if updater_disposition == ReplacementDisposition::Unknown {
                    disposition = ReplacementDisposition::Unknown;
                }
            }
            for candidate in ctx.nodes().iter() {
                let AstKind::CallExpression(call) = candidate.kind() else {
                    continue;
                };
                if local_callback_nearest_function_id(candidate.id(), ctx) != owner_function_id
                    || candidate.span().start < mutation_node.span().start
                        && !candidate.span().contains_inclusive(mutation_node.span())
                    || are_nodes_in_mutually_exclusive_branches(mutation_node, candidate, ctx)
                    || zustand_node_has_future_conditional_ancestor(
                        candidate,
                        mutation_node,
                        owner_function_id,
                        ctx,
                    )
                {
                    continue;
                }
                if !zustand_call_is_matching_notifier(call, source_symbol_id, binding, ctx) {
                    continue;
                }
                found_notifier = true;
                let next = zustand_notifier_call_disposition(
                    call,
                    mutation_path,
                    mutation_node,
                    source_symbol_id,
                    binding,
                    ctx,
                );
                if next == ReplacementDisposition::Fresh {
                    return ReplacementDisposition::Fresh;
                }
                if next == ReplacementDisposition::Unknown {
                    disposition = ReplacementDisposition::Unknown;
                }
            }
            for candidate in ctx.nodes().iter() {
                let AstKind::IfStatement(statement) = candidate.kind() else {
                    continue;
                };
                if local_callback_nearest_function_id(candidate.id(), ctx) != owner_function_id
                    || candidate.span().start <= mutation_node.span().start
                    || zustand_node_has_future_conditional_ancestor(
                        candidate,
                        mutation_node,
                        owner_function_id,
                        ctx,
                    )
                {
                    continue;
                }
                let (has_notifier, next) = zustand_notifier_if_flow_disposition(
                    statement,
                    mutation_path,
                    mutation_node,
                    source_symbol_id,
                    binding,
                    owner_function_id,
                    ctx,
                );
                if !has_notifier {
                    continue;
                }
                found_notifier = true;
                if next == ReplacementDisposition::Fresh {
                    return ReplacementDisposition::Fresh;
                }
                if next == ReplacementDisposition::Unknown {
                    disposition = ReplacementDisposition::Unknown;
                }
            }
            if found_notifier {
                disposition
            } else {
                ReplacementDisposition::Reused
            }
        }

        fn zustand_call_is_matching_notifier<'a>(
            call: &oxc_ast::ast::CallExpression<'a>,
            source_symbol_id: SymbolId,
            binding: &ZustandBinding,
            ctx: &LintContext<'a>,
        ) -> bool {
            binding
                .set_symbol_id
                .is_some_and(|symbol_id| zustand_call_targets_symbol(call, symbol_id, ctx))
                && binding.get_symbol_id == Some(source_symbol_id)
                || zustand_store_method_symbol(call, "setState", ctx).is_some_and(
                    |store_symbol_id| {
                        store_symbol_id == source_symbol_id
                            || binding.get_symbol_id == Some(source_symbol_id)
                                && binding.store_symbol_ids.contains(&store_symbol_id)
                    },
                )
        }

        fn zustand_notifier_call_disposition<'a>(
            call: &oxc_ast::ast::CallExpression<'a>,
            mutation_path: &ZustandMutationPath,
            mutation_node: &AstNode<'_>,
            source_symbol_id: SymbolId,
            binding: &ZustandBinding,
            ctx: &LintContext<'a>,
        ) -> ReplacementDisposition {
            let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
                return ReplacementDisposition::Reused;
            };
            if let Some(function_id) =
                exact_local_callback_function_id(argument, ctx, &mut Vec::new())
            {
                return zustand_notifier_return_disposition(
                    &zustand_returned_expressions(function_id, ctx),
                    mutation_path,
                    mutation_node,
                    source_symbol_id,
                    binding,
                    ctx,
                );
            }
            match mutation_path {
                ZustandMutationPath::Known(mutation_path) => zustand_update_expression_disposition(
                    argument,
                    mutation_path,
                    mutation_node,
                    source_symbol_id,
                    ctx,
                ),
                ZustandMutationPath::Unknown => ReplacementDisposition::Unknown,
            }
        }

        fn zustand_notifier_return_disposition<'a>(
            returned_expressions: &[&Expression<'a>],
            mutation_path: &ZustandMutationPath,
            mutation_node: &AstNode<'_>,
            source_symbol_id: SymbolId,
            binding: &ZustandBinding,
            ctx: &LintContext<'a>,
        ) -> ReplacementDisposition {
            match mutation_path {
                ZustandMutationPath::Known(mutation_path) => zustand_return_disposition(
                    returned_expressions,
                    mutation_path,
                    mutation_node,
                    source_symbol_id,
                    binding,
                    ctx,
                ),
                ZustandMutationPath::Unknown if returned_expressions.is_empty() => {
                    ReplacementDisposition::Reused
                }
                ZustandMutationPath::Unknown => ReplacementDisposition::Unknown,
            }
        }

        fn zustand_node_has_future_conditional_ancestor(
            node: &AstNode<'_>,
            mutation_node: &AstNode<'_>,
            owner_function_id: Option<NodeId>,
            ctx: &LintContext<'_>,
        ) -> bool {
            let mut current = node;
            loop {
                let parent = ctx.nodes().parent_node(current.id());
                if Some(parent.id()) == owner_function_id
                    || matches!(parent.kind(), AstKind::Program(_))
                {
                    return false;
                }
                if matches!(parent.kind(), AstKind::IfStatement(_))
                    && parent.span().start > mutation_node.span().start
                {
                    return true;
                }
                current = parent;
            }
        }

        fn zustand_notifier_if_flow_disposition(
            statement: &oxc_ast::ast::IfStatement<'_>,
            mutation_path: &ZustandMutationPath,
            mutation_node: &AstNode<'_>,
            source_symbol_id: SymbolId,
            binding: &ZustandBinding,
            owner_function_id: Option<NodeId>,
            ctx: &LintContext<'_>,
        ) -> (bool, ReplacementDisposition) {
            let (consequent_has_notifier, consequent_disposition) =
                zustand_notifier_branch_flow_disposition(
                    &statement.consequent,
                    mutation_path,
                    mutation_node,
                    source_symbol_id,
                    binding,
                    owner_function_id,
                    ctx,
                );
            let (alternate_has_notifier, alternate_disposition) = statement
                .alternate
                .as_ref()
                .map_or((false, ReplacementDisposition::Reused), |alternate| {
                    zustand_notifier_branch_flow_disposition(
                        alternate,
                        mutation_path,
                        mutation_node,
                        source_symbol_id,
                        binding,
                        owner_function_id,
                        ctx,
                    )
                });
            let has_notifier = consequent_has_notifier || alternate_has_notifier;
            if !has_notifier
                || consequent_disposition == ReplacementDisposition::Reused
                || alternate_disposition == ReplacementDisposition::Reused
            {
                return (has_notifier, ReplacementDisposition::Reused);
            }
            if consequent_disposition == ReplacementDisposition::Fresh
                && alternate_disposition == ReplacementDisposition::Fresh
            {
                return (true, ReplacementDisposition::Fresh);
            }
            (true, ReplacementDisposition::Unknown)
        }

        fn zustand_notifier_branch_flow_disposition(
            statement: &oxc_ast::ast::Statement<'_>,
            mutation_path: &ZustandMutationPath,
            mutation_node: &AstNode<'_>,
            source_symbol_id: SymbolId,
            binding: &ZustandBinding,
            owner_function_id: Option<NodeId>,
            ctx: &LintContext<'_>,
        ) -> (bool, ReplacementDisposition) {
            if let oxc_ast::ast::Statement::IfStatement(if_statement) = statement {
                return zustand_notifier_if_flow_disposition(
                    if_statement,
                    mutation_path,
                    mutation_node,
                    source_symbol_id,
                    binding,
                    owner_function_id,
                    ctx,
                );
            }
            if let oxc_ast::ast::Statement::BlockStatement(block) = statement {
                let mut has_notifier = false;
                let mut disposition = ReplacementDisposition::Reused;
                for child in &block.body {
                    let (child_has_notifier, child_disposition) =
                        zustand_notifier_branch_flow_disposition(
                            child,
                            mutation_path,
                            mutation_node,
                            source_symbol_id,
                            binding,
                            owner_function_id,
                            ctx,
                        );
                    has_notifier |= child_has_notifier;
                    disposition =
                        zustand_sequential_notifier_disposition(disposition, child_disposition);
                }
                return (has_notifier, disposition);
            }
            let mut has_notifier = false;
            let mut disposition = ReplacementDisposition::Reused;
            for candidate in ctx.nodes().iter() {
                if !statement.span().contains_inclusive(candidate.span())
                    || local_callback_nearest_function_id(candidate.id(), ctx) != owner_function_id
                {
                    continue;
                }
                let AstKind::CallExpression(call) = candidate.kind() else {
                    continue;
                };
                if !zustand_call_is_matching_notifier(call, source_symbol_id, binding, ctx) {
                    continue;
                }
                has_notifier = true;
                disposition = zustand_sequential_notifier_disposition(
                    disposition,
                    zustand_notifier_call_disposition(
                        call,
                        mutation_path,
                        mutation_node,
                        source_symbol_id,
                        binding,
                        ctx,
                    ),
                );
            }
            (has_notifier, disposition)
        }

        fn zustand_sequential_notifier_disposition(
            previous: ReplacementDisposition,
            next: ReplacementDisposition,
        ) -> ReplacementDisposition {
            if previous == ReplacementDisposition::Fresh || next == ReplacementDisposition::Fresh {
                return ReplacementDisposition::Fresh;
            }
            if previous == ReplacementDisposition::Unknown
                || next == ReplacementDisposition::Unknown
            {
                return ReplacementDisposition::Unknown;
            }
            ReplacementDisposition::Reused
        }

        fn zustand_function_is_matching_notifier_updater(
            function_id: NodeId,
            source_symbol_id: SymbolId,
            binding: &ZustandBinding,
            ctx: &LintContext<'_>,
        ) -> bool {
            ctx.nodes().iter().any(|node| {
                let AstKind::CallExpression(call) = node.kind() else {
                    return false;
                };
                let Some(argument) = call.arguments.first().and_then(Argument::as_expression)
                else {
                    return false;
                };
                if exact_local_callback_function_id(argument, ctx, &mut Vec::new())
                    != Some(function_id)
                {
                    return false;
                }
                let is_matching_set = binding
                    .set_symbol_id
                    .is_some_and(|symbol_id| zustand_call_targets_symbol(call, symbol_id, ctx))
                    && binding.get_symbol_id == Some(source_symbol_id);
                let is_matching_store = zustand_store_method_symbol(call, "setState", ctx)
                    .is_some_and(|store_symbol_id| {
                        store_symbol_id == source_symbol_id
                            || binding.get_symbol_id == Some(source_symbol_id)
                                && binding.store_symbol_ids.contains(&store_symbol_id)
                    });
                is_matching_set || is_matching_store
            })
        }

        fn zustand_function_has_unsupported_snapshot_flow(
            function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> bool {
            let statements = match ctx.nodes().get_node(function_id).kind() {
                AstKind::Function(function) => function.body.as_ref().map(|body| &body.statements),
                AstKind::ArrowFunctionExpression(function)
                    if function.get_expression().is_none() =>
                {
                    function.get_function_body().map(|body| &body.statements)
                }
                _ => None,
            };
            if statements.is_some_and(|statements| {
                statements.iter().any(|statement| {
                    zustand_snapshot_statement_has_unsupported_flow(statement, function_id, ctx)
                })
            }) {
                return true;
            }
            ctx.nodes().iter().any(|candidate| {
                local_callback_nearest_function_id(candidate.id(), ctx) == Some(function_id)
                    && matches!(
                        candidate.kind(),
                        AstKind::ConditionalExpression(_) | AstKind::LogicalExpression(_)
                    )
            })
        }

        fn zustand_snapshot_statement_has_unsupported_flow(
            statement: &oxc_ast::ast::Statement<'_>,
            function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> bool {
            let oxc_ast::ast::Statement::IfStatement(if_statement) = statement else {
                return matches!(
                    statement,
                    oxc_ast::ast::Statement::DoWhileStatement(_)
                        | oxc_ast::ast::Statement::ForInStatement(_)
                        | oxc_ast::ast::Statement::ForOfStatement(_)
                        | oxc_ast::ast::Statement::ForStatement(_)
                        | oxc_ast::ast::Statement::LabeledStatement(_)
                        | oxc_ast::ast::Statement::BlockStatement(_)
                        | oxc_ast::ast::Statement::SwitchStatement(_)
                        | oxc_ast::ast::Statement::TryStatement(_)
                        | oxc_ast::ast::Statement::WhileStatement(_)
                        | oxc_ast::ast::Statement::WithStatement(_)
                );
            };
            if ctx.nodes().iter().any(|candidate| {
                local_callback_nearest_function_id(candidate.id(), ctx) == Some(function_id)
                    && statement.span().contains_inclusive(candidate.span())
                    && matches!(
                        candidate.kind(),
                        AstKind::ReturnStatement(_) | AstKind::ThrowStatement(_)
                    )
            }) {
                return true;
            }
            zustand_snapshot_branch_has_unsupported_flow(&if_statement.consequent, function_id, ctx)
                || if_statement.alternate.as_ref().is_some_and(|alternate| {
                    zustand_snapshot_branch_has_unsupported_flow(alternate, function_id, ctx)
                })
        }

        fn zustand_snapshot_branch_has_unsupported_flow(
            branch: &oxc_ast::ast::Statement<'_>,
            function_id: NodeId,
            ctx: &LintContext<'_>,
        ) -> bool {
            if let oxc_ast::ast::Statement::BlockStatement(block) = branch {
                return block.body.iter().any(|statement| {
                    zustand_snapshot_statement_has_unsupported_flow(statement, function_id, ctx)
                });
            }
            zustand_snapshot_statement_has_unsupported_flow(branch, function_id, ctx)
        }

        fn zustand_call_targets_symbol<'a>(
            call: &oxc_ast::ast::CallExpression<'a>,
            symbol_id: SymbolId,
            ctx: &LintContext<'a>,
        ) -> bool {
            let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                return false;
            };
            resolve_const_identifier_root_symbol(identifier, ctx) == Some(symbol_id)
        }

        fn zustand_store_method_symbol<'a>(
            call: &oxc_ast::ast::CallExpression<'a>,
            method_name: &str,
            ctx: &LintContext<'a>,
        ) -> Option<SymbolId> {
            let member = call.callee.get_inner_expression().as_member_expression()?;
            if member.static_property_name().as_deref() != Some(method_name) {
                return None;
            }
            let Expression::Identifier(identifier) = member.object().get_inner_expression() else {
                return None;
            };
            resolve_const_identifier_root_symbol(identifier, ctx)
        }

        fn zustand_identifier_is_global(
            identifier: &oxc_ast::ast::IdentifierReference<'_>,
            ctx: &LintContext<'_>,
        ) -> bool {
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_none()
        }
    }

    pub use zustand_rule::ZustandNoMutatingState;
}

pub use implementation::ZustandNoMutatingState;
