const SYNCHRONOUS_ITERATOR_CALLBACK_METHOD_NAMES: [&str; 8] = [
    "every",
    "filter",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
];

fn node_is_inside_repeated_execution(
    node: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            oxc_ast::AstKind::DoWhileStatement(_)
            | oxc_ast::AstKind::ForInStatement(_)
            | oxc_ast::AstKind::ForOfStatement(_)
            | oxc_ast::AstKind::ForStatement(_)
            | oxc_ast::AstKind::WhileStatement(_) => return true,
            oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_) => {
                return is_synchronous_iterator_callback_function(ancestor, ctx);
            }
            _ => {}
        }
    }
    false
}

fn is_synchronous_iterator_callback_function(
    function_node: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_span::GetSpan;

    let parent = ctx.nodes().parent_node(function_node.id());
    let oxc_ast::AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    let oxc_ast::ast::Expression::StaticMemberExpression(member_expression) =
        call_expression.callee.get_inner_expression()
    else {
        return false;
    };
    let callback_argument_index = if member_expression.property.name == "from"
        && matches!(
            member_expression.object.get_inner_expression(),
            oxc_ast::ast::Expression::Identifier(identifier) if identifier.name == "Array"
        ) {
        1
    } else if SYNCHRONOUS_ITERATOR_CALLBACK_METHOD_NAMES
        .contains(&member_expression.property.name.as_str())
    {
        0
    } else {
        return false;
    };
    call_expression
        .arguments
        .get(callback_argument_index)
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_some_and(|callback| callback.span() == function_node.span())
}
