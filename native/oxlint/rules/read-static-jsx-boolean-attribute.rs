fn read_static_jsx_boolean_attribute(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> Option<bool> {
    let Some(value) = &attribute.value else {
        return Some(true);
    };
    let oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) = value else {
        return None;
    };
    let expression = container.expression.as_expression()?;
    let oxc_ast::ast::Expression::BooleanLiteral(boolean_literal) =
        expression.get_inner_expression()
    else {
        return None;
    };
    Some(boolean_literal.value)
}
