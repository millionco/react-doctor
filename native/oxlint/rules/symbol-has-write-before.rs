fn symbol_has_write_before(
    symbol_id: oxc_semantic::SymbolId,
    reference_offset: u32,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .any(|reference| {
            oxc_span::GetSpan::span(ctx.nodes().get_node(reference.node_id())).start
                < reference_offset
        })
}
