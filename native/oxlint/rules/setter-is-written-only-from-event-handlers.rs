const MAX_EVENT_HANDLER_PROOF_DEPTH: usize = 8;

fn setter_is_written_only_from_event_handlers(
    setter_symbol_id: oxc_semantic::SymbolId,
    component_node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let mut has_writer = false;
    for reference in ctx.scoping().get_resolved_references(setter_symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        if !is_setter_writer_usage(reference_node, component_node_id, ctx) {
            continue;
        }
        has_writer = true;
        if !is_inside_proven_event_handler(reference_node.id(), component_node_id, true, 0, ctx) {
            return false;
        }
    }
    has_writer
}

fn is_setter_writer_usage(
    node: &crate::AstNode<'_>,
    component_node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_span::GetSpan;

    let parent = ctx.nodes().parent_node(node.id());
    if matches!(
        parent.kind(),
        oxc_ast::AstKind::CallExpression(call_expression)
            if call_expression.callee.span() == node.span()
                || call_expression.arguments.iter().any(|argument| {
                    argument
                        .as_expression()
                        .is_some_and(|expression| expression.span() == node.span())
                })
    ) {
        return true;
    }
    is_inside_inline_event_handler(node.id(), component_node_id, ctx)
}

fn is_inside_proven_event_handler(
    node_id: oxc_semantic::NodeId,
    component_node_id: oxc_semantic::NodeId,
    allow_one_call_frame: bool,
    proof_depth: usize,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    if proof_depth >= MAX_EVENT_HANDLER_PROOF_DEPTH {
        return false;
    }
    if is_inside_inline_event_handler(node_id, component_node_id, ctx) {
        return true;
    }
    let Some(function_node_id) =
        enclosing_event_handler_function_node_id(node_id, component_node_id, ctx)
    else {
        return false;
    };
    if function_is_wired_only_to_event_handlers(
        function_node_id,
        component_node_id,
        proof_depth + 1,
        ctx,
    ) {
        return true;
    }
    allow_one_call_frame
        && function_is_called_only_from_event_handlers(
            function_node_id,
            component_node_id,
            proof_depth + 1,
            ctx,
        )
}

fn enclosing_event_handler_function_node_id(
    node_id: oxc_semantic::NodeId,
    component_node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes()
        .ancestors(node_id)
        .take_while(|ancestor| ancestor.id() != component_node_id)
        .find_map(|ancestor| {
            matches!(
                ancestor.kind(),
                oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
            )
            .then(|| ancestor.id())
        })
}

fn event_handler_function_symbol_id(
    function_node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let function_node = ctx.nodes().get_node(function_node_id);
    if let oxc_ast::AstKind::Function(function) = function_node.kind()
        && function.is_function_declaration()
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id());
    }
    let mut ancestor = ctx.nodes().parent_node(function_node_id);
    loop {
        match ancestor.kind() {
            oxc_ast::AstKind::VariableDeclarator(declarator) => {
                let oxc_ast::ast::BindingPattern::BindingIdentifier(identifier) = &declarator.id
                else {
                    return None;
                };
                return Some(identifier.symbol_id());
            }
            oxc_ast::AstKind::Function(_)
            | oxc_ast::AstKind::ArrowFunctionExpression(_)
            | oxc_ast::AstKind::Program(_) => return None,
            _ => ancestor = ctx.nodes().parent_node(ancestor.id()),
        }
    }
}

fn function_is_wired_only_to_event_handlers(
    function_node_id: oxc_semantic::NodeId,
    component_node_id: oxc_semantic::NodeId,
    proof_depth: usize,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_span::GetSpan;

    let Some(function_symbol_id) = event_handler_function_symbol_id(function_node_id, ctx) else {
        return false;
    };
    let mut is_wired = false;
    for reference in ctx.scoping().get_resolved_references(function_symbol_id) {
        if is_inside_inline_event_handler(reference.node_id(), component_node_id, ctx) {
            is_wired = true;
            continue;
        }
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let parent = ctx.nodes().parent_node(reference.node_id());
        let is_call = matches!(
            parent.kind(),
            oxc_ast::AstKind::CallExpression(call_expression)
                if call_expression.callee.span() == reference_node.span()
        );
        if is_call
            && (enclosing_event_handler_function_node_id(parent.id(), component_node_id, ctx)
                == Some(function_node_id)
                || is_inside_proven_event_handler(
                    parent.id(),
                    component_node_id,
                    false,
                    proof_depth,
                    ctx,
                ))
        {
            continue;
        }
        return false;
    }
    is_wired
}

fn function_is_called_only_from_event_handlers(
    function_node_id: oxc_semantic::NodeId,
    component_node_id: oxc_semantic::NodeId,
    proof_depth: usize,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_span::GetSpan;

    let Some(function_symbol_id) = event_handler_function_symbol_id(function_node_id, ctx) else {
        return false;
    };
    let mut has_call = false;
    for reference in ctx.scoping().get_resolved_references(function_symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let parent = ctx.nodes().parent_node(reference.node_id());
        if !matches!(
            parent.kind(),
            oxc_ast::AstKind::CallExpression(call_expression)
                if call_expression.callee.span() == reference_node.span()
        ) {
            continue;
        }
        has_call = true;
        if !is_inside_proven_event_handler(parent.id(), component_node_id, false, proof_depth, ctx)
        {
            return false;
        }
    }
    has_call
}

fn is_inside_inline_event_handler(
    node_id: oxc_semantic::NodeId,
    component_node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == component_node_id {
            return false;
        }
        if let oxc_ast::AstKind::JSXAttribute(attribute) = ancestor.kind()
            && let oxc_ast::ast::JSXAttributeName::Identifier(identifier) = &attribute.name
            && is_event_handler_name(identifier.name.as_str())
        {
            return true;
        }
        if let oxc_ast::AstKind::ObjectProperty(property) = ancestor.kind()
            && !property.computed
            && property
                .key
                .static_name()
                .is_some_and(|name| is_event_handler_name(name.as_ref()))
        {
            return true;
        }
    }
    false
}

fn is_event_handler_name(name: &str) -> bool {
    name.starts_with("on") && name.as_bytes().get(2).is_some_and(u8::is_ascii_uppercase)
}
