fn ink_render_call_is_related_to_node<'a>(
    render_call: &oxc_ast::ast::CallExpression<'a>,
    target_node: &crate::AstNode<'a>,
    api_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    if !imported_module_api_matches(&render_call.callee, api_name, "ink", ctx) {
        return false;
    }
    let Some(rendered_expression) = render_call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return false;
    };
    let rendered_span = oxc_span::GetSpan::span(rendered_expression);
    if rendered_span.contains_inclusive(oxc_span::GetSpan::span(target_node)) {
        return true;
    }
    let Some(target_symbol_id) = ink_component_symbol_for_node(target_node, ctx) else {
        return false;
    };
    ink_jsx_region_mounts_component(
        rendered_span,
        None,
        target_symbol_id,
        ctx,
        &mut rustc_hash::FxHashSet::default(),
    )
}

fn ink_component_symbol_for_node<'a>(
    target_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<oxc_semantic::SymbolId> {
    ctx.nodes()
        .ancestors(target_node.id())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
            ) && component_or_hook_function_name(ancestor, ctx).is_some()
        })
        .and_then(|component_node| ink_component_symbol(component_node, ctx))
}

fn ink_component_symbol<'a>(
    component_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<oxc_semantic::SymbolId> {
    if let oxc_ast::AstKind::Function(function) = component_node.kind()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.symbol_id());
    }
    let mut expression_root = transparent_expression_root(component_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        let oxc_ast::AstKind::CallExpression(call_expression) = parent.kind() else {
            break;
        };
        if !call_expression.arguments.first().is_some_and(|argument| {
            argument.as_expression().is_some_and(|expression| {
                oxc_span::GetSpan::span(expression) == oxc_span::GetSpan::span(expression_root)
            })
        }) || !matches!(
            call_expression.callee_name(),
            Some("memo" | "forwardRef" | "observer" | "lazy")
        ) {
            break;
        }
        expression_root = transparent_expression_root(parent, ctx);
    }
    let parent = ctx.nodes().parent_node(expression_root.id());
    let oxc_ast::AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    declarator
        .id
        .get_binding_identifier()
        .map(oxc_ast::ast::BindingIdentifier::symbol_id)
}

fn ink_jsx_region_mounts_component<'a>(
    region_span: oxc_span::Span,
    owner_function_node_id: Option<oxc_semantic::NodeId>,
    target_symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !region_span.contains_inclusive(oxc_span::GetSpan::span(candidate))
            || !ink_jsx_candidate_is_direct_in_region(
                candidate,
                region_span,
                owner_function_node_id,
                ctx,
            )
        {
            return false;
        }
        let oxc_ast::AstKind::JSXOpeningElement(opening_element) = candidate.kind() else {
            return false;
        };
        let oxc_ast::ast::JSXElementName::IdentifierReference(identifier) = &opening_element.name
        else {
            return false;
        };
        let Some(component_symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        component_symbol_id == target_symbol_id
            || ink_component_symbol_mounts_component(
                component_symbol_id,
                target_symbol_id,
                ctx,
                visited_symbol_ids,
            )
    })
}

fn ink_jsx_candidate_is_direct_in_region<'a>(
    candidate: &crate::AstNode<'a>,
    region_span: oxc_span::Span,
    owner_function_node_id: Option<oxc_semantic::NodeId>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(candidate.id()) {
        if !region_span.contains_inclusive(oxc_span::GetSpan::span(ancestor)) {
            break;
        }
        if matches!(ancestor.kind(), oxc_ast::AstKind::JSXAttribute(_)) {
            return false;
        }
        if matches!(
            ancestor.kind(),
            oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
        ) {
            return owner_function_node_id == Some(ancestor.id());
        }
    }
    owner_function_node_id.is_none()
}

fn ink_component_symbol_mounts_component<'a>(
    component_symbol_id: oxc_semantic::SymbolId,
    target_symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    if !visited_symbol_ids.insert(component_symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(component_symbol_id);
    let (region_span, owner_function_node_id) = match declaration.kind() {
        oxc_ast::AstKind::Function(function) => (function.span, declaration.id()),
        oxc_ast::AstKind::VariableDeclarator(declarator) => {
            let Some(initializer) = &declarator.init else {
                return false;
            };
            match initializer.get_inner_expression() {
                oxc_ast::ast::Expression::ArrowFunctionExpression(function) => {
                    (function.span, function.node_id.get())
                }
                oxc_ast::ast::Expression::FunctionExpression(function) => {
                    (function.span, function.node_id.get())
                }
                _ => return false,
            }
        }
        _ => return false,
    };
    ink_jsx_region_mounts_component(
        region_span,
        Some(owner_function_node_id),
        target_symbol_id,
        ctx,
        visited_symbol_ids,
    )
}
