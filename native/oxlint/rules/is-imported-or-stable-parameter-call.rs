fn is_imported_or_stable_parameter_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &crate::context::LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if exact_local_function_id(
        &call_expression.callee,
        ctx,
        &mut Vec::new(),
        resolution_cache,
    )
    .is_some()
    {
        return false;
    }
    let Some(root_identifier) = imported_or_stable_call_root_identifier(&call_expression.callee)
    else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(root_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let Some(symbol_id) = imported_or_stable_call_resolve_const_alias(
        symbol_id,
        ctx,
        &mut Vec::new(),
    ) else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    matches!(
        declaration.kind(),
        oxc_ast::AstKind::ImportSpecifier(_)
            | oxc_ast::AstKind::ImportDefaultSpecifier(_)
            | oxc_ast::AstKind::ImportNamespaceSpecifier(_)
    ) || (imported_or_stable_call_is_parameter_declaration(declaration, ctx)
        && ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .all(|reference| !reference.is_write()))
}

fn imported_or_stable_call_is_parameter_declaration(
    declaration: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    matches!(declaration.kind(), oxc_ast::AstKind::FormalParameter(_))
        || ctx
            .nodes()
            .ancestors(declaration.id())
            .take_while(|ancestor| {
                !matches!(
                    ancestor.kind(),
                    oxc_ast::AstKind::Function(_)
                        | oxc_ast::AstKind::ArrowFunctionExpression(_)
                )
            })
            .any(|ancestor| matches!(ancestor.kind(), oxc_ast::AstKind::FormalParameter(_)))
}

fn imported_or_stable_call_root_identifier<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    let mut expression = expression.get_inner_expression();
    loop {
        if let oxc_ast::ast::Expression::Identifier(identifier) = expression {
            return Some(identifier);
        }
        expression = expression
            .as_member_expression()?
            .object()
            .get_inner_expression();
    }
}

fn imported_or_stable_call_resolve_const_alias(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<oxc_semantic::SymbolId> {
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Some(symbol_id);
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    let initializer = declarator.init.as_ref()?.get_inner_expression();
    let oxc_ast::ast::Expression::Identifier(identifier) = initializer else {
        return Some(symbol_id);
    };
    let aliased_symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    imported_or_stable_call_resolve_const_alias(aliased_symbol_id, ctx, visited_symbol_ids)
}
