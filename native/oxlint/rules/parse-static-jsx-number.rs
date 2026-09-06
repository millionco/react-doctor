fn parse_static_jsx_number(value: &oxc_ast::ast::JSXAttributeValue) -> Option<f64> {
    match value {
        oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal) => {
            parse_finite_number(string_literal.value.as_str())
        }
        oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) => {
            parse_static_expression(container.expression.as_expression()?.get_inner_expression())
        }
        _ => None,
    }
}

fn parse_static_expression(expression: &oxc_ast::ast::Expression) -> Option<f64> {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::NumericLiteral(number_literal) => Some(number_literal.value),
        oxc_ast::ast::Expression::StringLiteral(string_literal) => {
            parse_finite_number(string_literal.value.as_str())
        }
        oxc_ast::ast::Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation =>
        {
            let oxc_ast::ast::Expression::NumericLiteral(number_literal) =
                unary_expression.argument.get_inner_expression()
            else {
                return None;
            };
            Some(-number_literal.value)
        }
        oxc_ast::ast::Expression::TemplateLiteral(template_literal)
            if template_literal.expressions.is_empty() && template_literal.quasis.len() == 1 =>
        {
            let quasi = &template_literal.quasis[0];
            parse_finite_number(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str()),
            )
        }
        oxc_ast::ast::Expression::ConditionalExpression(conditional_expression) => {
            let selected_expression =
                if resolve_static_truthiness(&conditional_expression.test).unwrap_or(true) {
                    &conditional_expression.consequent
                } else {
                    &conditional_expression.alternate
                };
            parse_static_expression(selected_expression)
        }
        _ => None,
    }
}

fn resolve_static_truthiness(expression: &oxc_ast::ast::Expression) -> Option<bool> {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::BooleanLiteral(boolean_literal) => Some(boolean_literal.value),
        oxc_ast::ast::Expression::NullLiteral(_) => Some(false),
        oxc_ast::ast::Expression::NumericLiteral(number_literal) => {
            Some(number_literal.value != 0.0)
        }
        oxc_ast::ast::Expression::StringLiteral(string_literal) => {
            Some(!string_literal.value.is_empty())
        }
        _ => None,
    }
}
