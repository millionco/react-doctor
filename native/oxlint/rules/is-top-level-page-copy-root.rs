fn is_top_level_page_copy_root(
    element: &oxc_ast::ast::JSXElement,
    node: &crate::AstNode,
    ctx: &crate::context::LintContext,
) -> bool {
    if !is_page_copy_root(element) {
        return false;
    }
    !ctx.nodes().ancestors(node.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            oxc_ast::AstKind::JSXElement(ancestor_element) if is_page_copy_root(ancestor_element)
        )
    })
}

fn is_page_copy_root(element: &oxc_ast::ast::JSXElement) -> bool {
    matches!(
        &element.opening_element.name,
        oxc_ast::ast::JSXElementName::Identifier(identifier)
            if identifier.name == "article" || identifier.name == "main"
    )
}
