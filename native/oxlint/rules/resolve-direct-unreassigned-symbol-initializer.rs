fn resolve_direct_unreassigned_symbol_initializer<'a>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'a>,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    let parent = ctx.nodes().parent_node(declaration.id());
    let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return None;
    };
    if !variable_declaration.kind.is_const()
        && ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    declarator.init.as_ref()
}
