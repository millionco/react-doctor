fn is_inside_navigation(node: &crate::AstNode, ctx: &crate::context::LintContext) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        let oxc_ast::AstKind::JSXElement(element) = ancestor.kind() else {
            return false;
        };
        if matches!(
            &element.opening_element.name,
            oxc_ast::ast::JSXElementName::Identifier(identifier)
                if identifier.name == "nav" || identifier.name == "aside"
        ) {
            return true;
        }
        element
            .opening_element
            .attributes
            .iter()
            .find_map(|attribute| {
                let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
                    return None;
                };
                matches!(
                    &attribute.name,
                    oxc_ast::ast::JSXAttributeName::Identifier(identifier)
                        if identifier.name.eq_ignore_ascii_case("role")
                )
                .then_some(attribute.as_ref())
            })
            .and_then(|attribute| get_string_literal_attribute_value(attribute))
            .is_some_and(|role| role.eq_ignore_ascii_case("navigation"))
    })
}
