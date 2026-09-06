fn identifier_symbol_id_with_lexical_fallback(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .or_else(|| {
            ctx.scoping().find_binding(
                ctx.nodes().get_node(identifier.node_id()).scope_id(),
                identifier.name,
            )
        })
}
