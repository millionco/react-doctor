fn is_render_phase_component_or_hook<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    find_render_phase_component_or_hook(node, ctx).is_some()
}
