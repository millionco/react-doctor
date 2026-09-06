fn static_literal_truthiness(expression: &oxc_ast::ast::Expression<'_>) -> Option<bool> {
    match expression {
        oxc_ast::ast::Expression::BooleanLiteral(literal) => Some(literal.value),
        oxc_ast::ast::Expression::NullLiteral(_) => Some(false),
        oxc_ast::ast::Expression::NumericLiteral(literal) => Some(literal.value != 0.0),
        oxc_ast::ast::Expression::StringLiteral(literal) => Some(!literal.value.is_empty()),
        oxc_ast::ast::Expression::BigIntLiteral(literal) => Some(!literal.is_zero()),
        oxc_ast::ast::Expression::RegExpLiteral(_) => Some(true),
        _ => None,
    }
}
