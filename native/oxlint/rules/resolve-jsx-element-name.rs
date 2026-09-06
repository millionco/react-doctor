fn resolve_jsx_element_name<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
) -> Option<&'a str> {
    match &opening_element.name {
        oxc_ast::ast::JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => {
            Some(identifier.name.as_str())
        }
        oxc_ast::ast::JSXElementName::MemberExpression(member_expression) => {
            Some(member_expression.property.name.as_str())
        }
        _ => None,
    }
}
