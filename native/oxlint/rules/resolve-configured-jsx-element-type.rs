fn resolve_configured_jsx_element_type<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> String {
    let base_element_type = resolve_jsx_element_type(opening_element, ctx).map_or_else(
        || crate::utils::get_jsx_element_name(&opening_element.name),
        |(element_type, _)| std::borrow::Cow::Borrowed(element_type),
    );
    let settings = &ctx.settings().jsx_a11y;
    if let Some(polymorphic_element_type) = settings
        .polymorphic_prop_name
        .as_ref()
        .and_then(|property_name| {
            crate::utils::has_jsx_prop_ignore_case(opening_element, property_name)
        })
        .and_then(crate::utils::get_string_literal_prop_value)
    {
        return polymorphic_element_type.to_string();
    }
    settings
        .components
        .get(base_element_type.as_ref())
        .map_or_else(|| base_element_type.into_owned(), ToString::to_string)
}
