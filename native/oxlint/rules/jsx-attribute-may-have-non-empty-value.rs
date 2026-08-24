fn jsx_attribute_may_have_non_empty_value<'a>(
    attribute: Option<&oxc_ast::ast::JSXAttribute<'a>>,
    boolean_values_render: bool,
    ctx: Option<&crate::context::LintContext<'a>>,
) -> bool {
    let Some(value) = attribute.and_then(|attribute| attribute.value.as_ref()) else {
        return false;
    };
    match value {
        oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal) => {
            !string_literal.value.trim().is_empty()
        }
        oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .is_some_and(|expression| match expression.get_inner_expression() {
                oxc_ast::ast::Expression::BooleanLiteral(_) => boolean_values_render,
                oxc_ast::ast::Expression::NumericLiteral(_) => true,
                oxc_ast::ast::Expression::StringLiteral(string_literal) => {
                    !string_literal.value.trim().is_empty()
                }
                oxc_ast::ast::Expression::Identifier(identifier)
                    if identifier.name == "undefined"
                        && ctx.is_some_and(|ctx| {
                            ctx.scoping()
                                .get_reference(identifier.reference_id())
                                .symbol_id()
                                .is_none()
                        }) =>
                {
                    false
                }
                oxc_ast::ast::Expression::UnaryExpression(unary_expression) => {
                    !is_literal_void_expression(unary_expression)
                }
                _ => true,
            }),
        _ => true,
    }
}
