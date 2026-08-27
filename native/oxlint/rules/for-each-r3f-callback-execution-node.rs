fn for_each_r3f_callback_execution_node<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    hook_name: &str,
    ctx: &crate::context::LintContext<'a>,
    visitor: impl FnMut(&crate::AstNode<'a>, oxc_semantic::NodeId),
) {
    if !module_api_path_matches(
        &call_expression.callee,
        &[hook_name],
        &[
            "@react-three/fiber",
            "@react-three/fiber/legacy",
            "@react-three/fiber/native",
            "@react-three/fiber/webgpu",
            "react-three-fiber",
        ],
        false,
        ctx,
    ) {
        return;
    }
    let Some(callback_expression) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return;
    };
    for_each_local_callback_execution_node(callback_expression, ctx, visitor);
}
