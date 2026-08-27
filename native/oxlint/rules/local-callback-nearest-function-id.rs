fn local_callback_nearest_function_id(
    node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}
