fn get_static_style_property_number_value(property: &oxc_ast::ast::ObjectProperty) -> Option<f64> {
    match &property.value {
        oxc_ast::ast::Expression::NumericLiteral(number) => Some(number.value),
        oxc_ast::ast::Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation =>
        {
            match unary.argument.get_inner_expression() {
                oxc_ast::ast::Expression::NumericLiteral(number) => Some(-number.value),
                _ => None,
            }
        }
        _ => None,
    }
}
