fn get_string_literal_attribute_value<'a>(
    attribute: &'a oxc_ast::ast::JSXAttribute<'a>,
) -> Option<&'a str> {
    match attribute.value.as_ref()? {
        oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal) => {
            Some(string_literal.value.as_str())
        }
        oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) => {
            match container.expression.as_expression()?.get_inner_expression() {
                oxc_ast::ast::Expression::StringLiteral(string_literal) => {
                    Some(string_literal.value.as_str())
                }
                oxc_ast::ast::Expression::TemplateLiteral(template_literal)
                    if template_literal.expressions.is_empty()
                        && template_literal.quasis.len() == 1 =>
                {
                    let quasi = &template_literal.quasis[0];
                    Some(
                        quasi
                            .value
                            .cooked
                            .as_ref()
                            .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str()),
                    )
                }
                _ => None,
            }
        }
        _ => None,
    }
}
