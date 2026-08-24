fn resolve_static_number<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<f64> {
    resolve_static_number_inner(expression, ctx, &mut Vec::new())
}

fn resolve_static_number_inner<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<f64> {
    let expression = expression.get_inner_expression();
    let value = match expression {
        oxc_ast::ast::Expression::NumericLiteral(number) => number.value,
        oxc_ast::ast::Expression::UnaryExpression(unary_expression)
            if matches!(
                unary_expression.operator,
                oxc_syntax::operator::UnaryOperator::UnaryPlus
                    | oxc_syntax::operator::UnaryOperator::UnaryNegation
            ) =>
        {
            let operand = resolve_static_number_inner(
                &unary_expression.argument,
                ctx,
                &mut visited_symbol_ids.clone(),
            )?;
            if unary_expression.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation {
                -operand
            } else {
                operand
            }
        }
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let oxc_ast::AstKind::VariableDeclaration(variable_declaration) =
                ctx.nodes().parent_node(declaration.id()).kind()
            else {
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
            resolve_static_number_inner(declarator.init.as_ref()?, ctx, visited_symbol_ids)?
        }
        oxc_ast::ast::Expression::BinaryExpression(binary_expression) => {
            let left = resolve_static_number_inner(
                &binary_expression.left,
                ctx,
                &mut visited_symbol_ids.clone(),
            )?;
            let right = resolve_static_number_inner(
                &binary_expression.right,
                ctx,
                &mut visited_symbol_ids.clone(),
            )?;
            use oxc_syntax::operator::BinaryOperator;
            match binary_expression.operator {
                BinaryOperator::Addition => left + right,
                BinaryOperator::Subtraction => left - right,
                BinaryOperator::Multiplication => left * right,
                BinaryOperator::Division => left / right,
                BinaryOperator::Exponential => left.powf(right),
                _ => return None,
            }
        }
        _ => return None,
    };
    value.is_finite().then_some(value)
}
