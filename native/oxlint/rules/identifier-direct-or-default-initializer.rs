fn identifier_direct_or_default_initializer<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    match ctx.symbol_declaration(symbol_id).kind() {
        oxc_ast::AstKind::VariableDeclarator(declarator) => match &declarator.id {
            oxc_ast::ast::BindingPattern::BindingIdentifier(_) => {
                binding_pattern_initializer_for_symbol(
                    &declarator.id,
                    symbol_id,
                    declarator.init.as_ref(),
                )
            }
            pattern => explicit_binding_default_for_symbol(pattern, symbol_id),
        },
        oxc_ast::AstKind::FormalParameter(parameter) => {
            explicit_binding_default_for_symbol(&parameter.pattern, symbol_id)
        }
        _ => None,
    }
}

fn explicit_binding_default_for_symbol<'a>(
    pattern: &'a oxc_ast::ast::BindingPattern<'a>,
    symbol_id: oxc_semantic::SymbolId,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    match pattern {
        oxc_ast::ast::BindingPattern::BindingIdentifier(_) => None,
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => match &assignment.left {
            oxc_ast::ast::BindingPattern::BindingIdentifier(_) => {
                binding_pattern_initializer_for_symbol(
                    &assignment.left,
                    symbol_id,
                    Some(&assignment.right),
                )
            }
            pattern => explicit_binding_default_for_symbol(pattern, symbol_id),
        },
        oxc_ast::ast::BindingPattern::ObjectPattern(object) => object
            .properties
            .iter()
            .find_map(|property| explicit_binding_default_for_symbol(&property.value, symbol_id))
            .or_else(|| {
                object
                    .rest
                    .as_ref()
                    .and_then(|rest| explicit_binding_default_for_symbol(&rest.argument, symbol_id))
            }),
        oxc_ast::ast::BindingPattern::ArrayPattern(array) => array
            .elements
            .iter()
            .flatten()
            .find_map(|element| explicit_binding_default_for_symbol(element, symbol_id))
            .or_else(|| {
                array
                    .rest
                    .as_ref()
                    .and_then(|rest| explicit_binding_default_for_symbol(&rest.argument, symbol_id))
            }),
    }
}
