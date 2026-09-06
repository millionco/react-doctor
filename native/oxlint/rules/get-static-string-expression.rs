fn get_static_string_expression<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
) -> Option<&'a str> {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::StringLiteral(string_literal) => {
            Some(string_literal.value.as_str())
        }
        oxc_ast::ast::Expression::TemplateLiteral(template_literal)
            if template_literal.expressions.is_empty() && template_literal.quasis.len() == 1 =>
        {
            let quasi = &template_literal.quasis[0];
            Some(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str()),
            )
        }
        _ => None,
    }
}
