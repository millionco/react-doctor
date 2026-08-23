fn is_static_jsx_tree_root(
    node: &crate::AstNode,
    ctx: &crate::context::LintContext,
) -> bool {
    let mut has_jsx_ancestor = false;
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        match ancestor.kind() {
            oxc_ast::AstKind::JSXExpressionContainer(_) => return false,
            oxc_ast::AstKind::JSXElement(_) | oxc_ast::AstKind::JSXFragment(_) => {
                has_jsx_ancestor = true;
            }
            _ => {}
        }
    }
    !has_jsx_ancestor
}
