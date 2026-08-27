fn r3f_use_three_state_property_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    property_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    r3f_use_three_state_property_matches_inner(expression, property_name, ctx, &mut Vec::new())
}

fn r3f_use_three_state_property_matches_inner<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    property_name: &str,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::CallExpression(call_expression) = expression
        && r3f_use_three_selector_returns_property(call_expression, property_name, ctx)
    {
        return true;
    }
    if let Some(member_expression) = expression.as_member_expression()
        && member_expression.static_property_name() == Some(property_name)
        && r3f_resolves_to_whole_use_three_state(
            member_expression.object(),
            ctx,
            &mut visited_symbol_ids.clone(),
        )
    {
        return true;
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
    if visited_symbol_ids.contains(&symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    if let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id
        && pattern.properties.iter().any(|property| {
            property_key_matches_name(&property.key, property_name)
                && r3f_binding_pattern_symbol_id(&property.value) == Some(symbol_id)
        })
    {
        return declarator.init.as_ref().is_some_and(|initializer| {
            r3f_resolves_to_whole_use_three_state(initializer, ctx, &mut visited_symbol_ids.clone())
        });
    }
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    declarator.init.as_ref().is_some_and(|initializer| {
        r3f_use_three_state_property_matches_inner(
            initializer,
            property_name,
            ctx,
            visited_symbol_ids,
        )
    })
}

fn r3f_resolves_to_whole_use_three_state<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::CallExpression(call_expression) = expression {
        return call_expression.arguments.is_empty()
            && module_api_path_matches(
                &call_expression.callee,
                &["useThree"],
                &[
                    "@react-three/fiber",
                    "@react-three/fiber/legacy",
                    "@react-three/fiber/native",
                    "@react-three/fiber/webgpu",
                    "react-three-fiber",
                ],
                false,
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
    if visited_symbol_ids.contains(&symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) && declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            r3f_resolves_to_whole_use_three_state(initializer, ctx, visited_symbol_ids)
        })
}

fn r3f_use_three_selector_returns_property<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    property_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    if !module_api_path_matches(
        &call_expression.callee,
        &["useThree"],
        &[
            "@react-three/fiber",
            "@react-three/fiber/legacy",
            "@react-three/fiber/native",
            "@react-three/fiber/webgpu",
            "react-three-fiber",
        ],
        false,
        ctx,
    ) {
        return false;
    }
    let Some(selector_expression) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return false;
    };
    let Some(selector_id) = r3f_use_three_callback_node_id(selector_expression, ctx) else {
        return false;
    };
    let returned_expressions = r3f_use_three_function_return_expressions(selector_id, ctx);
    !returned_expressions.is_empty()
        && returned_expressions.into_iter().all(|returned_expression| {
            r3f_callback_state_property_matches(
                returned_expression,
                selector_id,
                property_name,
                ctx,
            )
        })
}

fn r3f_use_three_callback_node_id<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<oxc_semantic::NodeId> {
    use oxc_span::GetSpan;

    let (_, callback_span) = resolve_local_react_callback(expression, ctx)?;
    ctx.nodes().iter().find_map(|candidate| {
        (candidate.span() == callback_span
            && matches!(
                candidate.kind(),
                oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
            ))
        .then_some(candidate.id())
    })
}

fn r3f_use_three_function_return_expressions<'a>(
    function_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'a>,
) -> Vec<&'a oxc_ast::ast::Expression<'a>> {
    if let oxc_ast::AstKind::ArrowFunctionExpression(function) =
        ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        return vec![expression];
    }
    ctx.nodes()
        .iter()
        .filter_map(|candidate| {
            let oxc_ast::AstKind::ReturnStatement(return_statement) = candidate.kind() else {
                return None;
            };
            (local_callback_nearest_function_id(candidate.id(), ctx) == Some(function_id))
                .then(|| return_statement.argument.as_ref())
                .flatten()
        })
        .collect()
}
