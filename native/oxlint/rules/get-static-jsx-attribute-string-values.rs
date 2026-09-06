const MAX_CONST_STRING_ALIASES: usize = 4;

fn get_static_jsx_attribute_string_values<'a>(
    attribute: &oxc_ast::ast::JSXAttribute<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<Vec<String>> {
    let value = attribute.value.as_ref()?;
    match value {
        oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal) => {
            Some(vec![string_literal.value.to_string()])
        }
        oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) => {
            let expression = container.expression.as_expression()?;
            resolve_static_string_values(expression, ctx, MAX_CONST_STRING_ALIASES, &mut Vec::new())
        }
        _ => None,
    }
}

fn resolve_static_string_values<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    remaining_const_aliases: usize,
    resolving_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<Vec<String>> {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::StringLiteral(string_literal) => {
            Some(vec![string_literal.value.to_string()])
        }
        oxc_ast::ast::Expression::TemplateLiteral(template_literal)
            if template_literal.expressions.is_empty() && template_literal.quasis.len() == 1 =>
        {
            let quasi = &template_literal.quasis[0];
            Some(vec![
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string(),
            ])
        }
        oxc_ast::ast::Expression::ConditionalExpression(conditional_expression) => {
            let mut consequent = resolve_static_string_values(
                &conditional_expression.consequent,
                ctx,
                remaining_const_aliases,
                &mut resolving_symbol_ids.clone(),
            )?;
            let alternate = resolve_static_string_values(
                &conditional_expression.alternate,
                ctx,
                remaining_const_aliases,
                &mut resolving_symbol_ids.clone(),
            )?;
            consequent.extend(alternate);
            Some(consequent)
        }
        oxc_ast::ast::Expression::Identifier(identifier) if remaining_const_aliases > 0 => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if resolving_symbol_ids.contains(&symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
                return None;
            };
            if !variable_declaration.kind.is_const()
                || declarator
                    .id
                    .get_binding_identifier()
                    .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
            {
                return None;
            }
            let initializer = declarator.init.as_ref()?;
            resolving_symbol_ids.push(symbol_id);
            let values = resolve_static_string_values(
                initializer,
                ctx,
                remaining_const_aliases - 1,
                resolving_symbol_ids,
            );
            resolving_symbol_ids.pop();
            values
        }
        _ => None,
    }
}
