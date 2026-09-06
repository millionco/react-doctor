fn jsx_element_name_trailing_segment<'a>(
    element_name: &'a oxc_ast::ast::JSXElementName<'a>,
) -> Option<&'a str> {
    match element_name {
        oxc_ast::ast::JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => {
            Some(identifier.name.as_str())
        }
        oxc_ast::ast::JSXElementName::MemberExpression(member_expression) => {
            Some(member_expression.property.name.as_str())
        }
        oxc_ast::ast::JSXElementName::NamespacedName(namespaced_name) => {
            Some(namespaced_name.name.name.as_str())
        }
        oxc_ast::ast::JSXElementName::ThisExpression(_) => None,
    }
}
