fn resolve_imported_jsx_component_name<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    module_source: &str,
    ctx: &'b crate::context::LintContext<'a>,
) -> Option<&'b str> {
    match &opening_element.name {
        oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let import_entry = ctx.module_record().import_entries.iter().find(|entry| {
                !entry.is_type
                    && entry.module_request.name() == module_source
                    && ctx
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == Some(symbol_id)
            })?;
            match &import_entry.import_name {
                crate::module_record::ImportImportName::Name(imported_name) => {
                    Some(imported_name.name())
                }
                crate::module_record::ImportImportName::Default(_) => Some("default"),
                crate::module_record::ImportImportName::NamespaceObject => None,
            }
        }
        oxc_ast::ast::JSXElementName::MemberExpression(member_expression) => {
            let oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return None;
            };
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            ctx.module_record()
                .import_entries
                .iter()
                .any(|entry| {
                    !entry.is_type
                        && entry.module_request.name() == module_source
                        && matches!(
                            &entry.import_name,
                            crate::module_record::ImportImportName::NamespaceObject
                        )
                        && ctx
                            .scoping()
                            .get_root_binding(entry.local_name.name().into())
                            == Some(symbol_id)
                })
                .then_some(member_expression.property.name.as_str())
        }
        _ => None,
    }
}
