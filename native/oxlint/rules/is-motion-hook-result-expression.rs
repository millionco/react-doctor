fn is_motion_hook_result_expression<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    hook_names: &[&str],
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    is_motion_hook_result_expression_internal(expression, hook_names, ctx, &mut Vec::new())
}

fn is_motion_hook_result_expression_internal<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    hook_names: &[&str],
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::CallExpression(call_expression) = expression {
        return hook_names.iter().any(|hook_name| {
            motion_react_api_path_matches(&call_expression.callee, &[*hook_name], ctx)
        });
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
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(
        parent.kind(),
        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return false;
    }
    declarator.init.as_ref().is_some_and(|initializer| {
        is_motion_hook_result_expression_internal(initializer, hook_names, ctx, visited_symbol_ids)
    })
}
