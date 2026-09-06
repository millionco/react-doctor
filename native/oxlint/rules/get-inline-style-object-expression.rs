fn get_inline_style_object_expression<'a, 'b>(
    attribute: &'b oxc_ast::ast::JSXAttribute<'a>,
) -> Option<&'b oxc_ast::ast::ObjectExpression<'a>> {
    let oxc_ast::ast::JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
        return None;
    };
    if attribute_name.name != "style" {
        return None;
    }
    let Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
    else {
        return None;
    };
    let oxc_ast::ast::JSXExpression::ObjectExpression(object_expression) = &container.expression
    else {
        return None;
    };
    Some(object_expression)
}
