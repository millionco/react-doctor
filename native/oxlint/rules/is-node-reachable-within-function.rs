fn is_node_reachable_within_function(
    node: &crate::AstNode<'_>,
    function_node: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    if is_inside_statically_unreachable_branch(node, ctx) {
        return false;
    }
    cfg_block_can_reach(
        ctx.nodes().cfg_id(function_node.id()),
        ctx.nodes().cfg_id(node.id()),
        &rustc_hash::FxHashSet::default(),
        ctx,
    )
}

fn is_inside_statically_unreachable_branch(
    node: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let mut child = node;
    loop {
        let parent = ctx.nodes().parent_node(child.id());
        let child_span = oxc_span::GetSpan::span(child);
        match parent.kind() {
            oxc_ast::AstKind::IfStatement(statement) => {
                if let oxc_ast::ast::Expression::BooleanLiteral(test) = &statement.test {
                    if (!test.value
                        && oxc_span::GetSpan::span(&statement.consequent) == child_span)
                        || (test.value
                            && statement.alternate.as_ref().is_some_and(|alternate| {
                                oxc_span::GetSpan::span(alternate) == child_span
                            }))
                    {
                        return true;
                    }
                }
            }
            oxc_ast::AstKind::ConditionalExpression(expression) => {
                if let oxc_ast::ast::Expression::BooleanLiteral(test) = &expression.test {
                    if (!test.value
                        && oxc_span::GetSpan::span(&expression.consequent) == child_span)
                        || (test.value
                            && oxc_span::GetSpan::span(&expression.alternate) == child_span)
                    {
                        return true;
                    }
                }
            }
            oxc_ast::AstKind::WhileStatement(statement) => {
                if oxc_span::GetSpan::span(&statement.body) == child_span
                    && static_literal_truthiness(&statement.test) == Some(false)
                {
                    return true;
                }
            }
            oxc_ast::AstKind::ForStatement(statement) => {
                if oxc_span::GetSpan::span(&statement.body) == child_span
                    && statement
                        .test
                        .as_ref()
                        .is_some_and(|test| static_literal_truthiness(test) == Some(false))
                {
                    return true;
                }
            }
            oxc_ast::AstKind::LogicalExpression(expression)
                if oxc_span::GetSpan::span(&expression.right) == child_span =>
            {
                let left_truthiness = static_literal_truthiness(&expression.left);
                if (expression.operator == oxc_syntax::operator::LogicalOperator::And
                    && left_truthiness == Some(false))
                    || (expression.operator == oxc_syntax::operator::LogicalOperator::Or
                        && left_truthiness == Some(true))
                {
                    return true;
                }
            }
            oxc_ast::AstKind::Program(_) => return false,
            _ => {}
        }
        child = parent;
    }
}

fn static_literal_truthiness(expression: &oxc_ast::ast::Expression<'_>) -> Option<bool> {
    match expression {
        oxc_ast::ast::Expression::BooleanLiteral(literal) => Some(literal.value),
        oxc_ast::ast::Expression::NullLiteral(_) => Some(false),
        oxc_ast::ast::Expression::NumericLiteral(literal) => Some(literal.value != 0.0),
        oxc_ast::ast::Expression::StringLiteral(literal) => Some(!literal.value.is_empty()),
        oxc_ast::ast::Expression::BigIntLiteral(literal) => Some(!literal.is_zero()),
        oxc_ast::ast::Expression::RegExpLiteral(_) => Some(true),
        _ => None,
    }
}
