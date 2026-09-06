const CPU_TYPED_ARRAY_CONSTRUCTOR_NAMES: [&str; 11] = [
    "BigInt64Array",
    "BigUint64Array",
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

fn is_cpu_typed_array<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    is_cpu_typed_array_inner(expression, ctx, &mut Vec::new())
}

fn is_cpu_typed_array_inner<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::Identifier(identifier) = expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if visited_symbol_ids.contains(&symbol_id)
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(oxc_semantic::Reference::is_write)
        {
            return false;
        }
        visited_symbol_ids.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        return matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) && binding_pattern_initializer_for_symbol(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        )
        .is_some_and(|initializer| is_cpu_typed_array_inner(initializer, ctx, visited_symbol_ids));
    }
    let oxc_ast::ast::Expression::NewExpression(new_expression) = expression else {
        return false;
    };
    let oxc_ast::ast::Expression::Identifier(constructor) =
        new_expression.callee.get_inner_expression()
    else {
        return false;
    };
    CPU_TYPED_ARRAY_CONSTRUCTOR_NAMES.contains(&constructor.name.as_str())
        && ctx
            .scoping()
            .get_reference(constructor.reference_id())
            .symbol_id()
            .is_none()
}
