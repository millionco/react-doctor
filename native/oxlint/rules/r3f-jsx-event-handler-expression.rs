fn r3f_jsx_event_handler_expression<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    event_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> Option<&'b oxc_ast::ast::Expression<'a>> {
    if !is_r3f_host_intrinsic(opening_element, ctx) {
        return None;
    }
    get_authoritative_jsx_attribute(opening_element, event_name, true)
        .and_then(|attribute| jsx_attribute_expression(attribute))
}
