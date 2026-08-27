fn is_scoped_react_fragment_element<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    match element_name {
        oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => {
            let Some(import_entry) = resolve_identifier_import(identifier, ctx) else {
                return identifier.name == "Fragment"
                    && ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_none();
            };
            import_entry.module_request.name() == "react"
                && matches!(
                    &import_entry.import_name,
                    crate::module_record::ImportImportName::Name(imported_name)
                        if imported_name.name() == "Fragment"
                )
        }
        oxc_ast::ast::JSXElementName::MemberExpression(member_expression) => {
            if member_expression.property.name != "Fragment" {
                return false;
            }
            let oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return false;
            };
            let Some(import_entry) = resolve_identifier_import(identifier, ctx) else {
                return identifier.name == "React"
                    && ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_none();
            };
            import_entry.module_request.name() == "react"
                && match &import_entry.import_name {
                    crate::module_record::ImportImportName::Default(_)
                    | crate::module_record::ImportImportName::NamespaceObject => true,
                    crate::module_record::ImportImportName::Name(imported_name) => {
                        imported_name.name() == "default"
                    }
                }
        }
        _ => false,
    }
}
