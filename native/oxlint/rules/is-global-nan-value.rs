fn is_global_nan_value<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    is_global_nan_value_inner(expression, ctx, &mut rustc_hash::FxHashSet::default())
}

fn is_global_nan_value_inner<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return identifier.name == "NaN";
            };
            if !visited_symbol_ids.insert(symbol_id) {
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
            if !variable_declaration.kind.is_const() {
                return false;
            }
            let Some(initializer) = &declarator.init else {
                return false;
            };
            if declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
            {
                return is_global_nan_value_inner(initializer, ctx, visited_symbol_ids);
            }
            match &declarator.id {
                oxc_ast::ast::BindingPattern::ObjectPattern(pattern) => is_global_number_expression(
                    initializer,
                    ctx,
                ) && pattern
                    .properties
                    .iter()
                    .any(|property| {
                        property_key_matches_name(&property.key, "NaN")
                            && matches!(
                                &property.value,
                                oxc_ast::ast::BindingPattern::BindingIdentifier(binding_identifier)
                                    if binding_identifier.symbol_id() == symbol_id
                            )
                    }),
                oxc_ast::ast::BindingPattern::ArrayPattern(pattern) => {
                    let Some(binding_index) = pattern.elements.iter().position(|element| {
                        matches!(
                            element,
                            Some(oxc_ast::ast::BindingPattern::BindingIdentifier(binding_identifier))
                                if binding_identifier.symbol_id() == symbol_id
                        )
                    }) else {
                        return false;
                    };
                    let oxc_ast::ast::Expression::ArrayExpression(array_expression) =
                        initializer.get_inner_expression()
                    else {
                        return false;
                    };
                    if array_expression.elements[..binding_index]
                        .iter()
                        .any(|element| {
                            matches!(
                                element,
                                oxc_ast::ast::ArrayExpressionElement::SpreadElement(_)
                            )
                        })
                    {
                        return false;
                    }
                    array_expression
                        .elements
                        .get(binding_index)
                        .and_then(oxc_ast::ast::ArrayExpressionElement::as_expression)
                        .is_some_and(|array_value| {
                            is_global_nan_value_inner(array_value, ctx, visited_symbol_ids)
                        })
                }
                _ => false,
            }
        }
        oxc_ast::ast::Expression::StaticMemberExpression(member_expression) => {
            member_expression.property.name == "NaN"
                && is_global_number_expression(&member_expression.object, ctx)
        }
        _ => false,
    }
}

fn is_global_number_expression<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        oxc_ast::ast::Expression::Identifier(identifier)
            if identifier.name == "Number"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    )
}
