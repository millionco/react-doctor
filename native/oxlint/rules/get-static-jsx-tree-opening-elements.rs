fn get_static_jsx_tree_opening_elements<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext,
) -> Option<Vec<&'a oxc_ast::ast::JSXOpeningElement<'a>>> {
    if !is_static_jsx_tree_root(node, ctx) {
        return None;
    }
    let mut opening_elements = Vec::new();
    match node.kind() {
        oxc_ast::AstKind::JSXElement(element) => {
            opening_elements.push(element.opening_element.as_ref());
            collect_static_jsx_opening_elements(&element.children, &mut opening_elements);
        }
        oxc_ast::AstKind::JSXFragment(fragment) => {
            collect_static_jsx_opening_elements(&fragment.children, &mut opening_elements);
        }
        _ => return None,
    }
    Some(opening_elements)
}
