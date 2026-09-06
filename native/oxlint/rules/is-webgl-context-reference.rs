fn is_webgl_context_reference<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    is_context_from_get_context(expression, &["experimental-webgl", "webgl", "webgl2"], ctx)
}
