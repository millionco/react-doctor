fn get_static_class_name<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
) -> Option<&'a str> {
    let attribute = get_authoritative_jsx_attribute(opening_element, "className", true)?;
    match attribute.value.as_ref()? {
        oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal) => {
            Some(string_literal.value.as_str())
        }
        oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) => {
            match container.expression.as_expression()? {
                oxc_ast::ast::Expression::StringLiteral(string_literal) => {
                    Some(string_literal.value.as_str())
                }
                oxc_ast::ast::Expression::TemplateLiteral(template_literal)
                    if template_literal.expressions.is_empty()
                        && template_literal.quasis.len() == 1 =>
                {
                    Some(template_literal.quasis[0].value.raw.as_str())
                }
                _ => None,
            }
        }
        _ => None,
    }
}
