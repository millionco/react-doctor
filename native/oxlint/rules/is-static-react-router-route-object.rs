use oxc_span::GetSpan;

const STATIC_ROUTE_CONFIG_EXPORT_NAMES: [&str; 4] = [
    "createBrowserRouter",
    "createHashRouter",
    "createMemoryRouter",
    "useRoutes",
];
const STATIC_ROUTE_RUNTIME_MODULE_SOURCES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];

fn is_static_react_router_route_object<'a>(
    route_object: &'a oxc_ast::ast::ObjectExpression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let route_array_node = ctx.nodes().parent_node(route_object.node_id.get());
    let oxc_ast::AstKind::ArrayExpression(route_array) = route_array_node.kind() else {
        return false;
    };
    let array_parent = ctx.nodes().parent_node(route_array_node.id());
    match array_parent.kind() {
        oxc_ast::AstKind::CallExpression(call_expression) => {
            let oxc_ast::ast::Expression::Identifier(callee_identifier) =
                call_expression.callee.get_inner_expression()
            else {
                return false;
            };
            call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                .is_some_and(|argument| argument.span() == route_array.span)
                && direct_named_import_matches(
                    callee_identifier,
                    &STATIC_ROUTE_CONFIG_EXPORT_NAMES,
                    &STATIC_ROUTE_RUNTIME_MODULE_SOURCES,
                    ctx,
                )
        }
        oxc_ast::AstKind::ObjectProperty(children_property)
            if children_property.key.static_name().as_deref() == Some("children") =>
        {
            let parent_route = ctx.nodes().parent_node(array_parent.id());
            matches!(
                parent_route.kind(),
                oxc_ast::AstKind::ObjectExpression(parent_route_object)
                    if is_static_react_router_route_object(parent_route_object, ctx)
            )
        }
        _ => false,
    }
}
