fn resolve_recursive_animation_frame_callback<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    should_require_unconditional_schedule: bool,
    ctx: &crate::context::LintContext<'a>,
) -> Option<(bool, oxc_span::Span)> {
    if !is_global_request_animation_frame_call(call_expression, ctx) {
        return None;
    }
    let callback = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .and_then(|argument| {
            resolve_exact_animation_frame_callback(argument, ctx, &mut Vec::new())
        })?;
    let callback_node = ctx.nodes().iter().find(|candidate| {
        oxc_span::GetSpan::span(*candidate) == callback.1
            && matches!(
                candidate.kind(),
                oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
            )
    })?;
    ctx.nodes()
        .iter()
        .any(|candidate| {
            if !callback
                .1
                .contains_inclusive(oxc_span::GetSpan::span(candidate))
                || is_inside_nested_animation_frame_function(candidate, callback_node.id(), ctx)
                || (should_require_unconditional_schedule
                    && !is_on_unconditional_animation_frame_path(
                        candidate,
                        callback_node.id(),
                        ctx,
                    ))
            {
                return false;
            }
            let oxc_ast::AstKind::CallExpression(recursive_call) = candidate.kind() else {
                return false;
            };
            is_global_request_animation_frame_call(recursive_call, ctx)
                && recursive_call
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                    .and_then(|argument| {
                        resolve_exact_animation_frame_callback(argument, ctx, &mut Vec::new())
                    })
                    .is_some_and(|(_, recursive_callback_span)| {
                        recursive_callback_span == callback.1
                    })
        })
        .then_some(callback)
}

fn is_global_request_animation_frame_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let callee = call_expression.callee.get_inner_expression();
    if let oxc_ast::ast::Expression::Identifier(identifier) = callee {
        return identifier.name == "requestAnimationFrame"
            && ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_none();
    }
    let Some(member_expression) = callee.as_member_expression() else {
        return false;
    };
    if member_expression.static_property_name() != Some("requestAnimationFrame") {
        return false;
    }
    let oxc_ast::ast::Expression::Identifier(namespace_identifier) =
        member_expression.object().get_inner_expression()
    else {
        return false;
    };
    matches!(namespace_identifier.name.as_str(), "window" | "globalThis")
        && ctx
            .scoping()
            .get_reference(namespace_identifier.reference_id())
            .symbol_id()
            .is_none()
}

fn resolve_exact_animation_frame_callback<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<(bool, oxc_span::Span)> {
    use oxc_span::GetSpan;

    let expression = expression.get_inner_expression();
    match expression {
        oxc_ast::ast::Expression::ArrowFunctionExpression(function) => {
            Some((function.r#async, function.span))
        }
        oxc_ast::ast::Expression::FunctionExpression(function) => {
            Some((function.r#async, function.span))
        }
        oxc_ast::ast::Expression::CallExpression(call_expression) => {
            let member_expression = call_expression.callee.as_member_expression()?;
            (member_expression.static_property_name() == Some("bind"))
                .then(|| member_expression.object())
                .and_then(|bound_function| {
                    resolve_exact_animation_frame_callback(bound_function, ctx, visited_symbol_ids)
                })
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
            if let oxc_ast::AstKind::Function(function) = declaration.kind() {
                return Some((function.r#async, function.span()));
            }
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
            resolve_exact_animation_frame_callback(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => {
            let member_expression = expression.as_member_expression()?;
            matches!(
                member_expression.static_property_name(),
                Some("call" | "apply")
            )
            .then(|| member_expression.object())
            .and_then(|called_function| {
                resolve_exact_animation_frame_callback(called_function, ctx, visited_symbol_ids)
            })
        }
    }
}

fn is_inside_nested_animation_frame_function(
    node: &crate::AstNode<'_>,
    callback_node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    for parent in ctx.nodes().ancestors(node.id()) {
        if parent.id() == callback_node_id {
            return false;
        }
        if matches!(
            parent.kind(),
            oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
        ) {
            return true;
        }
    }
    true
}

fn is_on_unconditional_animation_frame_path(
    node: &crate::AstNode<'_>,
    callback_node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    for parent in ctx.nodes().ancestors(node.id()) {
        if parent.id() == callback_node_id {
            return true;
        }
        if matches!(
            parent.kind(),
            oxc_ast::AstKind::CatchClause(_)
                | oxc_ast::AstKind::ConditionalExpression(_)
                | oxc_ast::AstKind::DoWhileStatement(_)
                | oxc_ast::AstKind::ForInStatement(_)
                | oxc_ast::AstKind::ForOfStatement(_)
                | oxc_ast::AstKind::ForStatement(_)
                | oxc_ast::AstKind::IfStatement(_)
                | oxc_ast::AstKind::LogicalExpression(_)
                | oxc_ast::AstKind::SwitchCase(_)
                | oxc_ast::AstKind::SwitchStatement(_)
                | oxc_ast::AstKind::TryStatement(_)
                | oxc_ast::AstKind::WhileStatement(_)
        ) {
            return false;
        }
    }
    false
}
