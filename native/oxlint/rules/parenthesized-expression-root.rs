fn parenthesized_expression_root<'a, 'ctx>(
    mut node: &'ctx crate::AstNode<'a>,
    ctx: &'ctx crate::context::LintContext<'a>,
) -> &'ctx crate::AstNode<'a> {
    loop {
        let parent = ctx.nodes().parent_node(node.id());
        if !matches!(parent.kind(), oxc_ast::AstKind::ParenthesizedExpression(_)) {
            return node;
        }
        node = parent;
    }
}
