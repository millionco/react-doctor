pub fn is_type_only_import(import_declaration: &oxc_ast::ast::ImportDeclaration<'_>) -> bool {
    if import_declaration.import_kind.is_type() {
        return true;
    }
    let Some(specifiers) = &import_declaration.specifiers else {
        return false;
    };
    !specifiers.is_empty()
        && specifiers.iter().all(|specifier| {
            matches!(
                specifier,
                oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(import_specifier)
                    if import_specifier.import_kind.is_type()
            )
        })
}
