fn transparent_expression_root<'a, 'b>(
    mut node: &'b crate::AstNode<'a>,
    ctx: &'b crate::context::LintContext<'a>,
) -> &'b crate::AstNode<'a> {
    loop {
        let parent = ctx.nodes().parent_node(node.id());
        if !matches!(
            parent.kind(),
            oxc_ast::AstKind::ParenthesizedExpression(_)
                | oxc_ast::AstKind::TSAsExpression(_)
                | oxc_ast::AstKind::TSSatisfiesExpression(_)
                | oxc_ast::AstKind::TSTypeAssertion(_)
                | oxc_ast::AstKind::TSNonNullExpression(_)
                | oxc_ast::AstKind::TSInstantiationExpression(_)
                | oxc_ast::AstKind::ChainExpression(_)
        ) {
            return node;
        }
        node = parent;
    }
}
