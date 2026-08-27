fn resolve_configured_jsx_element_type<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> String {
    let Some((base_element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
        return crate::utils::get_element_type(ctx, opening_element).into_owned();
    };
    let settings = &ctx.settings().jsx_a11y;
    let raw_element_type = settings
        .polymorphic_prop_name
        .as_ref()
        .and_then(|property_name| {
            crate::utils::has_jsx_prop_ignore_case(opening_element, property_name)
        })
        .and_then(crate::utils::get_string_literal_prop_value)
        .unwrap_or(base_element_type);
    settings
        .components
        .get(raw_element_type)
        .map_or_else(|| raw_element_type.to_string(), ToString::to_string)
}
