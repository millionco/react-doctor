fn collect_r3f_host_ref_symbol_ids(
    ctx: &crate::context::LintContext<'_>,
) -> rustc_hash::FxHashSet<oxc_semantic::SymbolId> {
    let mut symbol_ids = rustc_hash::FxHashSet::default();
    for node in ctx.nodes().iter() {
        let oxc_ast::AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            continue;
        };
        if !is_r3f_host_intrinsic(opening_element, ctx) {
            continue;
        }
        let Some(oxc_ast::ast::Expression::Identifier(identifier)) =
            get_authoritative_jsx_attribute(opening_element, "ref", true)
                .and_then(|attribute| jsx_attribute_expression(attribute))
                .map(oxc_ast::ast::Expression::get_inner_expression)
        else {
            continue;
        };
        if let Some(symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) {
            symbol_ids.insert(symbol_id);
        }
    }
    symbol_ids
}
