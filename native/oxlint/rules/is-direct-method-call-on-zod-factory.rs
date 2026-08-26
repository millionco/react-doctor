fn is_direct_method_call_on_zod_factory<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    factory_names: &[&'static str],
    method_names: &[&str],
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(method_member) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if !method_member
        .static_property_name()
        .is_some_and(|method_name| method_names.contains(&method_name))
    {
        return false;
    }
    matches!(
        method_member.object().get_inner_expression(),
        oxc_ast::ast::Expression::CallExpression(factory_call)
            if direct_zod_factory_call_name(factory_call, factory_names, ctx).is_some()
    )
}
