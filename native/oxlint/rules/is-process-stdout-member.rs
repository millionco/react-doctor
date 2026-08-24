fn is_process_stdout_member<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(member_expression) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    member_expression.static_property_name() == Some("stdout")
        && is_proven_global_namespace_reference(member_expression.object(), "process", ctx)
}
