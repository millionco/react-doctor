fn global_require_module_source<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'_>,
) -> Option<&'a str> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return global_require_module_source(member_expression.object(), ctx);
    }
    let oxc_ast::ast::Expression::CallExpression(call_expression) = expression else {
        return None;
    };
    let oxc_ast::ast::Expression::Identifier(identifier) =
        call_expression.callee.get_inner_expression()
    else {
        return None;
    };
    if identifier.name != "require"
        || ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some()
    {
        return None;
    }
    call_expression
        .common_js_require()
        .map(|source| source.value.as_str())
}
