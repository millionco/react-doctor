fn is_proven_intrinsic_jsx_element<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let identifier = match &opening_element.name {
        oxc_ast::ast::JSXElementName::Identifier(identifier) => {
            return identifier
                .name
                .chars()
                .next()
                .is_some_and(|first_character| {
                    first_character.to_lowercase().to_string() == first_character.to_string()
                });
        }
        oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => identifier,
        _ => return false,
    };
    if resolve_jsx_element_type(opening_element, ctx)
        .and_then(|(element_type, _)| element_type.chars().next())
        .is_some_and(|first_character| {
            first_character.to_lowercase().to_string() == first_character.to_string()
        })
    {
        return true;
    }
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    is_intrinsic_const_symbol(symbol_id, ctx, &mut Vec::new())
}

fn is_intrinsic_const_symbol<'a>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return false;
    };
    if !variable_declaration.kind.is_const()
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(initializer) = declarator.init.as_ref() else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    let is_intrinsic = is_intrinsic_expression(initializer, ctx, visited_symbol_ids);
    visited_symbol_ids.pop();
    is_intrinsic
}

fn is_intrinsic_expression<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    match expression {
        oxc_ast::ast::Expression::StringLiteral(_) => true,
        oxc_ast::ast::Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| is_intrinsic_const_symbol(symbol_id, ctx, visited_symbol_ids)),
        oxc_ast::ast::Expression::ConditionalExpression(conditional_expression) => {
            is_intrinsic_expression(&conditional_expression.consequent, ctx, visited_symbol_ids)
                && is_intrinsic_expression(
                    &conditional_expression.alternate,
                    ctx,
                    visited_symbol_ids,
                )
        }
        _ => false,
    }
}
