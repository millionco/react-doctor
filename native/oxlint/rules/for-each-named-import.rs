pub fn for_each_named_import(
    import_declaration: &oxc_ast::ast::ImportDeclaration<'_>,
    mut visit: impl FnMut(&oxc_ast::ast::ImportSpecifier<'_>),
) {
    let Some(specifiers) = &import_declaration.specifiers else {
        return;
    };
    for specifier in specifiers {
        if let oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(import_specifier) =
            specifier
        {
            visit(import_specifier);
        }
    }
}
