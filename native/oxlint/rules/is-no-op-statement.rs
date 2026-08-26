fn is_no_op_statement(statement: &oxc_ast::ast::Statement<'_>) -> bool {
    match statement {
        oxc_ast::ast::Statement::EmptyStatement(_) => true,
        oxc_ast::ast::Statement::ExpressionStatement(statement) => {
            let expression = statement.expression.get_inner_expression();
            expression.is_literal()
                || matches!(
                    expression,
                    oxc_ast::ast::Expression::Identifier(identifier)
                        if identifier.name == "undefined"
                )
                || matches!(expression, oxc_ast::ast::Expression::UnaryExpression(unary_expression)
                    if is_literal_void_expression(unary_expression))
        }
        _ => false,
    }
}
