fn resolve_stable_identifier_symbol<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<oxc_semantic::SymbolId> {
    resolve_stable_identifier_symbol_internal(expression, ctx, &mut Vec::new())
}

fn resolve_stable_identifier_symbol_internal<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<oxc_semantic::SymbolId> {
    let oxc_ast::ast::Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return Some(symbol_id);
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Some(symbol_id);
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
        return Some(symbol_id);
    }
    let initializer = declarator.init.as_ref()?;
    if !matches!(
        initializer.get_inner_expression(),
        oxc_ast::ast::Expression::Identifier(_)
    ) {
        return Some(symbol_id);
    }
    resolve_stable_identifier_symbol_internal(initializer, ctx, visited_symbol_ids)
}
