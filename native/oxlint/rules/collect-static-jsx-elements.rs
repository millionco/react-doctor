fn collect_static_jsx_elements<'a>(
    element: &'a oxc_ast::ast::JSXElement<'a>,
    elements: &mut Vec<&'a oxc_ast::ast::JSXElement<'a>>,
) {
    elements.push(element);
    collect_static_jsx_child_elements(&element.children, elements);
}

fn collect_static_jsx_child_elements<'a>(
    children: &'a [oxc_ast::ast::JSXChild<'a>],
    elements: &mut Vec<&'a oxc_ast::ast::JSXElement<'a>>,
) {
    for child in children {
        match child {
            oxc_ast::ast::JSXChild::Element(element) => {
                collect_static_jsx_elements(element, elements);
            }
            oxc_ast::ast::JSXChild::Fragment(fragment) => {
                collect_static_jsx_child_elements(&fragment.children, elements);
            }
            _ => {}
        }
    }
}
