fn get_next_static_jsx_element_sibling<'a>(
    element: &'a oxc_ast::ast::JSXElement<'a>,
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<&'a oxc_ast::ast::JSXElement<'a>> {
    match ctx.nodes().parent_node(node.id()).kind() {
        oxc_ast::AstKind::JSXElement(parent) => {
            find_next_static_jsx_element_sibling(element, &parent.children)
        }
        oxc_ast::AstKind::JSXFragment(parent) => {
            find_next_static_jsx_element_sibling(element, &parent.children)
        }
        _ => None,
    }
}

fn find_next_static_jsx_element_sibling<'a>(
    element: &oxc_ast::ast::JSXElement<'a>,
    siblings: &'a [oxc_ast::ast::JSXChild<'a>],
) -> Option<&'a oxc_ast::ast::JSXElement<'a>> {
    let mut did_find_element = false;
    for sibling in siblings {
        if !did_find_element {
            if let oxc_ast::ast::JSXChild::Element(sibling_element) = sibling
                && std::ptr::eq(sibling_element.as_ref(), element)
            {
                did_find_element = true;
            }
            continue;
        }
        match sibling {
            oxc_ast::ast::JSXChild::Text(text) if text.value.chars().all(is_js_whitespace) => {}
            oxc_ast::ast::JSXChild::Element(sibling_element) => return Some(sibling_element),
            _ => return None,
        }
    }
    None
}
