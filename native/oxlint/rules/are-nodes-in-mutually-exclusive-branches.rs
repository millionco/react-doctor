fn are_nodes_in_mutually_exclusive_branches(
    first_node: &crate::AstNode<'_>,
    second_node: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let mut first_branch_by_ancestor = rustc_hash::FxHashMap::default();
    let mut current = first_node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if let Some(branch) = exclusive_branch(parent, current) {
            first_branch_by_ancestor.insert(parent.id(), branch);
        }
        if matches!(parent.kind(), oxc_ast::AstKind::Program(_)) {
            break;
        }
        current = parent;
    }

    current = second_node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if let Some(second_branch) = exclusive_branch(parent, current)
            && first_branch_by_ancestor
                .get(&parent.id())
                .is_some_and(|first_branch| *first_branch != second_branch)
        {
            return true;
        }
        if matches!(parent.kind(), oxc_ast::AstKind::Program(_)) {
            return false;
        }
        current = parent;
    }
}

fn exclusive_branch(parent: &crate::AstNode<'_>, child: &crate::AstNode<'_>) -> Option<bool> {
    let child_span = oxc_span::GetSpan::span(child);
    match parent.kind() {
        oxc_ast::AstKind::IfStatement(statement) => {
            if oxc_span::GetSpan::span(&statement.consequent) == child_span {
                Some(false)
            } else if statement
                .alternate
                .as_ref()
                .is_some_and(|alternate| oxc_span::GetSpan::span(alternate) == child_span)
            {
                Some(true)
            } else {
                None
            }
        }
        oxc_ast::AstKind::ConditionalExpression(expression) => {
            if oxc_span::GetSpan::span(&expression.consequent) == child_span {
                Some(false)
            } else if oxc_span::GetSpan::span(&expression.alternate) == child_span {
                Some(true)
            } else {
                None
            }
        }
        _ => None,
    }
}
