fn component_renders_ink<'a>(
    component_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    use oxc_span::GetSpan;

    ctx.nodes().iter().any(|candidate| {
        if !component_node.span().contains_inclusive(candidate.span())
            || nearest_component_render_function_node_id(candidate, ctx)
                != Some(component_node.id())
            || is_inside_component_jsx_attribute(candidate, component_node.id(), ctx)
        {
            return false;
        }
        let oxc_ast::AstKind::JSXOpeningElement(opening_element) = candidate.kind() else {
            return false;
        };
        resolve_imported_jsx_component_name(opening_element, "ink", ctx).is_some()
    })
}

fn nearest_component_render_function_node_id<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}

fn is_inside_component_jsx_attribute<'a>(
    node: &crate::AstNode<'a>,
    component_node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == component_node_id {
            return false;
        }
        if matches!(ancestor.kind(), oxc_ast::AstKind::JSXAttribute(_)) {
            return true;
        }
    }
    false
}
