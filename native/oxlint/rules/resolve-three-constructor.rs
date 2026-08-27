struct ResolvedThreeConstructor<'a, 'b> {
    constructor_name: String,
    node: &'b oxc_ast::ast::NewExpression<'a>,
}

fn resolve_three_constructor<'a, 'b>(
    expression: &'b oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<ResolvedThreeConstructor<'a, 'b>> {
    resolve_three_constructor_inner(expression, ctx, &mut Vec::new())
}

fn resolve_three_constructor_inner<'a, 'b>(
    expression: &'b oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<ResolvedThreeConstructor<'a, 'b>> {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::NewExpression(new_expression) = expression {
        return Some(ResolvedThreeConstructor {
            constructor_name: three_module_api_name(&new_expression.callee, ctx)?,
            node: new_expression,
        });
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
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
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
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
        return None;
    }
    resolve_three_constructor_inner(declarator.init.as_ref()?, ctx, visited_symbol_ids)
}
