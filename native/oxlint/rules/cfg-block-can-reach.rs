fn cfg_block_can_reach(
    source_block: oxc_cfg::BlockNodeId,
    target_block: oxc_cfg::BlockNodeId,
    excluded_blocks: &rustc_hash::FxHashSet<oxc_cfg::BlockNodeId>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    if source_block == target_block {
        return true;
    }
    let graph = ctx.cfg().graph();
    let mut visited_blocks = rustc_hash::FxHashSet::default();
    let mut pending_blocks = vec![source_block];
    while let Some(current_block) = pending_blocks.pop() {
        if !visited_blocks.insert(current_block) {
            continue;
        }
        for edge in graph.edges_directed(current_block, oxc_cfg::graph::Direction::Outgoing) {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction | oxc_cfg::EdgeType::Unreachable
            ) {
                continue;
            }
            let target = oxc_cfg::graph::visit::EdgeRef::target(&edge);
            if excluded_blocks.contains(&target) {
                continue;
            }
            if target == target_block {
                return true;
            }
            pending_blocks.push(target);
        }
    }
    false
}
