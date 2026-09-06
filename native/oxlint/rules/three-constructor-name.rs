fn three_constructor_name<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    constructor_names: &'static [&'static str],
    ctx: &crate::context::LintContext<'a>,
) -> Option<&'static str> {
    let constructor_name = three_constructor_api_name(expression, ctx)?;
    constructor_names
        .iter()
        .copied()
        .find(|expected_name| *expected_name == constructor_name)
}
