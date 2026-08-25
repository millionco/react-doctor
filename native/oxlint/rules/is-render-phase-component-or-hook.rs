fn is_render_phase_component_or_hook<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(mut function_node) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    loop {
        if component_or_hook_function_name(function_node, ctx).is_some() {
            return true;
        }
        if !function_executes_during_render(function_node, ctx) {
            return false;
        }
        let Some(outer_function) = ctx.nodes().ancestors(function_node.id()).find(|ancestor| {
            matches!(
                ancestor.kind(),
                oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
            )
        }) else {
            return false;
        };
        function_node = outer_function;
    }
}
