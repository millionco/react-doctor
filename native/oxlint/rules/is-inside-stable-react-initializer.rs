fn is_inside_stable_react_initializer<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(mut enclosing_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    loop {
        let callback_root = transparent_expression_root(enclosing_function, ctx);
        let parent = ctx.nodes().parent_node(callback_root.id());
        if let oxc_ast::AstKind::CallExpression(call_expression) = parent.kind()
            && expression_is_argument_at(
                &call_expression.arguments,
                0,
                oxc_span::GetSpan::span(callback_root),
            )
            && (is_react_api_call(call_expression, "useState", ctx)
                || (is_react_api_call(call_expression, "useMemo", ctx)
                    && call_expression
                        .arguments
                        .get(1)
                        .is_some_and(|argument| !argument.is_spread())))
        {
            return true;
        }
        let Some(outer_function) =
            ctx.nodes()
                .ancestors(enclosing_function.id())
                .find(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        oxc_ast::AstKind::Function(_)
                            | oxc_ast::AstKind::ArrowFunctionExpression(_)
                    )
                })
        else {
            return false;
        };
        enclosing_function = outer_function;
    }
}
