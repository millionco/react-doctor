fn resolve_direct_unreassigned_initializer<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
}
