pub fn for_each_value_import(
    import_declaration: &oxc_ast::ast::ImportDeclaration<'_>,
    mut visit: impl FnMut(&oxc_ast::ast::ImportSpecifier<'_>),
) {
    if import_declaration.import_kind.is_type() {
        return;
    }
    let Some(specifiers) = &import_declaration.specifiers else {
        return;
    };
    for specifier in specifiers {
        let oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(import_specifier) = specifier
        else {
            continue;
        };
        if import_specifier.import_kind.is_value() {
            visit(import_specifier);
        }
    }
}
