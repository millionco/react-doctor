const THREE_MODULE_SOURCES: [&str; 3] = ["three", "three-stdlib", "three/"];

fn three_module_api_path_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    expected_path: &[&str],
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    module_api_path_matches(expression, expected_path, &THREE_MODULE_SOURCES, false, ctx)
}
