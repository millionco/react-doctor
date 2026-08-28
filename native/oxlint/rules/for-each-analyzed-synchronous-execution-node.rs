const ANALYZED_EXECUTION_EAGER_ITERATOR_METHODS: [&str; 11] = [
    "every",
    "filter",
    "find",
    "findIndex",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
    "sort",
];
const ANALYZED_EXECUTION_ARRAY_RETURNING_METHODS: [&str; 11] = [
    "concat",
    "filter",
    "flat",
    "flatMap",
    "map",
    "slice",
    "sort",
    "toReversed",
    "toSorted",
    "toSpliced",
    "with",
];
const ANALYZED_EXECUTION_EAGER_COLLECTION_CONSTRUCTORS: [&str; 12] = [
    "Array",
    "BigInt64Array",
    "BigUint64Array",
    "Float32Array",
    "Float64Array",
    "Int8Array",
    "Int16Array",
    "Int32Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Uint16Array",
    "Uint32Array",
];
const ANALYZED_EXECUTION_EAGER_FOREACH_COLLECTION_CONSTRUCTORS: [&str; 14] = [
    "Array",
    "BigInt64Array",
    "BigUint64Array",
    "Float32Array",
    "Float64Array",
    "Int8Array",
    "Int16Array",
    "Int32Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Uint16Array",
    "Uint32Array",
    "Map",
    "Set",
];

fn for_each_analyzed_synchronous_execution_node<'a>(
    root_function_id: oxc_semantic::NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &crate::context::LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    mut visitor: impl FnMut(
        &crate::AstNode<'a>,
        oxc_semantic::NodeId,
        bool,
        &mut LocalFunctionResolutionCache,
    ),
) {
    let mut execution_functions = Vec::new();
    let mut execution_function_index_by_id = rustc_hash::FxHashMap::default();
    analyzed_execution_discover_function(
        root_function_id,
        false,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        &mut execution_functions,
        &mut execution_function_index_by_id,
    );
    for (execution_function_id, is_conditionally_executed_by_call_site) in execution_functions {
        for &candidate_id in node_index.node_ids(execution_function_id) {
            let candidate = ctx.nodes().get_node(candidate_id);
            visitor(
                candidate,
                root_function_id,
                is_conditionally_executed_by_call_site
                    || is_node_conditionally_executed(candidate, execution_function_id, ctx),
                resolution_cache,
            );
        }
    }
}

fn analyzed_execution_discover_function<'a>(
    function_id: oxc_semantic::NodeId,
    is_conditionally_executed: bool,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &crate::context::LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    execution_functions: &mut Vec<(oxc_semantic::NodeId, bool)>,
    execution_function_index_by_id: &mut rustc_hash::FxHashMap<oxc_semantic::NodeId, usize>,
) {
    if let Some(&execution_function_index) = execution_function_index_by_id.get(&function_id) {
        let previous_conditionality = &mut execution_functions[execution_function_index].1;
        if !*previous_conditionality || *previous_conditionality == is_conditionally_executed {
            return;
        }
        *previous_conditionality = false;
    } else {
        execution_function_index_by_id.insert(function_id, execution_functions.len());
        execution_functions.push((function_id, is_conditionally_executed));
    }
    for &candidate_id in node_index.node_ids(function_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        let oxc_ast::AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        let call_is_conditional = is_conditionally_executed
            || is_node_conditionally_executed(candidate, function_id, ctx);
        if let Some(called_function_id) = exact_local_function_id(
            &call_expression.callee,
            ctx,
            &mut Vec::new(),
            resolution_cache,
        ) {
            analyzed_execution_discover_function(
                called_function_id,
                call_is_conditional,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                execution_functions,
                execution_function_index_by_id,
            );
        }
        if let Some(callback_expression) = analyzed_execution_immediate_react_callback(
            call_expression,
            analysis,
            ctx,
            resolution_cache,
        ) && let Some(callback_function_id) =
            exact_local_function_id(callback_expression, ctx, &mut Vec::new(), resolution_cache)
        {
            analyzed_execution_discover_function(
                callback_function_id,
                call_is_conditional,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                execution_functions,
                execution_function_index_by_id,
            );
        }
        for argument in &call_expression.arguments {
            let Some(callback_expression) = argument.as_expression() else {
                continue;
            };
            if !analyzed_execution_is_synchronous_iterator_callback(
                call_expression,
                callback_expression,
                ctx,
            ) {
                continue;
            }
            if let Some(callback_function_id) =
                exact_local_function_id(callback_expression, ctx, &mut Vec::new(), resolution_cache)
            {
                analyzed_execution_discover_function(
                    callback_function_id,
                    call_is_conditional,
                    analysis,
                    node_index,
                    ctx,
                    resolution_cache,
                    execution_functions,
                    execution_function_index_by_id,
                );
            }
        }
    }
}

