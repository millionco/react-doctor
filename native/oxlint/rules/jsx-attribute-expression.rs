fn jsx_attribute_expression<'a, 'b>(
    attribute: &'b oxc_ast::ast::JSXAttribute<'a>,
) -> Option<&'b oxc_ast::ast::Expression<'a>> {
    let oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) = attribute.value.as_ref()?
    else {
        return None;
    };
    container.expression.as_expression()
}
