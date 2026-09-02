fn effect_invokes_stored_disposer<'a>(
    effect_callback_id: oxc_semantic::NodeId,
    resource_node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'a>,
    mut resolve_exact_local_function: impl FnMut(
        &'a oxc_ast::ast::Expression<'a>,
    ) -> Option<oxc_semantic::NodeId>,
    mut function_releases_resource: impl FnMut(oxc_semantic::NodeId) -> bool,
) -> bool {
    let Some(resource_owner_id) = stored_disposer_nearest_function_id(resource_node_id, ctx) else {
        return false;
    };
    if resource_owner_id == effect_callback_id
        || !stored_disposer_function_has_block_body(resource_owner_id, ctx)
    {
        return false;
    }
    let resource_node = ctx.nodes().get_node(resource_node_id);
    let resource_owner_node = ctx.nodes().get_node(resource_owner_id);
    let releasing_owner_returns = stored_disposer_return_nodes(resource_owner_id, ctx)
        .into_iter()
        .filter(|return_node| {
            let oxc_ast::AstKind::ReturnStatement(statement) = return_node.kind() else {
                return false;
            };
            statement
                .argument
                .as_ref()
                .and_then(&mut resolve_exact_local_function)
                .is_some_and(&mut function_releases_resource)
        })
        .collect::<Vec<_>>();
    if !do_nodes_cover_every_path_after_node(
        resource_node,
        &releasing_owner_returns,
        resource_owner_node,
        ctx,
    ) {
        return false;
    }
    let Some(resource_owner_symbol_id) =
        stored_disposer_function_binding_symbol_id(resource_owner_id, ctx)
    else {
        return false;
    };
    let resource_owner_references = ctx
        .scoping()
        .get_resolved_references(resource_owner_symbol_id)
        .collect::<Vec<_>>();
    let [resource_owner_reference] = resource_owner_references.as_slice() else {
        return false;
    };
    let resource_owner_reference_root_id =
        stored_disposer_transparent_root_node_id(resource_owner_reference.node_id(), ctx);
    let resource_owner_reference_root = ctx.nodes().get_node(resource_owner_reference_root_id);
    let resource_owner_call_node = ctx.nodes().parent_node(resource_owner_reference_root_id);
    let oxc_ast::AstKind::CallExpression(resource_owner_call) = resource_owner_call_node.kind()
    else {
        return false;
    };
    if resource_owner_call.callee.span() != resource_owner_reference_root.span() {
        return false;
    }
    let resource_owner_call_root_id =
        stored_disposer_transparent_root_node_id(resource_owner_call_node.id(), ctx);
    let storage_assignment_node = ctx.nodes().parent_node(resource_owner_call_root_id);
    let oxc_ast::AstKind::AssignmentExpression(storage_assignment) = storage_assignment_node.kind()
    else {
        return false;
    };
    if storage_assignment.operator.as_str() != "="
        || storage_assignment.right.span()
            != ctx.nodes().get_node(resource_owner_call_root_id).span()
        || stored_disposer_nearest_function_id(storage_assignment_node.id(), ctx)
            != Some(effect_callback_id)
    {
        return false;
    }
    let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(storage_identifier) =
        &storage_assignment.left
    else {
        return false;
    };
    let Some(storage_symbol_id) = ctx
        .scoping()
        .get_reference(storage_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let storage_declaration = ctx.symbol_declaration(storage_symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(storage_declarator) = storage_declaration.kind()
    else {
        return false;
    };
    let storage_variable_declaration = ctx.nodes().parent_node(storage_declaration.id());
    if !matches!(storage_variable_declaration.kind(), oxc_ast::AstKind::VariableDeclaration(declaration)
        if matches!(declaration.kind,
            oxc_ast::ast::VariableDeclarationKind::Let
                | oxc_ast::ast::VariableDeclarationKind::Var))
        || stored_disposer_nearest_function_id(storage_declaration.id(), ctx)
            != Some(effect_callback_id)
        || storage_declarator
            .init
            .as_ref()
            .is_none_or(|initializer| !stored_disposer_is_empty_function(initializer))
    {
        return false;
    }
    let mut cleanup_calls = Vec::new();
    for reference in ctx.scoping().get_resolved_references(storage_symbol_id) {
        let reference_root_id = stored_disposer_transparent_root_node_id(reference.node_id(), ctx);
        let reference_root = ctx.nodes().get_node(reference_root_id);
        if reference_root.span() == storage_assignment.left.span() {
            continue;
        }
        let parent = ctx.nodes().parent_node(reference_root_id);
        let oxc_ast::AstKind::CallExpression(call) = parent.kind() else {
            return false;
        };
        if call.callee.span() != reference_root.span() {
            return false;
        }
        let Some(call_owner_id) = stored_disposer_nearest_function_id(parent.id(), ctx) else {
            return false;
        };
        cleanup_calls.push((parent, call_owner_id));
    }
    if cleanup_calls.is_empty() {
        return false;
    }
    let mut matched_cleanup_owner_ids = rustc_hash::FxHashSet::default();
    let matching_effect_returns = stored_disposer_return_nodes(effect_callback_id, ctx)
        .into_iter()
        .filter(|return_node| {
            let oxc_ast::AstKind::ReturnStatement(statement) = return_node.kind() else {
                return false;
            };
            let Some(cleanup_id) = statement
                .argument
                .as_ref()
                .and_then(&mut resolve_exact_local_function)
            else {
                return false;
            };
            let cleanup_node = ctx.nodes().get_node(cleanup_id);
            let matching_calls = cleanup_calls
                .iter()
                .filter_map(|(call, owner_id)| (*owner_id == cleanup_id).then_some(*call))
                .collect::<Vec<_>>();
            if matching_calls.is_empty()
                || !do_nodes_cover_every_path_after_node(
                    cleanup_node,
                    &matching_calls,
                    cleanup_node,
                    ctx,
                )
            {
                return false;
            }
            matched_cleanup_owner_ids.insert(cleanup_id);
            true
        })
        .collect::<Vec<_>>();
    cleanup_calls
        .iter()
        .all(|(_, owner_id)| matched_cleanup_owner_ids.contains(owner_id))
        && do_nodes_cover_every_path_after_node(
            storage_assignment_node,
            &matching_effect_returns,
            ctx.nodes().get_node(effect_callback_id),
            ctx,
        )
}

fn stored_disposer_nearest_function_id(
    node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}

fn stored_disposer_function_has_block_body(
    function_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        oxc_ast::AstKind::Function(function) => function.body.is_some(),
        oxc_ast::AstKind::ArrowFunctionExpression(function) => function.get_expression().is_none(),
        _ => false,
    }
}

fn stored_disposer_return_nodes<'a, 'b>(
    function_id: oxc_semantic::NodeId,
    ctx: &'b crate::context::LintContext<'a>,
) -> Vec<&'b crate::AstNode<'a>> {
    ctx.nodes()
        .iter()
        .filter(|node| {
            matches!(node.kind(), oxc_ast::AstKind::ReturnStatement(statement) if statement.argument.is_some())
                && stored_disposer_nearest_function_id(node.id(), ctx) == Some(function_id)
        })
        .collect()
}

fn stored_disposer_function_binding_symbol_id(
    function_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let function_node = ctx.nodes().get_node(function_id);
    if let oxc_ast::AstKind::Function(function) = function_node.kind()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.symbol_id());
    }
    let function_root_id = stored_disposer_transparent_root_node_id(function_id, ctx);
    let function_root = ctx.nodes().get_node(function_root_id);
    let parent = ctx.nodes().parent_node(function_root_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != function_root.span())
    {
        return None;
    }
    declarator
        .id
        .get_binding_identifier()
        .map(|identifier| identifier.symbol_id())
}

fn stored_disposer_transparent_root_node_id(
    node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> oxc_semantic::NodeId {
    let mut root_id = node_id;
    loop {
        let parent = ctx.nodes().parent_node(root_id);
        if !matches!(
            parent.kind(),
            oxc_ast::AstKind::ParenthesizedExpression(_)
                | oxc_ast::AstKind::TSAsExpression(_)
                | oxc_ast::AstKind::TSSatisfiesExpression(_)
                | oxc_ast::AstKind::TSNonNullExpression(_)
                | oxc_ast::AstKind::TSTypeAssertion(_)
                | oxc_ast::AstKind::ChainExpression(_)
        ) {
            return root_id;
        }
        root_id = parent.id();
    }
}

fn stored_disposer_is_empty_function(expression: &oxc_ast::ast::Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::ArrowFunctionExpression(function) => function
            .body
            .as_function_body()
            .is_some_and(|body| body.statements.is_empty()),
        oxc_ast::ast::Expression::FunctionExpression(function) => function
            .body
            .as_ref()
            .is_some_and(|body| body.statements.is_empty()),
        _ => false,
    }
}
