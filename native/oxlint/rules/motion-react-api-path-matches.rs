const MOTION_REACT_MODULE_SOURCES: [&str; 4] = [
    "framer-motion",
    "framer-motion/client",
    "motion/react",
    "motion/react-client",
];

fn motion_react_api_path_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    expected_path: &[&str],
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    motion_react_api_path_matches_internal(expression, expected_path, ctx, &mut Vec::new())
}

fn motion_react_api_path_matches_internal<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    expected_path: &[&str],
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        let Some((expected_property, expected_receiver_path)) = expected_path.split_last() else {
            return false;
        };
        return member_expression.static_property_name() == Some(*expected_property)
            && motion_react_api_path_matches_internal(
                member_expression.object(),
                expected_receiver_path,
                ctx,
                visited_symbol_ids,
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
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() {
        let parent = ctx.nodes().parent_node(declaration.id());
        if let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind()
            && variable_declaration.kind.is_const()
            && declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
            && let Some(initializer) = &declarator.init
        {
            return motion_react_api_path_matches_internal(
                initializer,
                expected_path,
                ctx,
                visited_symbol_ids,
            );
        }
        return false;
    }
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && MOTION_REACT_MODULE_SOURCES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && match &entry.import_name {
                crate::module_record::ImportImportName::NamespaceObject => expected_path.is_empty(),
                crate::module_record::ImportImportName::Name(imported_name) => {
                    expected_path == [imported_name.name()]
                }
                crate::module_record::ImportImportName::Default(_) => false,
            }
    })
}
