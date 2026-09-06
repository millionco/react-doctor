fn find_render_phase_component_or_hook<'a, 'b>(
    node: &'b crate::AstNode<'a>,
    ctx: &'b crate::context::LintContext<'a>,
) -> Option<&'b crate::AstNode<'a>> {
    let mut function_node = crate::ast_util::get_enclosing_function(node, ctx)?;
    loop {
        if component_or_hook_function_name(function_node, ctx).is_some() {
            return Some(function_node);
        }
        if !function_executes_during_render(function_node, ctx) {
            return None;
        }
        function_node = ctx.nodes().ancestors(function_node.id()).find(|ancestor| {
            matches!(
                ancestor.kind(),
                oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
            )
        })?;
    }
}
