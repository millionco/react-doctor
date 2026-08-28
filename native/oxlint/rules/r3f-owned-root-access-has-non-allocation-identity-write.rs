fn r3f_owned_root_access_has_non_allocation_identity_write<'a>(
    resource_access: &crate::AstNode<'a>,
    allocation: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let allocation_root = transparent_expression_root(allocation, ctx);
    let mut current = transparent_expression_root(resource_access, ctx);
    for parent in ctx.nodes().ancestors(current.id()) {
        match parent.kind() {
            AstKind::AssignmentExpression(assignment) => {
                if !assignment.left.span().contains_inclusive(current.span()) {
                    return false;
                }
                return transparent_expression_root(
                    ctx.nodes().get_node(assignment.right.node_id()),
                    ctx,
                )
                .span()
                    != allocation_root.span();
            }
            AstKind::UpdateExpression(update) => {
                return update.argument.span().contains_inclusive(current.span());
            }
            AstKind::ArrayAssignmentTarget(_)
            | AstKind::ObjectAssignmentTarget(_)
            | AstKind::AssignmentTargetRest(_) => current = parent,
            AstKind::AssignmentTargetPropertyIdentifier(property)
                if property.binding.span().contains_inclusive(current.span()) =>
            {
                current = parent;
            }
            AstKind::AssignmentTargetPropertyProperty(property)
                if !matches!(
                    &property.binding,
                    oxc_ast::ast::AssignmentTargetMaybeDefault::AssignmentTargetWithDefault(_)
                ) && property.binding.span().contains_inclusive(current.span()) =>
            {
                current = parent;
            }
            _ => return false,
        }
    }
    false
}