fn analyzed_execution_immediate_react_callback<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    let is_immediate_imported_api = module_api_reference_matches(
        &call_expression.callee,
        "startTransition",
        &["react"],
        analysis,
        ctx,
    ) || module_api_reference_matches(
        &call_expression.callee,
        "flushSync",
        &["react-dom"],
        analysis,
        ctx,
    );
    if !is_immediate_imported_api
        && !analyzed_execution_resolves_to_use_transition_starter(
            &call_expression.callee,
            analysis,
            ctx,
            resolution_cache,
            &mut Vec::new(),
        )
    {
        return None;
    }
    call_expression.arguments.first()?.as_expression()
}

fn analyzed_execution_resolves_to_use_transition_starter<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        let oxc_ast::ast::MemberExpression::ComputedMemberExpression(computed_member) =
            member_expression
        else {
            return false;
        };
        if !matches!(
            computed_member.expression.get_inner_expression(),
            oxc_ast::ast::Expression::NumericLiteral(literal) if literal.value == 1.0
        ) {
            return false;
        }
        let tuple_expression = computed_member.object.get_inner_expression();
        if let oxc_ast::ast::Expression::Identifier(identifier) = tuple_expression
            && analyzed_execution_has_possible_static_property_write(identifier, "1", ctx)
        {
            return false;
        }
        return analyzed_execution_is_use_transition_tuple(
            tuple_expression,
            analysis,
            ctx,
            visited_symbol_ids,
        );
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind()
        && let oxc_ast::ast::BindingPattern::ArrayPattern(pattern) = &declarator.id
        && matches!(
            pattern.elements.get(1).and_then(Option::as_ref),
            Some(oxc_ast::ast::BindingPattern::BindingIdentifier(binding))
                if binding.symbol_id() == symbol_id
        ) && declarator.init.as_ref().is_some_and(|initializer| {
        matches!(initializer.get_inner_expression(), oxc_ast::ast::Expression::CallExpression(call)
        if module_api_reference_matches(
            &call.callee,
            "useTransition",
            &["react"],
            analysis,
            ctx,
        ))
    }) {
        return true;
    }
    analyzed_execution_const_direct_initializer(symbol_id, ctx).is_some_and(|initializer| {
        analyzed_execution_resolves_to_use_transition_starter(
            initializer,
            analysis,
            ctx,
            resolution_cache,
            visited_symbol_ids,
        )
    })
}

fn analyzed_execution_is_use_transition_tuple<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::CallExpression(call_expression) = expression {
        return module_api_reference_matches(
            &call_expression.callee,
            "useTransition",
            &["react"],
            analysis,
            ctx,
        );
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    analyzed_execution_read_only_const_direct_initializer(symbol_id, ctx).is_some_and(
        |initializer| {
            analyzed_execution_is_use_transition_tuple(
                initializer,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        },
    )
}

fn analyzed_execution_has_possible_static_property_write<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    property_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(root_symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return false;
    };
    potential_alias_symbol_ids(root_symbol_id, ctx)
        .into_iter()
        .flat_map(|symbol_id| ctx.scoping().get_resolved_references(symbol_id))
        .any(|reference| {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            static_property_write_member(identifier_node, ctx).is_some_and(|member_node| {
                resolved_static_member_property_name(member_node, ctx)
                    .is_none_or(|written_property_name| written_property_name == property_name)
            })
        })
}

fn analyzed_execution_is_synchronous_iterator_callback<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    callback_expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    use oxc_span::{GetSpan, Span};

    let Some(member_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let Some(method_name) = member_expression.static_property_name() else {
        return false;
    };
    let argument_matches = |argument: Option<&oxc_ast::ast::Argument<'a>>, expected: Span| {
        argument
            .and_then(oxc_ast::ast::Argument::as_expression)
            .is_some_and(|expression| expression.span() == expected)
    };
    if method_name == "from"
        && analyzed_execution_is_global_identifier(member_expression.object(), "Array", ctx)
        && argument_matches(call_expression.arguments.get(1), callback_expression.span())
    {
        return call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .is_some_and(|source| {
                !analyzed_execution_is_provably_empty_eager_collection(source, ctx, &mut Vec::new())
            });
    }
    if !ANALYZED_EXECUTION_EAGER_ITERATOR_METHODS.contains(&method_name)
        || !argument_matches(
            call_expression.arguments.first(),
            callback_expression.span(),
        )
        || analyzed_execution_is_provably_empty_eager_collection(
            member_expression.object(),
            ctx,
            &mut Vec::new(),
        )
    {
        return false;
    }
    if method_name == "forEach" {
        analyzed_execution_is_provably_eager_foreach_collection(
            member_expression.object(),
            ctx,
            &mut Vec::new(),
        )
    } else {
        analyzed_execution_is_provably_eager_collection(
            member_expression.object(),
            ctx,
            &mut Vec::new(),
        )
    }
}

