fn is_jsx_attribute_potentially_truthy(
    attribute: Option<&oxc_ast::ast::JSXAttributeItem<'_>>,
) -> bool {
    let Some(oxc_ast::ast::JSXAttributeItem::Attribute(attribute)) = attribute else {
        return false;
    };
    let Some(value) = &attribute.value else {
        return true;
    };
    let oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) = value else {
        return true;
    };
    let Some(expression) = container.expression.as_expression() else {
        return true;
    };
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::BooleanLiteral(literal) => literal.value,
        oxc_ast::ast::Expression::NullLiteral(_) => false,
        oxc_ast::ast::Expression::UnaryExpression(unary_expression)
            if is_literal_void_expression(unary_expression) =>
        {
            false
        }
        _ => true,
    }
}
