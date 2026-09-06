fn r3f_callback_state_property_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    callback_id: oxc_semantic::NodeId,
    property_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    r3f_callback_state_property_matches_inner(
        expression,
        callback_id,
        property_name,
        ctx,
        &mut Vec::new(),
    )
}

fn r3f_callback_state_property_matches_inner<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    callback_id: oxc_semantic::NodeId,
    property_name: &str,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return member_expression.static_property_name() == Some(property_name)
            && r3f_resolves_to_callback_state(
                member_expression.object(),
                callback_id,
                ctx,
                visited_symbol_ids,
            );
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if r3f_callback_parameter_property_symbol_matches(callback_id, symbol_id, property_name, ctx) {
        return true;
    }
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
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    if r3f_binding_pattern_symbol_id(&declarator.id) == Some(symbol_id) {
        return declarator.init.as_ref().is_some_and(|initializer| {
            r3f_callback_state_property_matches_inner(
                initializer,
                callback_id,
                property_name,
                ctx,
                visited_symbol_ids,
            )
        });
    }
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        property_key_matches_name(&property.key, property_name)
            && r3f_binding_pattern_symbol_id(&property.value) == Some(symbol_id)
    }) && declarator.init.as_ref().is_some_and(|initializer| {
        r3f_resolves_to_callback_state(initializer, callback_id, ctx, visited_symbol_ids)
    })
}

fn r3f_resolves_to_callback_state<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    callback_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let oxc_ast::ast::Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if r3f_callback_parameter_symbol(callback_id, ctx) == Some(symbol_id) {
        return true;
    }
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
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) && r3f_binding_pattern_symbol_id(&declarator.id) == Some(symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            r3f_resolves_to_callback_state(initializer, callback_id, ctx, visited_symbol_ids)
        })
}

fn r3f_callback_parameter_symbol(
    callback_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    r3f_binding_pattern_symbol_id(r3f_unwrap_assignment_pattern(
        r3f_callback_first_parameter(callback_id, ctx),
    )?)
}

fn r3f_callback_parameter_property_symbol_matches(
    callback_id: oxc_semantic::NodeId,
    symbol_id: oxc_semantic::SymbolId,
    property_name: &str,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let parameter = r3f_unwrap_assignment_pattern(r3f_callback_first_parameter(callback_id, ctx));
    let Some(oxc_ast::ast::BindingPattern::ObjectPattern(pattern)) = parameter else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        property_key_matches_name(&property.key, property_name)
            && r3f_binding_pattern_symbol_id(&property.value) == Some(symbol_id)
    })
}

fn r3f_callback_first_parameter<'a, 'b>(
    callback_id: oxc_semantic::NodeId,
    ctx: &'b crate::context::LintContext<'a>,
) -> Option<&'b oxc_ast::ast::BindingPattern<'a>> {
    match ctx.nodes().get_node(callback_id).kind() {
        oxc_ast::AstKind::Function(function) => function
            .params
            .items
            .first()
            .map(|parameter| &parameter.pattern),
        oxc_ast::AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .first()
            .map(|parameter| &parameter.pattern),
        _ => None,
    }
}

fn r3f_unwrap_assignment_pattern<'a>(
    pattern: Option<&'a oxc_ast::ast::BindingPattern<'a>>,
) -> Option<&'a oxc_ast::ast::BindingPattern<'a>> {
    match pattern? {
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => Some(&assignment.left),
        pattern => Some(pattern),
    }
}

fn r3f_binding_pattern_symbol_id(
    pattern: &oxc_ast::ast::BindingPattern<'_>,
) -> Option<oxc_semantic::SymbolId> {
    match pattern {
        oxc_ast::ast::BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
            r3f_binding_pattern_symbol_id(&assignment.left)
        }
        _ => None,
    }
}
