fn collect_static_jsx_opening_elements<'a>(
    children: &'a [oxc_ast::ast::JSXChild<'a>],
    opening_elements: &mut Vec<&'a oxc_ast::ast::JSXOpeningElement<'a>>,
) {
    for child in children {
        match child {
            oxc_ast::ast::JSXChild::Element(element) => {
                opening_elements.push(&element.opening_element);
                collect_static_jsx_opening_elements(&element.children, opening_elements);
            }
            oxc_ast::ast::JSXChild::Fragment(fragment) => {
                collect_static_jsx_opening_elements(&fragment.children, opening_elements);
            }
            _ => {}
        }
    }
}
