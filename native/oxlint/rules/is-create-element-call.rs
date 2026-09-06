fn is_create_element_call(call_expression: &oxc_ast::ast::CallExpression) -> bool {
    match &call_expression.callee {
        oxc_ast::ast::Expression::Identifier(identifier) => identifier.name == "createElement",
        oxc_ast::ast::Expression::StaticMemberExpression(member_expression) => {
            member_expression.property.name == "createElement"
                && !member_chain_contains_document(&member_expression.object)
        }
        oxc_ast::ast::Expression::ComputedMemberExpression(member_expression) => {
            matches!(
                &member_expression.expression,
                oxc_ast::ast::Expression::StringLiteral(property) if property.value == "createElement"
            ) && !member_chain_contains_document(&member_expression.object)
        }
        _ => false,
    }
}

fn member_chain_contains_document(expression: &oxc_ast::ast::Expression) -> bool {
    match expression {
        oxc_ast::ast::Expression::Identifier(identifier) => identifier.name == "document",
        oxc_ast::ast::Expression::StaticMemberExpression(member_expression) => {
            member_expression.property.name == "document"
                || member_chain_contains_document(&member_expression.object)
        }
        oxc_ast::ast::Expression::ComputedMemberExpression(member_expression) => {
            matches!(
                &member_expression.expression,
                oxc_ast::ast::Expression::Identifier(property) if property.name == "document"
            ) || member_chain_contains_document(&member_expression.object)
        }
        _ => false,
    }
}
