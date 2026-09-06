fn get_react_router_middleware_next_symbol<'a>(
    function_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<oxc_semantic::SymbolId> {
    if !matches!(
        function_node.kind(),
        oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
    ) || !is_react_router_server_middleware_function(function_node, ctx)
    {
        return None;
    }
    let parameter = match function_node.kind() {
        oxc_ast::AstKind::Function(function) => function.params.items.get(1),
        oxc_ast::AstKind::ArrowFunctionExpression(function) => function.params.items.get(1),
        _ => None,
    }?;
    parameter
        .pattern
        .get_binding_identifier()
        .map(oxc_ast::ast::BindingIdentifier::symbol_id)
}

fn is_react_router_server_middleware_function<'a>(
    function_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(function_node.id());
    if is_exported_react_router_middleware_array(parent, ctx) {
        return true;
    }
    let Some(binding_symbol_id) = react_router_middleware_function_binding(function_node, ctx)
    else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(binding_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            is_exported_react_router_middleware_array(
                ctx.nodes().parent_node(reference_node.id()),
                ctx,
            )
        })
}

fn is_exported_react_router_middleware_array(
    node: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    if !matches!(node.kind(), oxc_ast::AstKind::ArrayExpression(_)) {
        return false;
    }
    let declarator_node = ctx.nodes().parent_node(node.id());
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
        return false;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|identifier| identifier.name != "middleware")
    {
        return false;
    }
    let declaration_node = ctx.nodes().parent_node(declarator_node.id());
    let export_node = ctx.nodes().parent_node(declaration_node.id());
    matches!(export_node.kind(), oxc_ast::AstKind::ExportDeclaration(_))
}

fn react_router_middleware_function_binding<'a>(
    function_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<oxc_semantic::SymbolId> {
    use oxc_span::GetSpan;

    if let oxc_ast::AstKind::Function(function) = function_node.kind()
        && function.is_function_declaration()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.symbol_id());
    }
    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    if let oxc_ast::AstKind::VariableDeclarator(declarator) = parent.kind() {
        return declarator
            .id
            .get_binding_identifier()
            .map(oxc_ast::ast::BindingIdentifier::symbol_id);
    }
    if let oxc_ast::AstKind::AssignmentExpression(assignment) = parent.kind()
        && assignment.right.span() == function_root.span()
        && let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) =
            &assignment.left
    {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id();
    }
    let oxc_ast::AstKind::CallExpression(_) = parent.kind() else {
        return None;
    };
    let declarator_node = ctx.nodes().parent_node(parent.id());
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
        return None;
    };
    declarator
        .id
        .get_binding_identifier()
        .map(oxc_ast::ast::BindingIdentifier::symbol_id)
}
