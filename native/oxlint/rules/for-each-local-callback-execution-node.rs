fn for_each_local_callback_execution_node<'a>(
    callback_expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    mut visitor: impl FnMut(&crate::AstNode<'a>, oxc_semantic::NodeId),
) {
    use oxc_ast::AstKind;
    use oxc_span::GetSpan;

    let Some((_, callback_span)) = resolve_local_react_callback(callback_expression, ctx) else {
        return;
    };
    let Some(callback_id) = ctx.nodes().iter().find_map(|candidate| {
        (candidate.span() == callback_span
            && matches!(
                candidate.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ))
        .then_some(candidate.id())
    }) else {
        return;
    };
    let mut execution_function_ids = vec![callback_id];
    let mut execution_index = 0;
    while execution_index < execution_function_ids.len() {
        let execution_function_id = execution_function_ids[execution_index];
        execution_index += 1;
        for candidate in ctx.nodes().iter() {
            if local_callback_nearest_function_id(candidate.id(), ctx)
                != Some(execution_function_id)
            {
                continue;
            }
            let AstKind::CallExpression(candidate_call) = candidate.kind() else {
                continue;
            };
            if let Some(called_function_id) = exact_local_callback_function_id(
                &candidate_call.callee,
                ctx,
                &mut Vec::new(),
            ) && !execution_function_ids.contains(&called_function_id)
            {
                execution_function_ids.push(called_function_id);
            }
        }
    }
    for execution_function_id in execution_function_ids {
        for candidate in ctx.nodes().iter() {
            if local_callback_nearest_function_id(candidate.id(), ctx)
                == Some(execution_function_id)
            {
                visitor(candidate, callback_id);
            }
        }
    }
}

fn local_callback_nearest_function_id(
    node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn exact_local_callback_function_id<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<oxc_semantic::NodeId> {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        oxc_ast::ast::Expression::FunctionExpression(function) if !function.generator => {
            Some(function.node_id.get())
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
            match declaration.kind() {
                oxc_ast::AstKind::Function(function) if !function.generator => {
                    Some(function.node_id.get())
                }
                oxc_ast::AstKind::VariableDeclarator(declarator)
                    if matches!(
                        ctx.nodes().parent_node(declaration.id()).kind(),
                        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                            if variable_declaration.kind.is_const()
                    ) && declarator.id.get_binding_identifier().is_some_and(
                        |binding_identifier| binding_identifier.symbol_id() == symbol_id,
                    ) =>
                {
                    exact_local_callback_function_id(
                        declarator.init.as_ref()?,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                _ => None,
            }
        }
        _ => None,
    }
}
