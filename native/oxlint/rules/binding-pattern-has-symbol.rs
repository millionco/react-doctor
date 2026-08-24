fn binding_pattern_has_symbol(
    pattern: &oxc_ast::ast::BindingPattern,
    symbol_id: oxc_semantic::SymbolId,
) -> bool {
    match pattern {
        oxc_ast::ast::BindingPattern::BindingIdentifier(identifier) => {
            identifier.symbol_id() == symbol_id
        }
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
            matches!(
                &assignment.left,
                oxc_ast::ast::BindingPattern::BindingIdentifier(identifier)
                    if identifier.symbol_id() == symbol_id
            )
        }
        _ => false,
    }
}
