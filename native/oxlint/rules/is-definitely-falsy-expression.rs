fn is_definitely_falsy_expression<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::BooleanLiteral(literal) => !literal.value,
        oxc_ast::ast::Expression::NullLiteral(_) => true,
        oxc_ast::ast::Expression::NumericLiteral(literal) => literal.value == 0.0,
        oxc_ast::ast::Expression::StringLiteral(literal) => literal.value.is_empty(),
        oxc_ast::ast::Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == oxc_syntax::operator::UnaryOperator::Void =>
        {
            true
        }
        oxc_ast::ast::Expression::Identifier(identifier) if identifier.name == "undefined" => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none(),
        _ => false,
    }
}
