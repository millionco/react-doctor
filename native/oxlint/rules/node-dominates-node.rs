fn node_dominates_node<'a>(
    candidate: &crate::AstNode<'a>,
    target: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(function_node) = crate::ast_util::get_enclosing_function(target, ctx) else {
        return false;
    };
    if crate::ast_util::get_enclosing_function(candidate, ctx)
        .is_none_or(|candidate_owner| candidate_owner.id() != function_node.id())
    {
        return false;
    }

    let candidate_block = ctx.nodes().cfg_id(candidate.id());
    let target_block = ctx.nodes().cfg_id(target.id());
    if candidate_block == target_block {
        return oxc_span::GetSpan::span(candidate).start < oxc_span::GetSpan::span(target).start;
    }

    let entry_block = ctx.nodes().cfg_id(function_node.id());
    let no_exclusions = rustc_hash::FxHashSet::default();
    if !cfg_block_can_reach(entry_block, candidate_block, &no_exclusions, ctx)
        || !cfg_block_can_reach(entry_block, target_block, &no_exclusions, ctx)
    {
        return false;
    }
    let excluded_candidate = rustc_hash::FxHashSet::from_iter([candidate_block]);
    !cfg_block_can_reach(entry_block, target_block, &excluded_candidate, ctx)
}
