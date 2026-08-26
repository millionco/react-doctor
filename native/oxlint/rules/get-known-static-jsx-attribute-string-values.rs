const MAX_KNOWN_CONST_STRING_ALIASES: usize = 4;

fn get_known_static_jsx_attribute_string_values<'a>(
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
            get_known_static_string_expression_values(expression, ctx)
        }
        _ => None,
    }
}

fn get_known_static_string_expression_values<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<Vec<String>> {
    let mut values = Vec::new();
    collect_known_static_string_values(
        expression,
        ctx,
        MAX_KNOWN_CONST_STRING_ALIASES,
        &mut Vec::new(),
        &mut values,
    );
    (!values.is_empty()).then_some(values)
}

fn collect_known_static_string_values<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    remaining_const_aliases: usize,
    resolving_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    values: &mut Vec<String>,
) {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::StringLiteral(string_literal) => {
            values.push(string_literal.value.to_string());
        }
        oxc_ast::ast::Expression::TemplateLiteral(template_literal)
            if template_literal.expressions.is_empty() && template_literal.quasis.len() == 1 =>
        {
            let quasi = &template_literal.quasis[0];
            values.push(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string(),
            );
        }
        oxc_ast::ast::Expression::ConditionalExpression(conditional_expression) => {
            collect_known_static_string_values(
                &conditional_expression.consequent,
                ctx,
                remaining_const_aliases,
                &mut resolving_symbol_ids.clone(),
                values,
            );
            collect_known_static_string_values(
                &conditional_expression.alternate,
                ctx,
                remaining_const_aliases,
                &mut resolving_symbol_ids.clone(),
                values,
            );
        }
        oxc_ast::ast::Expression::LogicalExpression(logical_expression)
            if matches!(
                logical_expression.operator,
                oxc_syntax::operator::LogicalOperator::Or
                    | oxc_syntax::operator::LogicalOperator::Coalesce
            ) =>
        {
            collect_known_static_string_values(
                &logical_expression.left,
                ctx,
                remaining_const_aliases,
                &mut resolving_symbol_ids.clone(),
                values,
            );
            collect_known_static_string_values(
                &logical_expression.right,
                ctx,
                remaining_const_aliases,
                &mut resolving_symbol_ids.clone(),
                values,
            );
        }
        oxc_ast::ast::Expression::Identifier(identifier) if remaining_const_aliases > 0 => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return;
            };
            if resolving_symbol_ids.contains(&symbol_id) {
                return;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return;
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
                return;
            };
            if !variable_declaration.kind.is_const()
                || declarator
                    .id
                    .get_binding_identifier()
                    .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
            {
                return;
            }
            let Some(initializer) = declarator.init.as_ref() else {
                return;
            };
            resolving_symbol_ids.push(symbol_id);
            collect_known_static_string_values(
                initializer,
                ctx,
                remaining_const_aliases - 1,
                resolving_symbol_ids,
                values,
            );
            resolving_symbol_ids.pop();
        }
        _ => {}
    }
}
