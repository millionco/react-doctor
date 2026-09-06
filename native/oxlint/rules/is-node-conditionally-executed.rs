fn is_node_conditionally_executed(
    node: &crate::AstNode<'_>,
    boundary_node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_span::GetSpan;

    let mut child_span = node.span();
    for parent in ctx.nodes().ancestors(node.id()) {
        if parent.id() == boundary_node_id {
            return false;
        }
        let is_conditional_region = match parent.kind() {
            oxc_ast::AstKind::IfStatement(statement) => statement.test.span() != child_span,
            oxc_ast::AstKind::ConditionalExpression(expression) => {
                expression.consequent.span() == child_span
                    || expression.alternate.span() == child_span
            }
            oxc_ast::AstKind::LogicalExpression(expression) => {
                expression.right.span() == child_span
            }
            oxc_ast::AstKind::AssignmentPattern(pattern) => pattern.right.span() == child_span,
            oxc_ast::AstKind::SwitchCase(_) => true,
            _ => false,
        };
        if is_conditional_region {
            return true;
        }
        child_span = parent.span();
    }
    false
}
