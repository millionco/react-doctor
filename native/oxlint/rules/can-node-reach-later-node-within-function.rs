fn can_node_reach_later_node_within_function(
    source_node: &crate::AstNode<'_>,
    target_node: &crate::AstNode<'_>,
    function_node: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let source_block = ctx.nodes().cfg_id(source_node.id());
    let target_block = ctx.nodes().cfg_id(target_node.id());
    let excluded_blocks = rustc_hash::FxHashSet::default();
    if !is_node_reachable_within_function(source_node, function_node, ctx) {
        return false;
    }
    if source_block == target_block {
        return oxc_span::GetSpan::span(source_node).start
            < oxc_span::GetSpan::span(target_node).start;
    }
    cfg_block_can_reach(source_block, target_block, &excluded_blocks, ctx)
}
