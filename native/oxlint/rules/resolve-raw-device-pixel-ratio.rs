fn resolve_raw_device_pixel_ratio<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<oxc_span::Span> {
    resolve_raw_device_pixel_ratio_inner(expression, ctx, &mut Vec::new())
}

fn resolve_raw_device_pixel_ratio_inner<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<oxc_span::Span> {
    let expression = expression.get_inner_expression();
    match expression {
        oxc_ast::ast::Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == oxc_syntax::operator::UnaryOperator::UnaryPlus =>
        {
            resolve_raw_device_pixel_ratio_inner(
                &unary_expression.argument,
                ctx,
                visited_symbol_ids,
            )
        }
        oxc_ast::ast::Expression::BinaryExpression(binary_expression) => {
            let raw_left = resolve_raw_device_pixel_ratio_inner(
                &binary_expression.left,
                ctx,
                &mut visited_symbol_ids.clone(),
            );
            let raw_right = resolve_raw_device_pixel_ratio_inner(
                &binary_expression.right,
                ctx,
                &mut visited_symbol_ids.clone(),
            );
            if raw_left.is_some() == raw_right.is_some() {
                return None;
            }
            if let Some(raw_span) = raw_left
                && numeric_operand_keeps_raw_ratio(
                    &binary_expression.right,
                    binary_expression.operator,
                    false,
                )
            {
                return Some(raw_span);
            }
            if let Some(raw_span) = raw_right
                && numeric_operand_keeps_raw_ratio(
                    &binary_expression.left,
                    binary_expression.operator,
                    true,
                )
            {
                return Some(raw_span);
            }
            None
        }
        oxc_ast::ast::Expression::ArrayExpression(array_expression)
            if array_expression.elements.len() == 2 =>
        {
            array_expression.elements[1]
                .as_expression()
                .and_then(|upper_bound| {
                    resolve_raw_device_pixel_ratio_inner(
                        upper_bound,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    )
                })
        }
        oxc_ast::ast::Expression::Identifier(identifier) => {
            resolve_raw_device_pixel_ratio_identifier(identifier, ctx, visited_symbol_ids)
        }
        _ if expression
            .as_member_expression()
            .is_some_and(|member_expression| {
                member_expression.static_property_name() == Some("devicePixelRatio")
                    && is_direct_global_pixel_ratio_object(member_expression.object(), ctx)
            }) =>
        {
            Some(oxc_span::GetSpan::span(expression))
        }
        _ => None,
    }
}

fn resolve_raw_device_pixel_ratio_identifier<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<oxc_span::Span> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
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
    if !variable_declaration.kind.is_const() {
        return None;
    }
    let initializer = declarator.init.as_ref()?;
    if declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
    {
        return resolve_raw_device_pixel_ratio_inner(initializer, ctx, visited_symbol_ids);
    }
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return None;
    };
    let has_device_pixel_ratio_binding = pattern.properties.iter().any(|property| {
        property.key.static_name().as_deref() == Some("devicePixelRatio")
            && binding_pattern_has_symbol(&property.value, symbol_id)
    });
    if !has_device_pixel_ratio_binding || !is_direct_global_pixel_ratio_object(initializer, ctx) {
        return None;
    }
    Some(oxc_span::GetSpan::span(identifier))
}

fn is_direct_global_pixel_ratio_object<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let oxc_ast::ast::Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    matches!(identifier.name.as_str(), "window" | "globalThis")
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
}

fn numeric_operand_keeps_raw_ratio(
    expression: &oxc_ast::ast::Expression,
    operator: oxc_syntax::operator::BinaryOperator,
    is_left_operand: bool,
) -> bool {
    let oxc_ast::ast::Expression::NumericLiteral(number) = expression.get_inner_expression() else {
        return false;
    };
    use oxc_syntax::operator::BinaryOperator;
    number.value.is_finite()
        && (matches!(operator, BinaryOperator::Addition)
            || (!is_left_operand && matches!(operator, BinaryOperator::Subtraction))
            || (number.value > 0.0
                && matches!(
                    operator,
                    BinaryOperator::Multiplication
                        | BinaryOperator::Division
                        | BinaryOperator::Exponential
                )
                && (!is_left_operand || operator == BinaryOperator::Multiplication)))
}
