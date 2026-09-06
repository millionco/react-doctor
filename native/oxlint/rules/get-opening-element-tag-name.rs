fn get_opening_element_tag_name<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<&'a str> {
    match &opening_element.name {
        oxc_ast::ast::JSXElementName::MemberExpression(member_expression) => {
            Some(member_expression.property.name.as_str())
        }
        _ => resolve_jsx_element_type(opening_element, ctx).map(|(tag_name, _)| tag_name),
    }
}
