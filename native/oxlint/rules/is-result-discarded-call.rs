fn is_result_discarded_call(
    call_node: &crate::AstNode<'_>,
    are_concise_arrow_returns_discarded: bool,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let mut node = call_node;
    loop {
        let parent = ctx.nodes().parent_node(node.id());
        match parent.kind() {
            oxc_ast::AstKind::ExpressionStatement(_) => return true,
            oxc_ast::AstKind::UnaryExpression(expression)
                if expression.operator == oxc_syntax::operator::UnaryOperator::Void =>
            {
                return true;
            }
            oxc_ast::AstKind::ArrowFunctionExpression(function)
                if function
                    .get_expression()
                    .is_some_and(|expression| expression.span() == node.span()) =>
            {
                return are_concise_arrow_returns_discarded;
            }
            oxc_ast::AstKind::ParenthesizedExpression(_)
            | oxc_ast::AstKind::ChainExpression(_)
            | oxc_ast::AstKind::TSAsExpression(_)
            | oxc_ast::AstKind::TSSatisfiesExpression(_)
            | oxc_ast::AstKind::TSTypeAssertion(_)
            | oxc_ast::AstKind::TSNonNullExpression(_) => node = parent,
            oxc_ast::AstKind::LogicalExpression(expression)
                if expression.right.span() == node.span()
                    || (expression.left.span() == node.span()
                        && expression.operator != oxc_syntax::operator::LogicalOperator::And) =>
            {
                node = parent;
            }
            oxc_ast::AstKind::ConditionalExpression(expression)
                if expression.consequent.span() == node.span()
                    || expression.alternate.span() == node.span() =>
            {
                node = parent;
            }
            oxc_ast::AstKind::SequenceExpression(expression) => {
                if expression
                    .expressions
                    .last()
                    .is_none_or(|last_expression| last_expression.span() != node.span())
                {
                    return true;
                }
                node = parent;
            }
            _ => return false,
        }
    }
}
