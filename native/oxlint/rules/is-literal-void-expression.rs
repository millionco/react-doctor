fn is_literal_void_expression(unary_expression: &oxc_ast::ast::UnaryExpression) -> bool {
    unary_expression.operator == oxc_syntax::operator::UnaryOperator::Void
        && unary_expression
            .argument
            .get_inner_expression()
            .is_literal()
}
