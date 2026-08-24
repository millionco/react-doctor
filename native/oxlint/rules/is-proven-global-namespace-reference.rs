fn is_proven_global_namespace_reference<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    namespace_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    is_proven_global_namespace_reference_inner(
        expression,
        namespace_name,
        ctx,
        &mut rustc_hash::FxHashSet::default(),
    )
}

fn is_proven_global_namespace_reference_inner<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    namespace_name: &str,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
        return expression
            .as_member_expression()
            .is_some_and(|member_expression| {
                member_expression.static_property_name() == Some(namespace_name)
                    && is_proven_global_object_reference(
                        member_expression.object(),
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    )
            });
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return identifier.name == namespace_name;
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
        return is_proven_global_namespace_reference_inner(
            initializer,
            namespace_name,
            ctx,
            visited_symbol_ids,
        );
    }
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        property_key_matches_name(&property.key, namespace_name)
            && binding_pattern_has_symbol(&property.value, symbol_id)
            && is_proven_global_object_reference(initializer, ctx, &mut visited_symbol_ids.clone())
    })
}

fn is_proven_global_object_reference<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    let oxc_ast::ast::Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return matches!(
            identifier.name.as_str(),
            "global" | "globalThis" | "self" | "window"
        );
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
        return is_proven_global_object_reference(initializer, ctx, visited_symbol_ids);
    }
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        matches!(
            property.key.static_name().as_deref(),
            Some("global" | "globalThis" | "self" | "window")
        ) && binding_pattern_has_symbol(&property.value, symbol_id)
            && is_proven_global_object_reference(initializer, ctx, &mut visited_symbol_ids.clone())
    })
}
