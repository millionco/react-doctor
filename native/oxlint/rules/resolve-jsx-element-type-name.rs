fn resolve_jsx_element_type_name<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> std::borrow::Cow<'a, str> {
    resolve_jsx_element_type(opening_element, ctx).map_or_else(
        || crate::utils::get_jsx_element_name(&opening_element.name),
        |(element_type, _)| std::borrow::Cow::Borrowed(element_type),
    )
}
