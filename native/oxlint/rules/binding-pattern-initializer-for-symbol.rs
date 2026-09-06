fn binding_pattern_initializer_for_symbol<'a>(
    pattern: &'a oxc_ast::ast::BindingPattern<'a>,
    symbol_id: oxc_semantic::SymbolId,
    base_initializer: Option<&'a oxc_ast::ast::Expression<'a>>,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    match pattern {
        oxc_ast::ast::BindingPattern::BindingIdentifier(binding) => (binding.symbol_id()
            == symbol_id)
            .then_some(base_initializer)
            .flatten(),
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
            binding_pattern_initializer_for_symbol(
                &assignment.left,
                symbol_id,
                Some(&assignment.right),
            )
        }
        oxc_ast::ast::BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                let property_initializer = match &property.value {
                    oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
                        Some(&assignment.right)
                    }
                    _ => base_initializer,
                };
                if let Some(initializer) = binding_pattern_initializer_for_symbol(
                    &property.value,
                    symbol_id,
                    property_initializer,
                ) {
                    return Some(initializer);
                }
            }
            pattern.rest.as_ref().and_then(|rest| {
                binding_pattern_initializer_for_symbol(&rest.argument, symbol_id, base_initializer)
            })
        }
        oxc_ast::ast::BindingPattern::ArrayPattern(pattern) => {
            for element in pattern.elements.iter().flatten() {
                let element_initializer = match element {
                    oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
                        Some(&assignment.right)
                    }
                    _ => base_initializer,
                };
                if let Some(initializer) =
                    binding_pattern_initializer_for_symbol(element, symbol_id, element_initializer)
                {
                    return Some(initializer);
                }
            }
            pattern.rest.as_ref().and_then(|rest| {
                binding_pattern_initializer_for_symbol(&rest.argument, symbol_id, None)
            })
        }
    }
}
