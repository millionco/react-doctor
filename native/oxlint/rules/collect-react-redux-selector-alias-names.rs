fn collect_react_redux_selector_alias_names(
    program: &oxc_ast::ast::Program<'_>,
) -> (std::collections::HashSet<String>, bool) {
    let mut aliases = std::collections::HashSet::new();
    let mut has_fallback_import = false;
    for statement in &program.body {
        let oxc_ast::ast::Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.source.value != "react-redux" {
            continue;
        }
        has_fallback_import |= declaration.specifiers.iter().flatten().any(|specifier| {
            let local_name = match specifier {
                oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                    &specifier.local.name
                }
                oxc_ast::ast::ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                    &specifier.local.name
                }
                oxc_ast::ast::ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                    &specifier.local.name
                }
            };
            local_name == "useSelector"
        });
        for_each_named_import(declaration, |specifier| {
            if specifier.imported.name() == "useSelector" {
                aliases.insert(specifier.local.name.to_string());
            }
        });
    }
    for statement in &program.body {
        let declaration = match statement {
            oxc_ast::ast::Statement::VariableDeclaration(declaration) => Some(declaration.as_ref()),
            oxc_ast::ast::Statement::ExportDeclaration(export) => match &export.declaration {
                oxc_ast::ast::Declaration::VariableDeclaration(declaration) => {
                    Some(declaration.as_ref())
                }
                _ => None,
            },
            _ => None,
        };
        let Some(declaration) = declaration else {
            continue;
        };
        for declarator in &declaration.declarations {
            let oxc_ast::ast::BindingPattern::BindingIdentifier(binding) = &declarator.id else {
                continue;
            };
            let Some(oxc_ast::ast::Expression::Identifier(initializer)) = declarator
                .init
                .as_ref()
                .map(oxc_ast::ast::Expression::get_inner_expression)
            else {
                continue;
            };
            if aliases.contains(initializer.name.as_str()) {
                aliases.insert(binding.name.to_string());
            }
        }
    }
    (aliases, has_fallback_import)
}
