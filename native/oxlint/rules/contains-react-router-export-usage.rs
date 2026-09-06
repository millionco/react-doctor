const REACT_ROUTER_EXPORT_USAGE_MODULE_SOURCES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];

fn contains_react_router_export_usage<'a>(
    root: &oxc_ast::ast::Expression<'a>,
    export_names: &[&str],
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let root_span = oxc_span::GetSpan::span(root);
    ctx.nodes().iter().any(|candidate| {
        if !root_span.contains_inclusive(oxc_span::GetSpan::span(candidate))
            || is_inside_nested_react_router_usage_function(candidate, root_span, ctx)
        {
            return false;
        }
        match candidate.kind() {
            oxc_ast::AstKind::CallExpression(call_expression) => {
                let oxc_ast::ast::Expression::Identifier(identifier) = &call_expression.callee
                else {
                    return false;
                };
                direct_named_import_matches(
                    identifier,
                    export_names,
                    &REACT_ROUTER_EXPORT_USAGE_MODULE_SOURCES,
                    ctx,
                )
            }
            oxc_ast::AstKind::JSXOpeningElement(opening_element)
                if matches!(
                    opening_element.name,
                    oxc_ast::ast::JSXElementName::IdentifierReference(_)
                ) => REACT_ROUTER_EXPORT_USAGE_MODULE_SOURCES
                .iter()
                .any(|module_source| {
                    resolve_imported_jsx_component_name(opening_element, module_source, ctx)
                        .is_some_and(|imported_name| export_names.contains(&imported_name))
                }),
            _ => false,
        }
    })
}

fn is_inside_nested_react_router_usage_function(
    candidate: &crate::AstNode<'_>,
    root_span: oxc_span::Span,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(candidate.id())
        .take_while(|ancestor| root_span.contains_inclusive(oxc_span::GetSpan::span(*ancestor)))
        .any(|ancestor| {
            oxc_span::GetSpan::span(ancestor) != root_span
                && matches!(
                    ancestor.kind(),
                    oxc_ast::AstKind::Function(_)
                        | oxc_ast::AstKind::ArrowFunctionExpression(_)
                )
        })
}
