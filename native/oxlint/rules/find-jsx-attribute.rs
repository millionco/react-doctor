fn find_jsx_attribute<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    target_name: &str,
) -> Option<&'b oxc_ast::ast::JSXAttribute<'a>> {
    opening_element.attributes.iter().find_map(|attribute| {
        let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
            return None;
        };
        matches!(
            &attribute.name,
            oxc_ast::ast::JSXAttributeName::Identifier(identifier)
                if identifier.name == target_name
        )
        .then_some(attribute.as_ref())
    })
}
