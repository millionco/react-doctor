const THREE_MODULE_SOURCES: [&str; 3] = ["three", "three-stdlib", "three/webgpu"];

fn three_constructor_name<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    constructor_names: &'static [&'static str],
    ctx: &crate::context::LintContext<'a>,
) -> Option<&'static str> {
    three_constructor_name_internal(expression, constructor_names, ctx, &mut Vec::new())
}

fn three_constructor_name_internal<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    constructor_names: &'static [&'static str],
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<&'static str> {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::NewExpression(new_expression) = expression {
        return constructor_names.iter().copied().find(|constructor_name| {
            module_api_path_matches(
                &new_expression.callee,
                &[*constructor_name],
                &THREE_MODULE_SOURCES,
                false,
                ctx,
            )
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
    three_constructor_name_internal(
        declarator.init.as_ref()?,
        constructor_names,
        ctx,
        visited_symbol_ids,
    )
}
