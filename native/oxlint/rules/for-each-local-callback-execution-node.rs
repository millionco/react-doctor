fn for_each_local_callback_execution_node<'a>(
    callback_expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    mut visitor: impl FnMut(&crate::AstNode<'a>, oxc_semantic::NodeId, bool),
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
    let mut execution_functions = vec![(callback_id, false)];
    let mut pending_function_ids = vec![callback_id];
    while let Some(execution_function_id) = pending_function_ids.pop() {
        let is_conditionally_executed_by_call_site = execution_functions
            .iter()
            .find_map(|(function_id, is_conditional)| {
                (*function_id == execution_function_id).then_some(*is_conditional)
            })
            .unwrap_or(false);
        for candidate in ctx.nodes().iter() {
            if local_callback_nearest_function_id(candidate.id(), ctx)
                != Some(execution_function_id)
            {
                continue;
            }
            let AstKind::CallExpression(candidate_call) = candidate.kind() else {
                continue;
            };
            let Some(called_function_id) =
                exact_local_callback_function_id(&candidate_call.callee, ctx, &mut Vec::new())
            else {
                continue;
            };
            let is_conditionally_executed = is_conditionally_executed_by_call_site
                || is_node_conditionally_executed(candidate, execution_function_id, ctx);
            if let Some((_, previous_conditionality)) = execution_functions
                .iter_mut()
                .find(|(function_id, _)| *function_id == called_function_id)
            {
                if *previous_conditionality && !is_conditionally_executed {
                    *previous_conditionality = false;
                    pending_function_ids.push(called_function_id);
                }
            } else {
                execution_functions.push((called_function_id, is_conditionally_executed));
                pending_function_ids.push(called_function_id);
            }
        }
    }
    for (execution_function_id, is_conditionally_executed_by_call_site) in execution_functions {
        for candidate in ctx.nodes().iter() {
            if local_callback_nearest_function_id(candidate.id(), ctx)
                == Some(execution_function_id)
            {
                visitor(
                    candidate,
                    callback_id,
                    is_conditionally_executed_by_call_site
                        || is_node_conditionally_executed(candidate, execution_function_id, ctx),
                );
            }
        }
    }
}

fn exact_local_callback_function_id<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<oxc_semantic::NodeId> {
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        oxc_ast::ast::Expression::ArrowFunctionExpression(_)
    ) || matches!(expression, oxc_ast::ast::Expression::FunctionExpression(function) if !function.generator)
    {
        return Some(expression.node_id());
    }
    if visited_symbol_ids.len() >= 15 {
        return None;
    }
    match expression {
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
