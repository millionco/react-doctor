fn is_context_from_get_context<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    context_names: &[&str],
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    is_context_from_get_context_inner(expression, context_names, ctx, &mut Vec::new())
}

fn is_context_from_get_context_inner<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    context_names: &[&str],
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::Identifier(identifier) = expression {
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
        return matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) && binding_pattern_initializer_for_symbol(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        )
        .is_some_and(|initializer| {
            is_context_from_get_context_inner(initializer, context_names, ctx, visited_symbol_ids)
        });
    }
    let oxc_ast::ast::Expression::CallExpression(call_expression) = expression else {
        return false;
    };
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    if static_member_expression_property_name(member_expression) != Some("getContext") {
        return false;
    }
    let Some(oxc_ast::ast::Expression::StringLiteral(context_name)) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .map(oxc_ast::ast::Expression::get_inner_expression)
    else {
        return false;
    };
    context_names.contains(&context_name.value.as_str())
}
