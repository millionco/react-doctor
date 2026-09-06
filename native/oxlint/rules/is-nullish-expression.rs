fn is_nullish_expression(expression: &oxc_ast::ast::Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::NullLiteral(_) => true,
        oxc_ast::ast::Expression::Identifier(identifier) => identifier.name == "undefined",
        oxc_ast::ast::Expression::UnaryExpression(unary_expression) => {
            unary_expression.operator == oxc_syntax::operator::UnaryOperator::Void
        }
        _ => false,
    }
}