fn analyzed_execution_is_provably_empty_eager_collection<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        oxc_ast::ast::Expression::ArrayExpression(array) => array.elements.is_empty(),
        oxc_ast::ast::Expression::NewExpression(new_expression) => {
            new_expression.arguments.is_empty()
                && analyzed_execution_global_constructor_matches(
                    &new_expression.callee,
                    &ANALYZED_EXECUTION_EAGER_FOREACH_COLLECTION_CONSTRUCTORS,
                    ctx,
                )
        }
        oxc_ast::ast::Expression::CallExpression(call_expression) => {
            let Some(member) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                return false;
            };
            let Some(method_name) = member.static_property_name() else {
                return false;
            };
            if analyzed_execution_is_global_identifier(member.object(), "Array", ctx)
                && matches!(method_name, "from" | "of")
            {
                if method_name == "of" {
                    return call_expression.arguments.is_empty();
                }
                return call_expression
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                    .is_some_and(|source| {
                        analyzed_execution_is_provably_empty_eager_collection(
                            source,
                            ctx,
                            visited_symbol_ids,
                        )
                    });
            }
            method_name != "concat"
                && ANALYZED_EXECUTION_ARRAY_RETURNING_METHODS.contains(&method_name)
                && analyzed_execution_is_provably_empty_eager_collection(
                    member.object(),
                    ctx,
                    visited_symbol_ids,
                )
        }
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let Some((symbol_id, initializer)) =
                analyzed_execution_read_only_const_identifier_initializer(identifier, ctx)
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            analyzed_execution_is_provably_empty_eager_collection(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => false,
    }
}

fn analyzed_execution_is_provably_eager_collection<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        oxc_ast::ast::Expression::ArrayExpression(_) => true,
        oxc_ast::ast::Expression::NewExpression(new_expression) => {
            analyzed_execution_global_constructor_matches(
                &new_expression.callee,
                &ANALYZED_EXECUTION_EAGER_COLLECTION_CONSTRUCTORS,
                ctx,
            )
        }
        oxc_ast::ast::Expression::CallExpression(call_expression) => {
            let Some(member) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                return false;
            };
            let Some(method_name) = member.static_property_name() else {
                return false;
            };
            if (analyzed_execution_is_global_identifier(member.object(), "Array", ctx)
                && matches!(method_name, "from" | "of"))
                || (analyzed_execution_is_global_identifier(member.object(), "Object", ctx)
                    && matches!(method_name, "entries" | "keys" | "values"))
            {
                return true;
            }
            ANALYZED_EXECUTION_ARRAY_RETURNING_METHODS.contains(&method_name)
                && analyzed_execution_is_provably_eager_collection(
                    member.object(),
                    ctx,
                    visited_symbol_ids,
                )
        }
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let Some((symbol_id, initializer)) =
                analyzed_execution_read_only_const_identifier_initializer(identifier, ctx)
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            analyzed_execution_is_provably_eager_collection(initializer, ctx, visited_symbol_ids)
        }
        _ => false,
    }
}

fn analyzed_execution_is_provably_eager_foreach_collection<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::NewExpression(new_expression) = expression {
        return analyzed_execution_global_constructor_matches(
            &new_expression.callee,
            &ANALYZED_EXECUTION_EAGER_FOREACH_COLLECTION_CONSTRUCTORS,
            ctx,
        );
    }
    if let oxc_ast::ast::Expression::Identifier(identifier) = expression {
        let Some((symbol_id, initializer)) =
            analyzed_execution_read_only_const_identifier_initializer(identifier, ctx)
        else {
            return false;
        };
        if visited_symbol_ids.contains(&symbol_id) {
            return false;
        }
        visited_symbol_ids.push(symbol_id);
        return analyzed_execution_is_provably_eager_foreach_collection(
            initializer,
            ctx,
            visited_symbol_ids,
        );
    }
    analyzed_execution_is_provably_eager_collection(expression, ctx, visited_symbol_ids)
}

fn analyzed_execution_is_global_identifier(
    expression: &oxc_ast::ast::Expression<'_>,
    identifier_name: &str,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        oxc_ast::ast::Expression::Identifier(identifier)
            if identifier.name == identifier_name
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    )
}

fn analyzed_execution_global_constructor_matches(
    expression: &oxc_ast::ast::Expression<'_>,
    constructor_names: &[&str],
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let oxc_ast::ast::Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    constructor_names.contains(&identifier.name.as_str())
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
}

fn analyzed_execution_read_only_const_identifier_initializer<'a, 'ctx>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &'ctx crate::context::LintContext<'a>,
) -> Option<(oxc_semantic::SymbolId, &'ctx oxc_ast::ast::Expression<'a>)> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let initializer = analyzed_execution_read_only_const_direct_initializer(symbol_id, ctx)?;
    Some((symbol_id, initializer))
}

fn analyzed_execution_read_only_const_direct_initializer<'a, 'ctx>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &'ctx crate::context::LintContext<'a>,
) -> Option<&'ctx oxc_ast::ast::Expression<'a>> {
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    analyzed_execution_const_direct_initializer(symbol_id, ctx)
}

fn analyzed_execution_const_direct_initializer<'a, 'ctx>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &'ctx crate::context::LintContext<'a>,
) -> Option<&'ctx oxc_ast::ast::Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    declarator.init.as_ref()
}
