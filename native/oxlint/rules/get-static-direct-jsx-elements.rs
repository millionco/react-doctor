fn get_static_direct_jsx_elements<'a, 'b>(
    element: &'b oxc_ast::ast::JSXElement<'a>,
) -> Vec<&'b oxc_ast::ast::JSXElement<'a>> {
    element
        .children
        .iter()
        .filter_map(|child| match child {
            oxc_ast::ast::JSXChild::Element(element) => Some(element.as_ref()),
            _ => None,
        })
        .collect()
}
