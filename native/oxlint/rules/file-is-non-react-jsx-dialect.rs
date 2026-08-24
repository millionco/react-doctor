fn file_is_non_react_jsx_dialect(ctx: &crate::context::LintContext<'_>) -> bool {
    let mut has_non_react_runtime = false;
    let mut has_react_runtime = false;
    let mut has_non_react_marker = false;
    for node in ctx.nodes().iter() {
        match node.kind() {
            oxc_ast::AstKind::ImportDeclaration(declaration)
                if !is_type_only_import(declaration) =>
            {
                let module_name = declaration.source.value.as_str();
                has_non_react_runtime |= is_non_react_jsx_runtime(module_name);
                has_react_runtime |= is_react_jsx_runtime(module_name);
            }
            oxc_ast::AstKind::JSXOpeningElement(opening_element) => {
                has_non_react_marker |= opening_element.attributes.iter().any(|attribute| {
                    let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
                        return false;
                    };
                    match &attribute.name {
                        oxc_ast::ast::JSXAttributeName::Identifier(identifier) => {
                            let attribute_name = identifier.name.as_str();
                            attribute_name.starts_with("class:")
                                || attribute_name.starts_with("bind:")
                                || (attribute_name == "classList"
                                    && matches!(
                                        &attribute.value,
                                        Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(
                                            container
                                        )) if matches!(
                                            container.expression.as_expression(),
                                            Some(oxc_ast::ast::Expression::ObjectExpression(_))
                                        )
                                    ))
                        }
                        oxc_ast::ast::JSXAttributeName::NamespacedName(namespaced_name) => {
                            matches!(namespaced_name.namespace.name.as_str(), "class" | "bind")
                        }
                    }
                });
            }
            _ => {}
        }
    }
    !has_react_runtime && (has_non_react_runtime || has_non_react_marker)
}

fn is_non_react_jsx_runtime(module_name: &str) -> bool {
    module_name == "voby"
        || module_name == "vidode"
        || module_name == "solid-js"
        || module_name.starts_with("solid-js/")
        || module_name == "@builder.io/qwik"
        || module_name == "@builder.io/qwik-city"
        || module_name == "@builder.io/qwik-react"
        || module_name.starts_with("@builder.io/qwik/")
}

fn is_react_jsx_runtime(module_name: &str) -> bool {
    ["react", "react-dom", "preact"].iter().any(|runtime| {
        module_name == *runtime
            || module_name
                .strip_prefix(runtime)
                .is_some_and(|suffix| suffix.starts_with('/'))
    })
}
