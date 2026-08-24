fn state_setter_symbol_id(
    state_symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let declaration = ctx.symbol_declaration(state_symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let oxc_ast::ast::BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let Some(oxc_ast::ast::BindingPattern::BindingIdentifier(state_identifier)) =
        pattern.elements.first().and_then(Option::as_ref)
    else {
        return None;
    };
    let Some(oxc_ast::ast::BindingPattern::BindingIdentifier(setter_identifier)) =
        pattern.elements.get(1).and_then(Option::as_ref)
    else {
        return None;
    };
    let Some(oxc_ast::ast::Expression::CallExpression(use_state_call)) = &declarator.init else {
        return None;
    };
    (state_identifier.symbol_id() == state_symbol_id
        && is_react_hook_call(use_state_call, &["useState"], ctx))
    .then(|| setter_identifier.symbol_id())
}
