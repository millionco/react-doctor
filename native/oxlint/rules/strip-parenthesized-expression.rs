fn strip_parenthesized_expression<'a>(
    mut expression: &'a oxc_ast::ast::Expression<'a>,
) -> &'a oxc_ast::ast::Expression<'a> {
    while let oxc_ast::ast::Expression::ParenthesizedExpression(parenthesized_expression) =
        expression
    {
        expression = &parenthesized_expression.expression;
    }
    expression
}
