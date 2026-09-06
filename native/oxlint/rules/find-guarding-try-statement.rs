fn find_guarding_try_statement(
    node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let mut child_node_id = node_id;
    for ancestor in ctx.nodes().ancestors(node_id) {
        if is_function_like_ast_kind(ancestor.kind())
            && !is_immediately_invoked_function(ancestor, ctx)
        {
            return false;
        }
        if let oxc_ast::AstKind::TryStatement(try_statement) = ancestor.kind()
            && try_statement.block.node_id.get() == child_node_id
            && let Some(handler) = &try_statement.handler
            && !catch_clause_rethrows_caught(handler, ctx)
        {
            return true;
        }
        child_node_id = ancestor.id();
    }
    false
}

fn catch_clause_rethrows_caught(
    handler: &oxc_ast::ast::CatchClause<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_ast::ast::{BindingPattern, Expression};

    let Some(parameter) = &handler.param else {
        return false;
    };
    let BindingPattern::BindingIdentifier(caught_binding) = &parameter.pattern else {
        return false;
    };

    ctx.nodes().iter().any(|candidate| {
        let oxc_ast::AstKind::ThrowStatement(throw_statement) = candidate.kind() else {
            return false;
        };
        let Expression::Identifier(identifier) = &throw_statement.argument else {
            return false;
        };
        handler.body.span.contains_inclusive(throw_statement.span)
            && identifier.name == caught_binding.name
            && throw_reaches_catch_clause(candidate, handler, ctx)
    })
}

fn throw_reaches_catch_clause(
    throw_node: &crate::AstNode<'_>,
    handler: &oxc_ast::ast::CatchClause<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let mut child_node_id = throw_node.id();
    for ancestor in ctx.nodes().ancestors(throw_node.id()) {
        if ancestor.id() == handler.node_id.get() {
            return true;
        }
        if is_function_like_ast_kind(ancestor.kind()) {
            return false;
        }
        if let oxc_ast::AstKind::TryStatement(try_statement) = ancestor.kind()
            && try_statement.block.node_id.get() == child_node_id
            && let Some(inner_handler) = &try_statement.handler
            && !catch_clause_rethrows_caught(inner_handler, ctx)
        {
            return false;
        }
        child_node_id = ancestor.id();
    }
    false
}

fn is_function_like_ast_kind(kind: oxc_ast::AstKind<'_>) -> bool {
    matches!(
        kind,
        oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
    )
}

fn is_immediately_invoked_function(
    function_node: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_span::GetSpan;

    let Some(oxc_ast::AstKind::CallExpression(call_expression)) =
        crate::ast_util::iter_outer_expressions(ctx.nodes(), function_node.id()).next()
    else {
        return false;
    };
    call_expression
        .callee
        .span()
        .contains_inclusive(function_node.span())
}
