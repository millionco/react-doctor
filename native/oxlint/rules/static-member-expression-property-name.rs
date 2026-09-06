fn static_member_expression_property_name<'a>(
    member_expression: &'a oxc_ast::ast::MemberExpression<'a>,
) -> Option<&'a str> {
    match member_expression {
        oxc_ast::ast::MemberExpression::StaticMemberExpression(member) => {
            Some(member.property.name.as_str())
        }
        oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) => {
            match member.expression.get_inner_expression() {
                oxc_ast::ast::Expression::StringLiteral(literal) => Some(literal.value.as_str()),
                oxc_ast::ast::Expression::TemplateLiteral(template)
                    if template.expressions.is_empty() =>
                {
                    template.quasis.first().map(|quasi| {
                        quasi
                            .value
                            .cooked
                            .as_ref()
                            .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    })
                }
                _ => None,
            }
        }
        oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => None,
    }
}
