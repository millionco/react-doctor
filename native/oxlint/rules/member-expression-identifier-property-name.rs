fn member_expression_identifier_property_name<'a>(
    member_expression: &'a oxc_ast::ast::MemberExpression<'a>,
) -> Option<&'a str> {
    match member_expression {
        oxc_ast::ast::MemberExpression::StaticMemberExpression(member_expression) => {
            Some(member_expression.property.name.as_str())
        }
        oxc_ast::ast::MemberExpression::ComputedMemberExpression(member_expression) => {
            match &member_expression.expression {
                oxc_ast::ast::Expression::Identifier(identifier) => Some(identifier.name.as_str()),
                _ => None,
            }
        }
        oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => None,
    }
}
