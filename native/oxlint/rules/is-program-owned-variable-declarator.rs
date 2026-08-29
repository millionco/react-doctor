fn is_program_owned_variable_declarator(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    if !matches!(
        declaration.kind(),
        oxc_ast::AstKind::VariableDeclarator(_)
    ) {
        return false;
    }
    let variable_declaration = ctx.nodes().parent_node(declaration.id());
    let mut declaration_parent = ctx.nodes().parent_node(variable_declaration.id());
    if matches!(
        declaration_parent.kind(),
        oxc_ast::AstKind::ExportNamedDeclaration(_)
            | oxc_ast::AstKind::ExportDefaultDeclaration(_)
    ) {
        declaration_parent = ctx.nodes().parent_node(declaration_parent.id());
    }
    matches!(declaration_parent.kind(), oxc_ast::AstKind::Program(_))
}
