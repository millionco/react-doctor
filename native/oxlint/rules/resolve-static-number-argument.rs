fn resolve_static_number_argument<'a>(
    argument: Option<&'a oxc_ast::ast::Argument<'a>>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<(&'a oxc_ast::ast::Expression<'a>, f64)> {
    let expression = argument.and_then(oxc_ast::ast::Argument::as_expression)?;
    Some((expression, resolve_static_number(expression, ctx)?))
}
