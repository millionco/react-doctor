fn resolve_const_identifier_root_symbol<'a>(
    mut identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<oxc_semantic::SymbolId> {
    let mut visited_symbol_ids = rustc_hash::FxHashSet::default();
    loop {
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        if !visited_symbol_ids.insert(symbol_id) {
            return None;
        }
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
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return Some(symbol_id);
        }
        let oxc_ast::ast::Expression::Identifier(next_identifier) =
            declarator.init.as_ref()?.get_inner_expression()
        else {
            return Some(symbol_id);
        };
        identifier = next_identifier;
    }
}
