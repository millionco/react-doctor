fn is_react_es6_component(node: &crate::AstNode<'_>) -> bool {
    let oxc_ast::AstKind::Class(class) = node.kind() else {
        return false;
    };
    let Some(heritage) = &class.heritage else {
        return false;
    };
    match &heritage.expression {
        oxc_ast::ast::Expression::Identifier(identifier) => {
            matches!(identifier.name.as_str(), "Component" | "PureComponent")
        }
        oxc_ast::ast::Expression::StaticMemberExpression(member_expression) => {
            matches!(
                &member_expression.object,
                oxc_ast::ast::Expression::Identifier(identifier) if identifier.name == "React"
            ) && matches!(
                member_expression.property.name.as_str(),
                "Component" | "PureComponent"
            )
        }
        oxc_ast::ast::Expression::ComputedMemberExpression(member_expression) => {
            matches!(
                &member_expression.object,
                oxc_ast::ast::Expression::Identifier(identifier) if identifier.name == "React"
            ) && matches!(
                &member_expression.expression,
                oxc_ast::ast::Expression::Identifier(identifier)
                    if matches!(identifier.name.as_str(), "Component" | "PureComponent")
            )
        }
        _ => false,
    }
}
