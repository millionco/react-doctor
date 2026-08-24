const TYPED_ARRAY_CONSTRUCTOR_NAMES: [&str; 12] = [
    "BigInt64Array",
    "BigUint64Array",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "Int8Array",
    "Int16Array",
    "Int32Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Uint16Array",
    "Uint32Array",
];

fn resolve_static_array_like_length<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<f64> {
    resolve_static_array_like_length_inner(expression, ctx, &mut Vec::new())
}

fn resolve_static_array_like_length_inner<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<f64> {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::Identifier(identifier) = expression {
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
        if declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
        {
            return None;
        }
        return resolve_static_array_like_length_inner(
            declarator.init.as_ref()?,
            ctx,
            visited_symbol_ids,
        );
    }
    if let oxc_ast::ast::Expression::ArrayExpression(array_expression) = expression {
        return array_expression
            .elements
            .iter()
            .all(|element| element.as_expression().is_some())
            .then_some(array_expression.elements.len() as f64);
    }
    let oxc_ast::ast::Expression::NewExpression(new_expression) = expression else {
        return None;
    };
    let oxc_ast::ast::Expression::Identifier(constructor) =
        new_expression.callee.get_inner_expression()
    else {
        return None;
    };
    if !TYPED_ARRAY_CONSTRUCTOR_NAMES.contains(&constructor.name.as_str())
        || ctx
            .scoping()
            .get_reference(constructor.reference_id())
            .symbol_id()
            .is_some()
    {
        return None;
    }
    let Some(source) = new_expression.arguments.first() else {
        return Some(0.0);
    };
    let Some(source_expression) = source.as_expression() else {
        return Some(0.0);
    };
    if let Some(length) = resolve_static_nonnegative_integer(source_expression) {
        return Some(length);
    }
    resolve_static_array_like_length_inner(source_expression, ctx, visited_symbol_ids)
}

fn resolve_static_nonnegative_integer(expression: &oxc_ast::ast::Expression) -> Option<f64> {
    let expression = expression.get_inner_expression();
    let value = match expression {
        oxc_ast::ast::Expression::NumericLiteral(number) => number.value,
        oxc_ast::ast::Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == oxc_syntax::operator::UnaryOperator::UnaryPlus =>
        {
            let oxc_ast::ast::Expression::NumericLiteral(number) =
                unary_expression.argument.get_inner_expression()
            else {
                return None;
            };
            number.value
        }
        _ => return None,
    };
    (value.is_finite() && value >= 0.0 && value.fract() == 0.0).then_some(value)
}
