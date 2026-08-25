fn do_nodes_cover_every_path_after_node<'a>(
    anchor_node: &crate::AstNode<'a>,
    matching_nodes: &[&crate::AstNode<'a>],
    function_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let anchor_block = ctx.nodes().cfg_id(anchor_node.id());
    let matching_blocks = matching_nodes
        .iter()
        .copied()
        .filter(|candidate| {
            crate::ast_util::get_enclosing_function(candidate, ctx)
                .is_some_and(|owner| owner.id() == function_node.id())
        })
        .filter_map(|candidate| {
            let matching_block = ctx.nodes().cfg_id(candidate.id());
            (matching_block != anchor_block
                || oxc_span::GetSpan::span(candidate).start
                    >= oxc_span::GetSpan::span(anchor_node).start)
                .then_some(matching_block)
        })
        .collect::<rustc_hash::FxHashSet<_>>();
    if matching_blocks.contains(&anchor_block) {
        return true;
    }

    let graph = ctx.cfg().graph();
    let mut visited_blocks = rustc_hash::FxHashSet::default();
    let mut pending_blocks = vec![anchor_block];
    while let Some(current_block) = pending_blocks.pop() {
        if !visited_blocks.insert(current_block) {
            continue;
        }
        let mut successor_blocks = Vec::new();
        for edge in graph.edges_directed(current_block, oxc_cfg::graph::Direction::Outgoing) {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction
                    | oxc_cfg::EdgeType::Unreachable
                    | oxc_cfg::EdgeType::Error(oxc_cfg::ErrorEdgeKind::Implicit)
            ) {
                continue;
            }
            let target = oxc_cfg::graph::visit::EdgeRef::target(&edge);
            if !matching_blocks.contains(&target) {
                successor_blocks.push(target);
            }
        }
        let instructions = ctx.cfg().basic_block(current_block).instructions();
        if instructions.iter().any(|instruction| {
            matches!(
                instruction.kind,
                oxc_cfg::InstructionKind::ImplicitReturn | oxc_cfg::InstructionKind::Return(_)
            )
        }) || (instructions
            .iter()
            .any(|instruction| instruction.kind == oxc_cfg::InstructionKind::Throw)
            && successor_blocks.is_empty())
        {
            return false;
        }
        pending_blocks.extend(successor_blocks);
    }
    !matching_blocks.is_empty()
}
