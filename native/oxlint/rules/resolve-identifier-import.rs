fn resolve_identifier_import<'a, 'b>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &'b crate::context::LintContext<'a>,
) -> Option<&'b crate::module_record::ImportEntry> {
    resolve_identifier_import_internal(identifier, ctx, &mut Vec::new())
}

fn resolve_identifier_import_internal<'a, 'b>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &'b crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<&'b crate::module_record::ImportEntry> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() {
        let parent = ctx.nodes().parent_node(declaration.id());
        let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
            return None;
        };
        if !variable_declaration.kind.is_const()
            || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
        {
            return None;
        }
        let Some(oxc_ast::ast::Expression::Identifier(next_identifier)) = declarator
            .init
            .as_ref()
            .map(oxc_ast::ast::Expression::get_inner_expression)
        else {
            return None;
        };
        return resolve_identifier_import_internal(next_identifier, ctx, visited_symbol_ids);
    }
    ctx.module_record().import_entries.iter().find(|entry| {
        !entry.is_type
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}
