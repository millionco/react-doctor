fn imported_module_api_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    expected_api_name: &str,
    expected_module_source: &str,
    ctx: &crate::context::LintContext<'a>,
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
        return ctx.module_record().import_entries.iter().any(|entry| {
            !entry.is_type
                && entry.module_request.name() == expected_module_source
                && ctx
                    .scoping()
                    .get_root_binding(entry.local_name.name().into())
                    == Some(symbol_id)
                && matches!(
                    &entry.import_name,
                    crate::module_record::ImportImportName::Name(imported_name)
                        if imported_name.name() == expected_api_name
                )
        });
    }
    let Some(member_expression) = expression.as_member_expression() else {
        return false;
    };
    if member_expression.static_property_name() != Some(expected_api_name) {
        return false;
    }
    let oxc_ast::ast::Expression::Identifier(identifier) =
        member_expression.object().get_inner_expression()
    else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && entry.module_request.name() == expected_module_source
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
            )
    })
}
