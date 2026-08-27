fn binding_property_name_for_symbol(
    pattern: &oxc_ast::ast::BindingPattern<'_>,
    symbol_id: oxc_semantic::SymbolId,
) -> Option<String> {
    match pattern {
        oxc_ast::ast::BindingPattern::BindingIdentifier(_) => None,
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
            binding_property_name_for_symbol(&assignment.left, symbol_id)
        }
        oxc_ast::ast::BindingPattern::ObjectPattern(object_pattern) => {
            for property in &object_pattern.properties {
                if binding_pattern_has_symbol(&property.value, symbol_id) {
                    return property.key.static_name().map(|name| name.to_string());
                }
            }
            None
        }
        oxc_ast::ast::BindingPattern::ArrayPattern(array_pattern) => array_pattern
            .elements
            .iter()
            .flatten()
            .find_map(|element| binding_property_name_for_symbol(element, symbol_id)),
    }
}
