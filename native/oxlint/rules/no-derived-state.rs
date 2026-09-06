mod implementation {
    include!("no_derived_state_effect.rs");

    use std::{
        hash::{Hash, Hasher},
        path::{Path, PathBuf},
        sync::{Mutex, OnceLock},
    };

    use oxc_allocator::Allocator;
    use oxc_ast::ast::{ExportDefaultDeclarationKind, Statement};
    use oxc_parser::Parser;
    use oxc_resolver::{ResolveOptions, Resolver, TsconfigDiscovery};
    use oxc_semantic::{Semantic, SemanticBuilder};
    use oxc_span::SourceType;
    use rustc_hash::{FxHashMap, FxHashSet};

    use crate::module_record::{
        ExportExportName, ExportImportName, ImportImportName, ModuleRecord,
    };

    const NO_DERIVED_MAX_IMPORTED_HELPER_DEPTH: usize = 4;
    const NO_DERIVED_DEFERRING_CALLEE_NAMES: [&str; 17] = [
        "setTimeout",
        "setInterval",
        "setImmediate",
        "requestAnimationFrame",
        "requestIdleCallback",
        "queueMicrotask",
        "addEventListener",
        "addListener",
        "subscribe",
        "observe",
        "watch",
        "watchPosition",
        "then",
        "catch",
        "finally",
        "on",
        "once",
    ];
    type NoDerivedHelperCacheKey = (PathBuf, String, u64);
    static NO_DERIVED_HELPER_SUMMARY_CACHE: OnceLock<
        Mutex<FxHashMap<NoDerivedHelperCacheKey, FxHashSet<usize>>>,
    > = OnceLock::new();

    mod no_derived_state_lint {
        use super::*;

        #[derive(Debug, Default, Clone)]
        pub struct NoDerivedState;

        declare_oxc_lint!(
            /// Warns when a render-known value is copied into state.
            NoDerivedState,
            react_doctor_native,
            correctness,
            version = "0.1.0",
            short_description = "Warns when a render-known value is copied into state.",
        );

        impl Rule for NoDerivedState {
            fn should_run(&self, ctx: &ContextHost) -> bool {
                NoDerivedStateEffect.should_run(ctx)
            }

            fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
                match node.kind() {
                    AstKind::CallExpression(effect_call)
                        if is_react_hook_call(effect_call, &["useEffect"], ctx) =>
                    {
                        no_derived_check_effect(node, effect_call, ctx);
                    }
                    AstKind::FunctionBody(body) => {
                        no_derived_check_render_body(node, &body.statements, ctx);
                    }
                    _ => {}
                }
            }
        }
    }

    pub use no_derived_state_lint::NoDerivedState;

    fn no_derived_check_effect<'a>(
        node: &AstNode<'a>,
        effect_call: &'a oxc_ast::ast::CallExpression<'a>,
        ctx: &LintContext<'a>,
    ) {
        let Some(component_id) = derived_nearest_function_id(node.id(), ctx) else {
            return;
        };
        let Some(callback_expression) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let Some(execution_callback_expression) =
            derived_state_effect_unwrapped_callback_expression(
                callback_expression,
                ctx,
                &mut Vec::new(),
            )
        else {
            return;
        };
        let Some(callback_id) =
            exact_local_callback_function_id(execution_callback_expression, ctx, &mut Vec::new())
        else {
            return;
        };
        if derived_function_is_async_or_generator(callback_id, ctx) {
            return;
        }

        let mut execution_node_ids = Vec::new();
        for_each_local_callback_execution_node(
            execution_callback_expression,
            ctx,
            |candidate, _, _| {
                if matches!(candidate.kind(), AstKind::CallExpression(_)) {
                    execution_node_ids.push(candidate.id());
                }
            },
        );
        derived_state_effect_expand_synchronous_iterator_execution_nodes(
            &mut execution_node_ids,
            ctx,
        );
        let execution_node_id_set = execution_node_ids.iter().copied().collect::<FxHashSet<_>>();
        let effect_has_cleanup = derived_state_effect_has_cleanup(callback_id, ctx);
        for candidate_id in execution_node_ids.iter().copied() {
            let candidate = ctx.nodes().get_node(candidate_id);
            if derived_enclosing_function_is_async_or_generator(candidate.id(), ctx) {
                continue;
            }
            let AstKind::CallExpression(setter_call) = candidate.kind() else {
                continue;
            };
            if setter_call.arguments.len() != 1 {
                continue;
            }
            let Expression::Identifier(setter_identifier) =
                setter_call.callee.get_inner_expression()
            else {
                continue;
            };
            let Some(state_pair) = no_derived_resolve_use_state_pair(setter_identifier, ctx) else {
                continue;
            };
            let has_independent_writer = derived_setter_has_independent_writer(
                state_pair.setter_symbol_id,
                effect_call.span,
                component_id,
                ctx,
            );
            let is_cleanup_managed = effect_has_cleanup
                && derived_state_effect_has_deferred_setter_writer(
                    state_pair.setter_symbol_id,
                    effect_call.span,
                    component_id,
                    &execution_node_id_set,
                    ctx,
                );
            let Some(written_value) = setter_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let value_contexts =
                derived_state_effect_setter_value_contexts(candidate, &execution_node_id_set, ctx);
            let diagnostic_count = value_contexts
                .iter()
                .filter(|value_context| {
                    let mut source_state_symbols = FxHashSet::default();
                    let is_render_known = derived_written_value_is_render_known(
                        written_value,
                        component_id,
                        state_pair
                            .state_symbol_id
                            .unwrap_or(state_pair.setter_symbol_id),
                        ctx,
                        &mut Vec::new(),
                        &mut source_state_symbols,
                        &value_context.substitutions,
                        1,
                    );
                    let resets_source_state = source_state_symbols.iter().any(|source_symbol_id| {
                        derived_effect_resets_source_state(
                            *source_symbol_id,
                            value_context.write_anchor,
                            &execution_node_ids,
                            ctx,
                        )
                    });
                    let is_render_known_copy = is_render_known
                        && !resets_source_state
                        && !has_independent_writer
                        && !is_cleanup_managed;
                    let is_selection_repair =
                        state_pair.state_symbol_id.is_some_and(|state_symbol_id| {
                            let selection_written_value = match written_value.get_inner_expression()
                            {
                                Expression::Identifier(identifier) => ctx
                                    .scoping()
                                    .get_reference(identifier.reference_id())
                                    .symbol_id()
                                    .and_then(|symbol_id| {
                                        value_context.substitutions.get(&symbol_id)
                                    })
                                    .copied()
                                    .unwrap_or(written_value),
                                _ => written_value,
                            };
                            derived_is_render_known_selection_repair(
                                selection_written_value,
                                state_symbol_id,
                                has_independent_writer,
                                candidate.id(),
                                callback_id,
                                effect_call,
                                component_id,
                                ctx,
                            ) || derived_is_render_known_selection_repair(
                                selection_written_value,
                                state_symbol_id,
                                has_independent_writer,
                                value_context.write_anchor.id(),
                                callback_id,
                                effect_call,
                                component_id,
                                ctx,
                            )
                        });
                    is_render_known_copy || is_selection_repair
                })
                .count();
            if diagnostic_count == 0 {
                continue;
            }
            for _ in 0..diagnostic_count {
                no_derived_report(setter_call.span, &state_pair.state_name, ctx);
            }
        }
    }

    struct NoDerivedStatePair {
        state_symbol_id: Option<SymbolId>,
        setter_symbol_id: SymbolId,
        state_name: String,
    }

    fn no_derived_resolve_use_state_pair<'a>(
        setter_identifier: &oxc_ast::ast::IdentifierReference<'a>,
        ctx: &LintContext<'a>,
    ) -> Option<NoDerivedStatePair> {
        let setter_symbol_id = resolve_const_identifier_root_symbol(setter_identifier, ctx)?;
        let setter_symbol_id = derived_use_state_pair_from_setter_symbol(setter_symbol_id, ctx)
            .map_or_else(
                || {
                    let resolved_symbol_id = ctx
                        .scoping()
                        .get_reference(setter_identifier.reference_id())
                        .symbol_id()?;
                    derived_upstream_use_state_pair(resolved_symbol_id, false, ctx, &mut Vec::new())
                        .map(|(_, upstream_setter_symbol_id)| upstream_setter_symbol_id)
                },
                |(_, direct_setter_symbol_id)| Some(direct_setter_symbol_id),
            )?;
        let declaration = ctx.symbol_declaration(setter_symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return None;
        };
        let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
            return None;
        };
        let BindingPattern::BindingIdentifier(setter_binding) =
            pattern.elements.get(1).and_then(Option::as_ref)?
        else {
            return None;
        };
        if setter_binding.symbol_id() != setter_symbol_id
            || !derived_expression_is_use_state_tuple(
                declarator.init.as_ref()?,
                ctx,
                &mut Vec::new(),
            )
        {
            return None;
        }
        let state_binding = pattern
            .elements
            .first()
            .and_then(Option::as_ref)
            .and_then(|binding| match binding {
                BindingPattern::BindingIdentifier(identifier) => Some(identifier),
                _ => None,
            });
        let state_name = state_binding.map_or_else(
            || no_derived_state_name_from_setter(setter_binding.name.as_str()),
            |identifier| identifier.name.to_string(),
        );
        Some(NoDerivedStatePair {
            state_symbol_id: state_binding.map(|identifier| identifier.symbol_id()),
            setter_symbol_id,
            state_name,
        })
    }

    fn no_derived_state_name_from_setter(setter_name: &str) -> String {
        let Some(state_name) = setter_name.strip_prefix("set") else {
            return setter_name.to_string();
        };
        if state_name.is_empty() {
            return setter_name.to_string();
        }
        let mut characters = state_name.chars();
        let Some(first_character) = characters.next() else {
            return setter_name.to_string();
        };
        first_character
            .to_lowercase()
            .chain(characters)
            .collect::<String>()
    }

    fn no_derived_report(span: oxc_span::Span, state_name: &str, ctx: &LintContext<'_>) {
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Storing \"{state_name}\" in state when you can derive it from other values costs an extra render."
            ))
            .with_label(span),
        );
    }

    fn no_derived_check_render_body<'a>(
        body_node: &AstNode<'a>,
        statements: &'a [oxc_ast::ast::Statement<'a>],
        ctx: &LintContext<'a>,
    ) {
        let function_node = ctx.nodes().parent_node(body_node.id());
        if !no_derived_is_component_function(function_node, ctx) {
            return;
        }
        for statement in statements {
            let oxc_ast::ast::Statement::IfStatement(if_statement) = statement else {
                continue;
            };
            no_derived_check_render_guard(function_node, if_statement, ctx);
        }
    }

    fn no_derived_is_component_function<'a>(
        function_node: &AstNode<'a>,
        ctx: &LintContext<'a>,
    ) -> bool {
        match function_node.kind() {
            AstKind::Function(function)
                if function.r#type == oxc_ast::ast::FunctionType::FunctionDeclaration =>
            {
                function.id.as_ref().is_none_or(|identifier| {
                    identifier.name == "default"
                        || no_derived_is_uppercase_name(identifier.name.as_str())
                }) || matches!(
                    ctx.nodes().parent_node(function_node.id()).kind(),
                    AstKind::ExportDefaultDeclaration(_)
                )
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                let mut expression_root = transparent_expression_root(function_node, ctx);
                loop {
                    let parent = ctx.nodes().parent_node(expression_root.id());
                    if matches!(parent.kind(), AstKind::CallExpression(_)) {
                        expression_root = transparent_expression_root(parent, ctx);
                        continue;
                    }
                    return match parent.kind() {
                        AstKind::VariableDeclarator(declarator) => declarator
                            .id
                            .get_binding_identifier()
                            .is_some_and(|identifier| {
                                no_derived_is_uppercase_name(identifier.name.as_str())
                            }),
                        AstKind::ExportDefaultDeclaration(_) => true,
                        _ => false,
                    };
                }
            }
            _ => false,
        }
    }

    fn no_derived_is_uppercase_name(name: &str) -> bool {
        name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
    }

    enum NoDerivedRenderTracker {
        State {
            state_symbol_id: SymbolId,
            setter_symbol_id: SymbolId,
        },
        Ref {
            ref_symbol_id: SymbolId,
        },
    }

    fn no_derived_check_render_guard<'a>(
        component_node: &AstNode<'a>,
        if_statement: &'a oxc_ast::ast::IfStatement<'a>,
        ctx: &LintContext<'a>,
    ) {
        if if_statement.alternate.is_some() {
            return;
        }
        let Expression::BinaryExpression(test) = if_statement.test.get_inner_expression() else {
            return;
        };
        if test.operator != oxc_syntax::operator::BinaryOperator::StrictInequality {
            return;
        }
        let oxc_ast::ast::Statement::BlockStatement(branch) = &if_statement.consequent else {
            return;
        };
        let candidates = [(&test.left, &test.right), (&test.right, &test.left)];
        for (source_expression, tracker_expression) in candidates {
            let Some(source_symbol_id) = no_derived_resolve_simple_render_source(
                source_expression,
                component_node,
                ctx,
                &mut Vec::new(),
            ) else {
                continue;
            };
            let Some(tracker) = no_derived_render_tracker(tracker_expression, ctx) else {
                continue;
            };
            let Some(tracker_initializer) = no_derived_tracker_initializer(&tracker, ctx) else {
                continue;
            };
            if no_derived_resolve_simple_render_source(
                tracker_initializer,
                component_node,
                ctx,
                &mut Vec::new(),
            ) != Some(source_symbol_id)
                || !no_derived_tracker_is_synchronized(
                    &tracker,
                    source_symbol_id,
                    component_node,
                    &branch.body,
                    ctx,
                )
            {
                continue;
            }
            no_derived_report_render_destination_writes(
                &tracker,
                source_symbol_id,
                component_node,
                &branch.body,
                ctx,
            );
            return;
        }
    }

    fn no_derived_render_tracker<'a>(
        expression: &Expression<'a>,
        ctx: &LintContext<'a>,
    ) -> Option<NoDerivedRenderTracker> {
        match expression.get_inner_expression() {
            Expression::Identifier(identifier) => {
                let state_symbol_id = ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()?;
                let (_, setter_symbol_id) =
                    no_derived_state_pair_from_state_symbol(state_symbol_id, ctx)?;
                Some(NoDerivedRenderTracker::State {
                    state_symbol_id,
                    setter_symbol_id,
                })
            }
            expression => {
                let Some(oxc_ast::ast::MemberExpression::StaticMemberExpression(member)) =
                    expression.as_member_expression()
                else {
                    return None;
                };
                if member.property.name != "current" {
                    return None;
                }
                let Expression::Identifier(identifier) = member.object.get_inner_expression()
                else {
                    return None;
                };
                let ref_symbol_id = ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()?;
                no_derived_is_hook_binding(ref_symbol_id, "useRef", ctx)
                    .then_some(NoDerivedRenderTracker::Ref { ref_symbol_id })
            }
        }
    }

    fn no_derived_tracker_initializer<'a>(
        tracker: &NoDerivedRenderTracker,
        ctx: &LintContext<'a>,
    ) -> Option<&'a Expression<'a>> {
        let symbol_id = match tracker {
            NoDerivedRenderTracker::State {
                state_symbol_id, ..
            } => *state_symbol_id,
            NoDerivedRenderTracker::Ref { ref_symbol_id } => *ref_symbol_id,
        };
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return None;
        };
        let Expression::CallExpression(call) = declarator.init.as_ref()?.get_inner_expression()
        else {
            return None;
        };
        call.arguments.first()?.as_expression()
    }

    fn no_derived_tracker_is_synchronized<'a>(
        tracker: &NoDerivedRenderTracker,
        source_symbol_id: SymbolId,
        component_node: &AstNode<'a>,
        statements: &'a [oxc_ast::ast::Statement<'a>],
        ctx: &LintContext<'a>,
    ) -> bool {
        statements.iter().any(|statement| match tracker {
            NoDerivedRenderTracker::State {
                setter_symbol_id, ..
            } => no_derived_direct_call(statement).is_some_and(|call| {
                call.arguments.len() == 1
                    && no_derived_call_callee_symbol(call, ctx) == Some(*setter_symbol_id)
                    && call.arguments.first().and_then(Argument::as_expression).is_some_and(
                        |written_value| {
                            no_derived_resolve_simple_render_source(
                                written_value,
                                component_node,
                                ctx,
                                &mut Vec::new(),
                            ) == Some(source_symbol_id)
                        },
                    )
            }),
            NoDerivedRenderTracker::Ref { ref_symbol_id } => {
                no_derived_direct_assignment(statement).is_some_and(|assignment| {
                    assignment.operator
                        == oxc_syntax::operator::AssignmentOperator::Assign
                        && assignment.left.as_member_expression().is_some_and(|member| {
                            matches!(member,
                                oxc_ast::ast::MemberExpression::StaticMemberExpression(member)
                                    if member.property.name == "current"
                                        && matches!(member.object.get_inner_expression(),
                                            Expression::Identifier(identifier)
                                                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id()
                                                    == Some(*ref_symbol_id)))
                        })
                        && no_derived_resolve_simple_render_source(
                            &assignment.right,
                            component_node,
                            ctx,
                            &mut Vec::new(),
                        ) == Some(source_symbol_id)
                })
            }
        })
    }

    fn no_derived_report_render_destination_writes<'a>(
        tracker: &NoDerivedRenderTracker,
        source_symbol_id: SymbolId,
        component_node: &AstNode<'a>,
        statements: &'a [oxc_ast::ast::Statement<'a>],
        ctx: &LintContext<'a>,
    ) {
        for statement in statements {
            let Some(call) = no_derived_direct_call(statement) else {
                continue;
            };
            if call.arguments.len() != 1 {
                continue;
            }
            let Expression::Identifier(setter_identifier) = call.callee.get_inner_expression()
            else {
                continue;
            };
            let Some(state_pair) = no_derived_resolve_use_state_pair(setter_identifier, ctx) else {
                continue;
            };
            if matches!(tracker, NoDerivedRenderTracker::State { state_symbol_id, .. }
                if state_pair.state_symbol_id == Some(*state_symbol_id))
                || !no_derived_setter_is_exclusive(
                    state_pair.setter_symbol_id,
                    setter_identifier.span,
                    ctx,
                )
            {
                continue;
            }
            let Some(written_value) = call.arguments.first().and_then(Argument::as_expression)
            else {
                continue;
            };
            if matches!(
                written_value.get_inner_expression(),
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            ) {
                continue;
            }
            let Some(initializer) = no_derived_state_initializer(state_pair.setter_symbol_id, ctx)
            else {
                continue;
            };
            if !no_derived_render_value_matches_source(
                written_value,
                source_symbol_id,
                state_pair.setter_symbol_id,
                component_node,
                ctx,
            ) || !no_derived_render_value_matches_source(
                initializer,
                source_symbol_id,
                state_pair.setter_symbol_id,
                component_node,
                ctx,
            ) {
                continue;
            }
            no_derived_report(call.span, &state_pair.state_name, ctx);
        }
    }

    fn no_derived_direct_call<'a>(
        statement: &'a oxc_ast::ast::Statement<'a>,
    ) -> Option<&'a oxc_ast::ast::CallExpression<'a>> {
        let oxc_ast::ast::Statement::ExpressionStatement(statement) = statement else {
            return None;
        };
        let Expression::CallExpression(call) = statement.expression.get_inner_expression() else {
            return None;
        };
        Some(call)
    }

    fn no_derived_direct_assignment<'a>(
        statement: &'a oxc_ast::ast::Statement<'a>,
    ) -> Option<&'a oxc_ast::ast::AssignmentExpression<'a>> {
        let oxc_ast::ast::Statement::ExpressionStatement(statement) = statement else {
            return None;
        };
        let Expression::AssignmentExpression(assignment) =
            statement.expression.get_inner_expression()
        else {
            return None;
        };
        Some(assignment)
    }

    fn no_derived_call_callee_symbol<'a>(
        call: &oxc_ast::ast::CallExpression<'a>,
        ctx: &LintContext<'a>,
    ) -> Option<SymbolId> {
        let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
            return None;
        };
        resolve_const_identifier_root_symbol(identifier, ctx)
    }

    fn no_derived_setter_is_exclusive(
        setter_symbol_id: SymbolId,
        call_span: oxc_span::Span,
        ctx: &LintContext<'_>,
    ) -> bool {
        let references = ctx
            .scoping()
            .get_resolved_references(setter_symbol_id)
            .collect::<Vec<_>>();
        references.len() == 1 && ctx.nodes().get_node(references[0].node_id()).span() == call_span
    }

    fn no_derived_state_initializer<'a>(
        setter_symbol_id: SymbolId,
        ctx: &LintContext<'a>,
    ) -> Option<&'a Expression<'a>> {
        let declaration = ctx.symbol_declaration(setter_symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return None;
        };
        let Expression::CallExpression(call) = declarator.init.as_ref()?.get_inner_expression()
        else {
            return None;
        };
        call.arguments.first()?.as_expression()
    }

    fn no_derived_state_pair_from_state_symbol(
        state_symbol_id: SymbolId,
        ctx: &LintContext<'_>,
    ) -> Option<(SymbolId, SymbolId)> {
        let declaration = ctx.symbol_declaration(state_symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return None;
        };
        let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
            return None;
        };
        let BindingPattern::BindingIdentifier(state_binding) =
            pattern.elements.first().and_then(Option::as_ref)?
        else {
            return None;
        };
        let BindingPattern::BindingIdentifier(setter_binding) =
            pattern.elements.get(1).and_then(Option::as_ref)?
        else {
            return None;
        };
        (state_binding.symbol_id() == state_symbol_id
            && derived_expression_is_use_state_tuple(
                declarator.init.as_ref()?,
                ctx,
                &mut Vec::new(),
            ))
        .then_some((state_symbol_id, setter_binding.symbol_id()))
    }

    fn no_derived_is_hook_binding(
        symbol_id: SymbolId,
        hook_name: &str,
        ctx: &LintContext<'_>,
    ) -> bool {
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        let Some(Expression::CallExpression(call)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            return false;
        };
        is_react_hook_call(call, &[hook_name], ctx)
    }

    fn no_derived_resolve_simple_render_source<'a>(
        expression: &Expression<'a>,
        component_node: &AstNode<'a>,
        ctx: &LintContext<'a>,
        visited_symbol_ids: &mut Vec<SymbolId>,
    ) -> Option<SymbolId> {
        let Expression::Identifier(identifier) = expression.get_inner_expression() else {
            return None;
        };
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        if visited_symbol_ids.contains(&symbol_id) {
            return None;
        }
        if no_derived_is_destructured_component_parameter(symbol_id, component_node, ctx) {
            return Some(symbol_id);
        }
        if let Some((_, setter_symbol_id)) = no_derived_state_pair_from_state_symbol(symbol_id, ctx)
        {
            if no_derived_state_is_externally_driven(
                setter_symbol_id,
                component_node.id(),
                ctx,
                &mut FxHashSet::default(),
            ) {
                return None;
            }
            return Some(symbol_id);
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let declarator = if let AstKind::VariableDeclarator(declarator) = declaration.kind() {
            Some((declarator, declaration.id()))
        } else {
            ctx.nodes()
                .ancestors(declaration.id())
                .take_while(|ancestor| {
                    !matches!(
                        ancestor.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    )
                })
                .find_map(|ancestor| match ancestor.kind() {
                    AstKind::VariableDeclarator(declarator) => Some((declarator, ancestor.id())),
                    _ => None,
                })
        };
        let Some((declarator, declarator_id)) = declarator else {
            return None;
        };
        if !matches!(
            ctx.nodes().parent_node(declarator_id).kind(),
            AstKind::VariableDeclaration(declaration)
                if declaration.kind.is_const()
        ) || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| reference.is_write())
        {
            return None;
        }
        if matches!(
            declarator.id,
            BindingPattern::ObjectPattern(_) | BindingPattern::ArrayPattern(_)
        ) && declarator.init.as_ref().is_some_and(|initializer| {
            no_derived_is_whole_component_props_expression(initializer, component_node, ctx)
        }) {
            return Some(symbol_id);
        }
        visited_symbol_ids.push(symbol_id);
        let source = no_derived_resolve_simple_render_source(
            declarator.init.as_ref()?,
            component_node,
            ctx,
            visited_symbol_ids,
        );
        visited_symbol_ids.pop();
        source
    }

    fn no_derived_is_whole_component_props_expression(
        expression: &Expression<'_>,
        component_node: &AstNode<'_>,
        ctx: &LintContext<'_>,
    ) -> bool {
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
        let first_parameter = match component_node.kind() {
            AstKind::Function(function) => function.params.items.first(),
            AstKind::ArrowFunctionExpression(function) => function.params.items.first(),
            _ => None,
        };
        first_parameter.is_some_and(|parameter| {
            matches!(&parameter.pattern,
                BindingPattern::BindingIdentifier(binding)
                    if binding.symbol_id() == symbol_id)
        })
    }

    fn no_derived_is_destructured_component_parameter(
        symbol_id: SymbolId,
        component_node: &AstNode<'_>,
        ctx: &LintContext<'_>,
    ) -> bool {
        let declaration = ctx.symbol_declaration(symbol_id);
        let is_parameter = match component_node.kind() {
            AstKind::Function(function) => {
                function.params.span.contains_inclusive(declaration.span())
            }
            AstKind::ArrowFunctionExpression(function) => {
                function.params.span.contains_inclusive(declaration.span())
            }
            _ => false,
        };
        is_parameter
            && ctx
                .nodes()
                .ancestors(declaration.id())
                .take_while(|ancestor| ancestor.id() != component_node.id())
                .any(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::ObjectPattern(_) | AstKind::ArrayPattern(_)
                    )
                })
    }

    fn no_derived_state_is_externally_driven<'a>(
        setter_symbol_id: SymbolId,
        component_id: NodeId,
        ctx: &LintContext<'a>,
        visited_function_ids: &mut FxHashSet<NodeId>,
    ) -> bool {
        let mut has_deferred_writer = false;
        for reference in ctx.scoping().get_resolved_references(setter_symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            if no_derived_node_is_deferred_position(reference_root, ctx) {
                has_deferred_writer = true;
                continue;
            }
            let parent = ctx.nodes().parent_node(reference_root.id());
            let AstKind::CallExpression(call) = parent.kind() else {
                continue;
            };
            if call.callee.span() != reference_root.span()
                || !no_derived_writer_is_deferred(
                    parent.id(),
                    component_id,
                    ctx,
                    visited_function_ids,
                )
            {
                return false;
            }
            has_deferred_writer = true;
        }
        has_deferred_writer
    }

    fn no_derived_writer_is_deferred<'a>(
        node_id: NodeId,
        component_id: NodeId,
        ctx: &LintContext<'a>,
        visited_function_ids: &mut FxHashSet<NodeId>,
    ) -> bool {
        for ancestor in ctx.nodes().ancestors(node_id) {
            if ancestor.id() == component_id {
                break;
            }
            if !matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) {
                continue;
            }
            if no_derived_node_is_deferred_position(ancestor, ctx) {
                return true;
            }
            let Some(function_symbol_id) = no_derived_function_binding_symbol(ancestor, ctx) else {
                return false;
            };
            if !visited_function_ids.insert(ancestor.id()) {
                return true;
            }
            let mut has_reference = false;
            for reference in ctx.scoping().get_resolved_references(function_symbol_id) {
                has_reference = true;
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let reference_root = transparent_expression_root(reference_node, ctx);
                if no_derived_node_is_deferred_position(reference_root, ctx) {
                    continue;
                }
                let parent = ctx.nodes().parent_node(reference_root.id());
                let AstKind::CallExpression(call) = parent.kind() else {
                    return false;
                };
                if call.callee.span() != reference_root.span()
                    || !no_derived_writer_is_deferred(
                        parent.id(),
                        component_id,
                        ctx,
                        visited_function_ids,
                    )
                {
                    return false;
                }
            }
            return has_reference;
        }
        false
    }

    fn no_derived_function_binding_symbol<'a>(
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
            if matches!(parent.kind(), AstKind::CallExpression(call)
                if call.arguments.iter().any(|argument| argument.span() == root.span()))
            {
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

    fn no_derived_node_is_deferred_position(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
        let parent = ctx.nodes().parent_node(node.id());
        match parent.kind() {
            AstKind::CallExpression(call)
                if call
                    .arguments
                    .iter()
                    .any(|argument| argument.span() == node.span()) =>
            {
                no_derived_callee_name(&call.callee)
                    .is_some_and(|name| NO_DERIVED_DEFERRING_CALLEE_NAMES.contains(&name))
            }
            AstKind::NewExpression(call)
                if call
                    .arguments
                    .iter()
                    .any(|argument| argument.span() == node.span()) =>
            {
                no_derived_callee_name(&call.callee)
                    .is_some_and(|name| name == "Promise" || name.ends_with("Observer"))
            }
            AstKind::AssignmentExpression(assignment) if assignment.right.span() == node.span() => {
                assignment
                    .left
                    .as_member_expression()
                    .and_then(|member| member.static_property_name())
                    .is_some_and(|name| name.starts_with("on"))
            }
            _ => false,
        }
    }

    fn no_derived_callee_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
        match expression.get_inner_expression() {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            expression => expression
                .as_member_expression()
                .and_then(|member| member.static_property_name()),
        }
    }

    fn no_derived_render_value_matches_source<'a>(
        expression: &Expression<'a>,
        source_symbol_id: SymbolId,
        destination_setter_symbol_id: SymbolId,
        component_node: &AstNode<'a>,
        ctx: &LintContext<'a>,
    ) -> bool {
        if no_derived_local_render_transform_matches_source(
            expression,
            source_symbol_id,
            destination_setter_symbol_id,
            component_node,
            ctx,
        ) {
            return true;
        }
        let mut source_state_symbols = rustc_hash::FxHashSet::default();
        if !derived_expression_is_render_known(
            expression,
            component_node.id(),
            destination_setter_symbol_id,
            ctx,
            &mut Vec::new(),
            &mut source_state_symbols,
            &FxHashMap::default(),
            1,
        ) {
            return false;
        }
        let mut did_find_source = false;
        for candidate in ctx.nodes().iter() {
            let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                continue;
            };
            if !expression.span().contains_inclusive(identifier.span) {
                continue;
            }
            let Some(candidate_symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                continue;
            };
            if candidate_symbol_id == source_symbol_id {
                did_find_source = true;
                continue;
            }
            if no_derived_is_destructured_component_parameter(
                candidate_symbol_id,
                component_node,
                ctx,
            ) || no_derived_state_pair_from_state_symbol(candidate_symbol_id, ctx).is_some()
            {
                return false;
            }
        }
        did_find_source
    }

    fn no_derived_local_render_transform_matches_source<'a>(
        expression: &Expression<'a>,
        source_symbol_id: SymbolId,
        destination_setter_symbol_id: SymbolId,
        component_node: &AstNode<'a>,
        ctx: &LintContext<'a>,
    ) -> bool {
        let Expression::CallExpression(call) = expression.get_inner_expression() else {
            return false;
        };
        let used_parameter_indices =
            exact_local_callback_function_id(&call.callee, ctx, &mut Vec::new())
                .and_then(|function_id| no_derived_local_helper_summary(function_id, ctx))
                .or_else(|| no_derived_imported_helper_summary(call, ctx));
        let Some(used_parameter_indices) = used_parameter_indices else {
            return false;
        };
        let arguments = call
            .arguments
            .iter()
            .filter_map(Argument::as_expression)
            .collect::<Vec<_>>();
        let mut has_source_argument = false;
        for parameter_index in used_parameter_indices {
            let Some(argument) = arguments.get(parameter_index) else {
                return false;
            };
            if !no_derived_render_value_matches_source(
                argument,
                source_symbol_id,
                destination_setter_symbol_id,
                component_node,
                ctx,
            ) {
                return false;
            }
            has_source_argument = true;
        }
        has_source_argument
    }

    fn no_derived_local_helper_summary(
        function_id: NodeId,
        ctx: &LintContext<'_>,
    ) -> Option<FxHashSet<usize>> {
        if derived_nearest_function_id(function_id, ctx).is_some() {
            return None;
        }
        let function_node = ctx.nodes().get_node(function_id);
        let (is_async_or_generator, parameters, statements, expression) = match function_node.kind()
        {
            AstKind::Function(function) => (
                function.r#async || function.generator,
                &function.params.items,
                function
                    .body
                    .as_ref()
                    .map(|body| body.statements.as_slice()),
                None,
            ),
            AstKind::ArrowFunctionExpression(function) => (
                function.r#async,
                &function.params.items,
                function
                    .body
                    .as_function_body()
                    .map(|body| body.statements.as_slice()),
                function.get_expression(),
            ),
            _ => return None,
        };
        if is_async_or_generator {
            return None;
        }
        let mut parameter_indices = FxHashMap::default();
        for (parameter_index, parameter) in parameters.iter().enumerate() {
            let binding = parameter.pattern.get_binding_identifier()?;
            if parameter_indices
                .insert(binding.symbol_id(), parameter_index)
                .is_some()
            {
                return None;
            }
        }
        let mut used_parameter_indices = FxHashSet::default();
        let mut visited_symbol_ids = Vec::new();
        if let Some(expression) = expression {
            return no_derived_local_helper_expression_is_pure(
                expression,
                function_id,
                ctx,
                &parameter_indices,
                &mut used_parameter_indices,
                &mut visited_symbol_ids,
            )
            .then_some(used_parameter_indices);
        }
        let can_continue = no_derived_local_helper_statements_can_continue(
            statements?,
            function_id,
            ctx,
            &parameter_indices,
            &mut used_parameter_indices,
            &mut visited_symbol_ids,
        )?;
        (!can_continue).then_some(used_parameter_indices)
    }

    fn no_derived_local_helper_statements_can_continue<'a>(
        statements: &'a [Statement<'a>],
        function_id: NodeId,
        ctx: &LintContext<'a>,
        parameter_indices: &FxHashMap<SymbolId, usize>,
        used_parameter_indices: &mut FxHashSet<usize>,
        visited_symbol_ids: &mut Vec<SymbolId>,
    ) -> Option<bool> {
        let mut can_continue = true;
        for statement in statements {
            if !can_continue {
                if !matches!(statement, Statement::EmptyStatement(_)) {
                    return None;
                }
                continue;
            }
            match statement {
                Statement::EmptyStatement(_) => {}
                Statement::VariableDeclaration(declaration) if declaration.kind.is_const() => {
                    for declarator in &declaration.declarations {
                        declarator.id.get_binding_identifier()?;
                        if !no_derived_local_helper_expression_is_pure(
                            declarator.init.as_ref()?,
                            function_id,
                            ctx,
                            parameter_indices,
                            used_parameter_indices,
                            visited_symbol_ids,
                        ) {
                            return None;
                        }
                    }
                }
                Statement::ReturnStatement(statement) => {
                    if !no_derived_local_helper_expression_is_pure(
                        statement.argument.as_ref()?,
                        function_id,
                        ctx,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    ) {
                        return None;
                    }
                    can_continue = false;
                }
                Statement::BlockStatement(block) => {
                    can_continue = no_derived_local_helper_statements_can_continue(
                        &block.body,
                        function_id,
                        ctx,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    )?;
                }
                Statement::IfStatement(statement) => {
                    if !no_derived_local_helper_expression_is_pure(
                        &statement.test,
                        function_id,
                        ctx,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    ) {
                        return None;
                    }
                    let consequent_can_continue = no_derived_local_helper_statements_can_continue(
                        std::slice::from_ref(&statement.consequent),
                        function_id,
                        ctx,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    )?;
                    let alternate_can_continue = if let Some(alternate) = &statement.alternate {
                        no_derived_local_helper_statements_can_continue(
                            std::slice::from_ref(alternate),
                            function_id,
                            ctx,
                            parameter_indices,
                            used_parameter_indices,
                            visited_symbol_ids,
                        )?
                    } else {
                        true
                    };
                    can_continue = consequent_can_continue || alternate_can_continue;
                }
                _ => return None,
            }
        }
        Some(can_continue)
    }

    fn no_derived_local_helper_expression_is_pure<'a>(
        expression: &Expression<'a>,
        function_id: NodeId,
        ctx: &LintContext<'a>,
        parameter_indices: &FxHashMap<SymbolId, usize>,
        used_parameter_indices: &mut FxHashSet<usize>,
        visited_symbol_ids: &mut Vec<SymbolId>,
    ) -> bool {
        let expression_span = expression.span();
        for candidate in ctx.nodes().iter() {
            if !expression_span.contains_inclusive(candidate.span())
                || derived_nearest_function_id(candidate.id(), ctx) != Some(function_id)
            {
                continue;
            }
            match candidate.kind() {
                AstKind::Function(function) if candidate.id() != function_id => {
                    if function.r#async || function.generator {
                        return false;
                    }
                    let Some(body) = &function.body else {
                        return false;
                    };
                    if no_derived_local_helper_statements_can_continue(
                        &body.statements,
                        candidate.id(),
                        ctx,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    ) != Some(false)
                    {
                        return false;
                    }
                }
                AstKind::ArrowFunctionExpression(function) if candidate.id() != function_id => {
                    if function.r#async {
                        return false;
                    }
                    let callback_is_pure =
                        if let Some(callback_expression) = function.get_expression() {
                            no_derived_local_helper_expression_is_pure(
                                callback_expression,
                                candidate.id(),
                                ctx,
                                parameter_indices,
                                used_parameter_indices,
                                visited_symbol_ids,
                            )
                        } else {
                            function.body.as_function_body().is_some_and(|body| {
                                no_derived_local_helper_statements_can_continue(
                                    &body.statements,
                                    candidate.id(),
                                    ctx,
                                    parameter_indices,
                                    used_parameter_indices,
                                    visited_symbol_ids,
                                ) == Some(false)
                            })
                        };
                    if !callback_is_pure {
                        return false;
                    }
                }
                AstKind::AwaitExpression(_)
                | AstKind::YieldExpression(_)
                | AstKind::AssignmentExpression(_)
                | AstKind::UpdateExpression(_) => return false,
                AstKind::NewExpression(construction) => {
                    let Expression::Identifier(identifier) =
                        construction.callee.get_inner_expression()
                    else {
                        return false;
                    };
                    if !matches!(identifier.name.as_str(), "Date" | "Set")
                        || !derived_identifier_is_global(identifier, ctx)
                    {
                        return false;
                    }
                }
                AstKind::CallExpression(call) if !derived_is_pure_call(call, ctx) => return false,
                AstKind::IdentifierReference(identifier) => {
                    let reference = ctx.scoping().get_reference(identifier.reference_id());
                    let Some(symbol_id) = reference.symbol_id() else {
                        if !matches!(
                            identifier.name.as_str(),
                            "Array"
                                | "BigInt"
                                | "Boolean"
                                | "Date"
                                | "Infinity"
                                | "JSON"
                                | "Math"
                                | "NaN"
                                | "Number"
                                | "Object"
                                | "Set"
                                | "String"
                                | "encodeURIComponent"
                                | "parseFloat"
                                | "parseInt"
                                | "structuredClone"
                                | "undefined"
                        ) {
                            return false;
                        }
                        continue;
                    };
                    if let Some(parameter_index) = parameter_indices.get(&symbol_id) {
                        used_parameter_indices.insert(*parameter_index);
                        continue;
                    }
                    let declaration = ctx.symbol_declaration(symbol_id);
                    if matches!(declaration.kind(), AstKind::FormalParameter(_))
                        && derived_nearest_function_id(declaration.id(), ctx) == Some(function_id)
                    {
                        continue;
                    }
                    if visited_symbol_ids.contains(&symbol_id) {
                        return false;
                    }
                    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                        return false;
                    };
                    if derived_nearest_function_id(declaration.id(), ctx) != Some(function_id)
                        || !matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                    {
                        return false;
                    }
                    let Some(initializer) = &declarator.init else {
                        return false;
                    };
                    visited_symbol_ids.push(symbol_id);
                    let is_pure = no_derived_local_helper_expression_is_pure(
                        initializer,
                        function_id,
                        ctx,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    );
                    visited_symbol_ids.pop();
                    if !is_pure {
                        return false;
                    }
                }
                _ => {}
            }
        }
        true
    }

    fn no_derived_imported_helper_summary<'a>(
        call: &oxc_ast::ast::CallExpression<'a>,
        ctx: &LintContext<'a>,
    ) -> Option<FxHashSet<usize>> {
        let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
            return None;
        };
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        let import_entry = ctx.module_record().import_entries.iter().find(|entry| {
            !entry.is_type
                && ctx
                    .scoping()
                    .get_root_binding(entry.local_name.name().into())
                    == Some(symbol_id)
        })?;
        let exported_name = match &import_entry.import_name {
            ImportImportName::Name(name) => name.name(),
            ImportImportName::Default(_) => "default",
            ImportImportName::NamespaceObject => return None,
        };
        if !ctx.file_path().is_absolute() {
            return None;
        }
        let helper_path = no_derived_resolve_first_party_module_path(
            ctx.file_path(),
            import_entry.module_request.name(),
        )?;
        no_derived_foreign_helper_summary(&helper_path, exported_name, 0, &mut FxHashSet::default())
    }

    fn no_derived_resolve_first_party_module_path(
        from_file_path: &Path,
        module_source: &str,
    ) -> Option<PathBuf> {
        if Path::new(module_source).is_absolute() {
            return None;
        }
        let resolver = Resolver::new(ResolveOptions {
            extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]
                .into_iter()
                .map(String::from)
                .collect(),
            main_fields: vec!["module".into(), "main".into(), "browser".into()],
            condition_names: vec![
                "import".into(),
                "default".into(),
                "module".into(),
                "browser".into(),
                "require".into(),
            ],
            extension_alias: vec![
                (
                    ".js".into(),
                    vec![".js".into(), ".ts".into(), ".tsx".into(), ".jsx".into()],
                ),
                (".jsx".into(), vec![".jsx".into(), ".tsx".into()]),
                (".mjs".into(), vec![".mjs".into(), ".mts".into()]),
                (".cjs".into(), vec![".cjs".into(), ".cts".into()]),
            ],
            tsconfig: Some(TsconfigDiscovery::Auto),
            ..ResolveOptions::default()
        });
        let resolved_path = resolver
            .resolve_file(from_file_path, module_source)
            .ok()?
            .path()
            .to_path_buf();
        (!resolved_path
            .components()
            .any(|component| component.as_os_str() == "node_modules"))
        .then_some(resolved_path)
    }

    fn no_derived_foreign_helper_summary(
        file_path: &Path,
        exported_name: &str,
        depth: usize,
        visited_paths: &mut FxHashSet<PathBuf>,
    ) -> Option<FxHashSet<usize>> {
        if depth >= NO_DERIVED_MAX_IMPORTED_HELPER_DEPTH {
            return None;
        }
        let canonical_path =
            std::fs::canonicalize(file_path).unwrap_or_else(|_| file_path.to_path_buf());
        if !visited_paths.insert(canonical_path) {
            return None;
        }
        let filename = file_path.to_string_lossy();
        if filename.ends_with(".d.ts")
            || filename.ends_with(".d.mts")
            || filename.ends_with(".d.cts")
        {
            return None;
        }
        let source = std::fs::read_to_string(file_path).ok()?;
        let mut source_hasher = std::collections::hash_map::DefaultHasher::new();
        source.hash(&mut source_hasher);
        let cache_key = (
            file_path.to_path_buf(),
            exported_name.to_string(),
            source_hasher.finish(),
        );
        if let Some(summary) = NO_DERIVED_HELPER_SUMMARY_CACHE
            .get_or_init(|| Mutex::new(FxHashMap::default()))
            .lock()
            .ok()
            .and_then(|cache| cache.get(&cache_key).cloned())
        {
            return Some(summary);
        }
        let source_type = SourceType::from_path(file_path).ok()?;
        let allocator = Allocator::default();
        let parser_return = Parser::new(&allocator, &source, source_type).parse();
        if parser_return.panicked || !parser_return.diagnostics.is_empty() {
            return None;
        }
        let program = allocator.alloc(parser_return.program);
        let semantic_return = SemanticBuilder::new_linter().build(program);
        if !semantic_return.diagnostics.is_empty() {
            return None;
        }
        let semantic = semantic_return.semantic;
        let module_record = ModuleRecord::new(file_path, &parser_return.module_record, &semantic);
        if let Some(function_id) =
            no_derived_foreign_exported_function_id(exported_name, &semantic, &module_record)
        {
            let summary = no_derived_foreign_function_summary(function_id, &semantic)?;
            if let Ok(mut cache) = NO_DERIVED_HELPER_SUMMARY_CACHE
                .get_or_init(|| Mutex::new(FxHashMap::default()))
                .lock()
            {
                cache.insert(cache_key, summary.clone());
            }
            return Some(summary);
        }
        if exported_name == "default"
            && let Some(function_id) = no_derived_foreign_default_function_id(&semantic)
        {
            let summary = no_derived_foreign_function_summary(function_id, &semantic)?;
            if let Ok(mut cache) = NO_DERIVED_HELPER_SUMMARY_CACHE
                .get_or_init(|| Mutex::new(FxHashMap::default()))
                .lock()
            {
                cache.insert(cache_key, summary.clone());
            }
            return Some(summary);
        }
        if program.body.iter().any(|statement| {
            matches!(statement,
            Statement::ExportFromDeclaration(declaration)
                if declaration.specifiers.iter().any(|specifier| {
                    specifier.exported.name().as_str() == exported_name
                        && (declaration.export_kind.is_type()
                            || specifier.export_kind.is_type())
                }))
        }) {
            return None;
        }
        if let Some((module_source, imported_name)) =
            no_derived_foreign_reexport_target(exported_name, &module_record)
        {
            let reexport_path =
                no_derived_resolve_first_party_module_path(file_path, module_source)?;
            return no_derived_foreign_helper_summary(
                &reexport_path,
                imported_name,
                depth + 1,
                &mut visited_paths.clone(),
            );
        }
        let mut unique_star_summary = None;
        for statement in &program.body {
            let Statement::ExportAllDeclaration(declaration) = statement else {
                continue;
            };
            if declaration.export_kind.is_type() || declaration.exported.is_some() {
                continue;
            }
            let Some(reexport_path) = no_derived_resolve_first_party_module_path(
                file_path,
                declaration.source.value.as_str(),
            ) else {
                continue;
            };
            let Some(summary) = no_derived_foreign_helper_summary(
                &reexport_path,
                exported_name,
                depth + 1,
                &mut visited_paths.clone(),
            ) else {
                continue;
            };
            if unique_star_summary.is_some() {
                return None;
            }
            unique_star_summary = Some(summary);
        }
        unique_star_summary
    }

    fn no_derived_foreign_exported_function_id(
        exported_name: &str,
        semantic: &Semantic<'_>,
        module_record: &ModuleRecord,
    ) -> Option<NodeId> {
        let local_name = module_record
            .local_export_entries
            .iter()
            .find_map(|entry| {
                let matches = match &entry.export_name {
                    ExportExportName::Name(name) => name.name() == exported_name,
                    ExportExportName::Default(_) => exported_name == "default",
                    ExportExportName::Null => false,
                };
                matches.then(|| entry.local_name.name()).flatten()
            })?;
        if let Some(function_id) =
            no_derived_foreign_overload_implementation_id(local_name, semantic)
        {
            return Some(function_id);
        }
        let symbol_id = semantic.scoping().get_root_binding(local_name.into())?;
        no_derived_foreign_function_id_for_symbol(symbol_id, semantic, &mut Vec::new())
    }

    fn no_derived_foreign_overload_implementation_id(
        local_name: &str,
        semantic: &Semantic<'_>,
    ) -> Option<NodeId> {
        semantic.nodes().iter().find_map(|node| {
            let AstKind::Function(function) = node.kind() else {
                return None;
            };
            (function
                .id
                .as_ref()
                .is_some_and(|identifier| identifier.name == local_name)
                && function.body.is_some()
                && semantic
                    .nodes()
                    .ancestors(node.id())
                    .skip(1)
                    .all(|ancestor| {
                        !matches!(
                            ancestor.kind(),
                            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                        )
                    }))
            .then_some(node.id())
        })
    }

    fn no_derived_foreign_default_function_id(semantic: &Semantic<'_>) -> Option<NodeId> {
        semantic.nodes().iter().find_map(|node| {
            let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
                return None;
            };
            match &declaration.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                    function.body.as_ref().map(|_| function.node_id.get())
                }
                ExportDefaultDeclarationKind::ArrowFunctionExpression(function) => {
                    Some(function.node_id.get())
                }
                declaration => {
                    let Expression::Identifier(identifier) =
                        declaration.as_expression()?.get_inner_expression()
                    else {
                        return None;
                    };
                    let symbol_id = semantic
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()?;
                    no_derived_foreign_function_id_for_symbol(symbol_id, semantic, &mut Vec::new())
                }
            }
        })
    }

    fn no_derived_foreign_function_id_for_symbol(
        symbol_id: SymbolId,
        semantic: &Semantic<'_>,
        visited_symbol_ids: &mut Vec<SymbolId>,
    ) -> Option<NodeId> {
        if visited_symbol_ids.contains(&symbol_id) {
            return None;
        }
        visited_symbol_ids.push(symbol_id);
        let declaration = semantic.symbol_declaration(symbol_id);
        let result = match declaration.kind() {
            AstKind::Function(function) => function
                .body
                .as_ref()
                .map(|_| function.node_id.get())
                .or_else(|| {
                    function.id.as_ref().and_then(|identifier| {
                        no_derived_foreign_overload_implementation_id(
                            identifier.name.as_str(),
                            semantic,
                        )
                    })
                }),
            AstKind::VariableDeclarator(declarator) => {
                match declarator.init.as_ref()?.get_inner_expression() {
                    Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                    Expression::FunctionExpression(function) => Some(function.node_id.get()),
                    Expression::Identifier(identifier) => semantic
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .and_then(|alias_symbol_id| {
                            no_derived_foreign_function_id_for_symbol(
                                alias_symbol_id,
                                semantic,
                                visited_symbol_ids,
                            )
                        }),
                    _ => None,
                }
            }
            _ => None,
        };
        visited_symbol_ids.pop();
        result
    }

    fn no_derived_foreign_reexport_target<'a>(
        exported_name: &str,
        module_record: &'a ModuleRecord,
    ) -> Option<(&'a str, &'a str)> {
        module_record
            .indirect_export_entries
            .iter()
            .find_map(|entry| {
                let entry_exported_name = match &entry.export_name {
                    ExportExportName::Name(name) => name.name(),
                    ExportExportName::Default(_) => "default",
                    ExportExportName::Null => return None,
                };
                if entry_exported_name != exported_name {
                    return None;
                }
                let source = entry.module_request.as_ref()?.name();
                let imported_name = match &entry.import_name {
                    ExportImportName::Name(name) => name.name(),
                    _ => return None,
                };
                Some((source, imported_name))
            })
    }

    fn no_derived_foreign_function_summary(
        function_id: NodeId,
        semantic: &Semantic<'_>,
    ) -> Option<FxHashSet<usize>> {
        let function_node = semantic.nodes().get_node(function_id);
        let (is_async_or_generator, parameters, statements, expression) = match function_node.kind()
        {
            AstKind::Function(function) => (
                function.r#async || function.generator,
                &function.params.items,
                function
                    .body
                    .as_ref()
                    .map(|body| body.statements.as_slice()),
                None,
            ),
            AstKind::ArrowFunctionExpression(function) => (
                function.r#async,
                &function.params.items,
                function
                    .body
                    .as_function_body()
                    .map(|body| body.statements.as_slice()),
                function.get_expression(),
            ),
            _ => return None,
        };
        if is_async_or_generator {
            return None;
        }
        let mut parameter_indices = FxHashMap::default();
        for (parameter_index, parameter) in parameters.iter().enumerate() {
            let binding = parameter.pattern.get_binding_identifier()?;
            if parameter_indices
                .insert(binding.symbol_id(), parameter_index)
                .is_some()
            {
                return None;
            }
        }
        let mut used_parameter_indices = FxHashSet::default();
        let mut visited_symbol_ids = Vec::new();
        if let Some(expression) = expression {
            return no_derived_foreign_expression_is_pure(
                expression,
                function_id,
                semantic,
                &parameter_indices,
                &mut used_parameter_indices,
                &mut visited_symbol_ids,
            )
            .then_some(used_parameter_indices);
        }
        let can_continue = no_derived_foreign_statements_can_continue(
            statements?,
            function_id,
            semantic,
            &parameter_indices,
            &mut used_parameter_indices,
            &mut visited_symbol_ids,
        )?;
        (!can_continue).then_some(used_parameter_indices)
    }

    fn no_derived_foreign_statements_can_continue<'a>(
        statements: &'a [Statement<'a>],
        function_id: NodeId,
        semantic: &Semantic<'a>,
        parameter_indices: &FxHashMap<SymbolId, usize>,
        used_parameter_indices: &mut FxHashSet<usize>,
        visited_symbol_ids: &mut Vec<SymbolId>,
    ) -> Option<bool> {
        let mut can_continue = true;
        for statement in statements {
            if !can_continue {
                if !matches!(statement, Statement::EmptyStatement(_)) {
                    return None;
                }
                continue;
            }
            match statement {
                Statement::EmptyStatement(_) => {}
                Statement::VariableDeclaration(declaration) if declaration.kind.is_const() => {
                    for declarator in &declaration.declarations {
                        declarator.id.get_binding_identifier()?;
                        if !no_derived_foreign_expression_is_pure(
                            declarator.init.as_ref()?,
                            function_id,
                            semantic,
                            parameter_indices,
                            used_parameter_indices,
                            visited_symbol_ids,
                        ) {
                            return None;
                        }
                    }
                }
                Statement::ReturnStatement(statement) => {
                    if !no_derived_foreign_expression_is_pure(
                        statement.argument.as_ref()?,
                        function_id,
                        semantic,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    ) {
                        return None;
                    }
                    can_continue = false;
                }
                Statement::BlockStatement(block) => {
                    can_continue = no_derived_foreign_statements_can_continue(
                        &block.body,
                        function_id,
                        semantic,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    )?;
                }
                Statement::IfStatement(statement) => {
                    if !no_derived_foreign_expression_is_pure(
                        &statement.test,
                        function_id,
                        semantic,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    ) {
                        return None;
                    }
                    let consequent_can_continue = no_derived_foreign_statements_can_continue(
                        std::slice::from_ref(&statement.consequent),
                        function_id,
                        semantic,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    )?;
                    let alternate_can_continue = if let Some(alternate) = &statement.alternate {
                        no_derived_foreign_statements_can_continue(
                            std::slice::from_ref(alternate),
                            function_id,
                            semantic,
                            parameter_indices,
                            used_parameter_indices,
                            visited_symbol_ids,
                        )?
                    } else {
                        true
                    };
                    can_continue = consequent_can_continue || alternate_can_continue;
                }
                _ => return None,
            }
        }
        Some(can_continue)
    }

    fn no_derived_foreign_expression_is_pure<'a>(
        expression: &Expression<'a>,
        function_id: NodeId,
        semantic: &Semantic<'a>,
        parameter_indices: &FxHashMap<SymbolId, usize>,
        used_parameter_indices: &mut FxHashSet<usize>,
        visited_symbol_ids: &mut Vec<SymbolId>,
    ) -> bool {
        let expression_span = expression.span();
        for candidate in semantic.nodes().iter() {
            if !expression_span.contains_inclusive(candidate.span())
                || no_derived_foreign_nearest_function_id(candidate.id(), semantic)
                    != Some(function_id)
            {
                continue;
            }
            match candidate.kind() {
                AstKind::Function(function) if candidate.id() != function_id => {
                    if function.r#async || function.generator {
                        return false;
                    }
                    let Some(body) = &function.body else {
                        return false;
                    };
                    if no_derived_foreign_statements_can_continue(
                        &body.statements,
                        candidate.id(),
                        semantic,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    ) != Some(false)
                    {
                        return false;
                    }
                }
                AstKind::ArrowFunctionExpression(function) if candidate.id() != function_id => {
                    if function.r#async {
                        return false;
                    }
                    let callback_is_pure =
                        if let Some(callback_expression) = function.get_expression() {
                            no_derived_foreign_expression_is_pure(
                                callback_expression,
                                candidate.id(),
                                semantic,
                                parameter_indices,
                                used_parameter_indices,
                                visited_symbol_ids,
                            )
                        } else {
                            function.body.as_function_body().is_some_and(|body| {
                                no_derived_foreign_statements_can_continue(
                                    &body.statements,
                                    candidate.id(),
                                    semantic,
                                    parameter_indices,
                                    used_parameter_indices,
                                    visited_symbol_ids,
                                ) == Some(false)
                            })
                        };
                    if !callback_is_pure {
                        return false;
                    }
                }
                AstKind::AwaitExpression(_)
                | AstKind::YieldExpression(_)
                | AstKind::AssignmentExpression(_)
                | AstKind::UpdateExpression(_) => return false,
                AstKind::NewExpression(construction) => {
                    let Expression::Identifier(identifier) =
                        construction.callee.get_inner_expression()
                    else {
                        return false;
                    };
                    if !matches!(identifier.name.as_str(), "Date" | "Set")
                        || semantic
                            .scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                            .is_some()
                    {
                        return false;
                    }
                }
                AstKind::CallExpression(call)
                    if !no_derived_foreign_call_is_pure(call, semantic) =>
                {
                    return false;
                }
                AstKind::IdentifierReference(identifier) => {
                    let reference = semantic.scoping().get_reference(identifier.reference_id());
                    let Some(symbol_id) = reference.symbol_id() else {
                        if !matches!(
                            identifier.name.as_str(),
                            "Array"
                                | "BigInt"
                                | "Boolean"
                                | "Date"
                                | "Infinity"
                                | "JSON"
                                | "Math"
                                | "NaN"
                                | "Number"
                                | "Object"
                                | "Set"
                                | "String"
                                | "encodeURIComponent"
                                | "parseFloat"
                                | "parseInt"
                                | "structuredClone"
                                | "undefined"
                        ) {
                            return false;
                        }
                        continue;
                    };
                    if let Some(parameter_index) = parameter_indices.get(&symbol_id) {
                        used_parameter_indices.insert(*parameter_index);
                        continue;
                    }
                    let declaration = semantic.symbol_declaration(symbol_id);
                    if matches!(declaration.kind(), AstKind::FormalParameter(_))
                        && no_derived_foreign_nearest_function_id(declaration.id(), semantic)
                            == Some(function_id)
                    {
                        continue;
                    }
                    if visited_symbol_ids.contains(&symbol_id) {
                        return false;
                    }
                    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                        return false;
                    };
                    if no_derived_foreign_nearest_function_id(declaration.id(), semantic)
                        != Some(function_id)
                        || !matches!(semantic.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                    {
                        return false;
                    }
                    let Some(initializer) = &declarator.init else {
                        return false;
                    };
                    visited_symbol_ids.push(symbol_id);
                    let is_pure = no_derived_foreign_expression_is_pure(
                        initializer,
                        function_id,
                        semantic,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    );
                    visited_symbol_ids.pop();
                    if !is_pure {
                        return false;
                    }
                }
                _ => {}
            }
        }
        true
    }

    fn no_derived_foreign_nearest_function_id(
        node_id: NodeId,
        semantic: &Semantic<'_>,
    ) -> Option<NodeId> {
        semantic
            .nodes()
            .ancestors(node_id)
            .skip(1)
            .find_map(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
                .then_some(ancestor.id())
            })
    }

    fn no_derived_foreign_call_is_pure<'a>(
        call: &oxc_ast::ast::CallExpression<'a>,
        semantic: &Semantic<'a>,
    ) -> bool {
        match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => {
                DERIVED_PURE_DIRECT_CALLS.contains(&identifier.name.as_str())
                    && semantic
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_none()
            }
            expression => expression.as_member_expression().is_some_and(|member| {
                member.static_property_name().is_some_and(|property_name| {
                    DERIVED_PURE_MEMBER_CALLS.contains(&property_name)
                        || no_derived_foreign_is_pure_namespace_call(
                            member.object(),
                            property_name,
                            semantic,
                        )
                        || (property_name == "getTime"
                            && matches!(member.object().get_inner_expression(), Expression::NewExpression(construction)
                                if matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier)
                                    if identifier.name == "Date"
                                        && semantic.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())))
                })
            }),
        }
    }

    fn no_derived_foreign_is_pure_namespace_call<'a>(
        object: &Expression<'a>,
        property_name: &str,
        semantic: &Semantic<'a>,
    ) -> bool {
        let Expression::Identifier(identifier) = object.get_inner_expression() else {
            return false;
        };
        if semantic
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some()
        {
            return false;
        }
        match identifier.name.as_str() {
            "Array" => property_name == "from",
            "JSON" => matches!(
                property_name,
                "isRawJSON" | "parse" | "rawJSON" | "stringify"
            ),
            "Math" => matches!(
                property_name,
                "abs"
                    | "acos"
                    | "acosh"
                    | "asin"
                    | "asinh"
                    | "atan"
                    | "atan2"
                    | "atanh"
                    | "cbrt"
                    | "ceil"
                    | "clz32"
                    | "cos"
                    | "cosh"
                    | "exp"
                    | "floor"
                    | "fround"
                    | "hypot"
                    | "imul"
                    | "log"
                    | "log10"
                    | "log1p"
                    | "log2"
                    | "max"
                    | "min"
                    | "pow"
                    | "round"
                    | "sign"
                    | "sin"
                    | "sinh"
                    | "sqrt"
                    | "tan"
                    | "tanh"
                    | "trunc"
            ),
            "Object" => property_name == "assign",
            _ => false,
        }
    }
}

pub use implementation::NoDerivedState;
