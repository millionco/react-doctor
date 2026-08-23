fn component_or_hook_function_name<'a, 'b>(
    function_node: &'b crate::AstNode<'a>,
    ctx: &'b crate::context::LintContext<'a>,
) -> Option<&'b str> {
    if let oxc_ast::AstKind::Function(function) = function_node.kind()
        && let Some(identifier) = &function.id
        && crate::utils::is_react_component_or_hook_name(identifier.name.as_str())
    {
        return Some(identifier.name.as_str());
    }
    let mut expression_root = transparent_expression_root(function_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        let oxc_ast::AstKind::CallExpression(call_expression) = parent.kind() else {
            break;
        };
        let is_first_argument = call_expression.arguments.first().is_some_and(|argument| {
            argument.as_expression().is_some_and(|expression| {
                oxc_span::GetSpan::span(expression) == oxc_span::GetSpan::span(expression_root)
            })
        });
        if !is_first_argument
            || !matches!(
                call_expression.callee_name(),
                Some("memo" | "forwardRef" | "observer" | "lazy")
            )
        {
            break;
        }
        expression_root = transparent_expression_root(parent, ctx);
    }
    let parent = ctx.nodes().parent_node(expression_root.id());
    let oxc_ast::AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    declarator
        .id
        .get_binding_identifier()
        .filter(|identifier| {
            crate::utils::is_react_component_or_hook_name(identifier.name.as_str())
        })
        .map(|identifier| identifier.name.as_str())
}
