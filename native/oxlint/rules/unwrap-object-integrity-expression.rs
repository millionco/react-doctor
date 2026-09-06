fn unwrap_object_integrity_expression<'a, 'b>(
    expression: &'b oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    method_names: &[&str],
) -> &'b oxc_ast::ast::Expression<'a> {
    let mut current = expression.get_inner_expression();
    loop {
        let oxc_ast::ast::Expression::CallExpression(call_expression) = current else {
            return current;
        };
        let oxc_ast::ast::Expression::StaticMemberExpression(member_expression) =
            call_expression.callee.get_inner_expression()
        else {
            return current;
        };
        let oxc_ast::ast::Expression::Identifier(receiver) =
            member_expression.object.get_inner_expression()
        else {
            return current;
        };
        if receiver.name != "Object"
            || ctx
                .scoping()
                .get_reference(receiver.reference_id())
                .symbol_id()
                .is_some()
            || !method_names.contains(&member_expression.property.name.as_str())
        {
            return current;
        }
        let Some(wrapped_expression) = call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return current;
        };
        current = wrapped_expression.get_inner_expression();
    }
}
