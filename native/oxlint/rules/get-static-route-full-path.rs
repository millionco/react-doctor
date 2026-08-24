fn get_static_route_full_path<'a>(
    route_object: &'a oxc_ast::ast::ObjectExpression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<String> {
    let mut route_objects = Vec::new();
    let mut current_route = Some(route_object);
    while let Some(route) = current_route {
        route_objects.push(route);
        let route_array_node = ctx.nodes().parent_node(route.node_id.get());
        let oxc_ast::AstKind::ArrayExpression(_) = route_array_node.kind() else {
            break;
        };
        let children_property_node = ctx.nodes().parent_node(route_array_node.id());
        let oxc_ast::AstKind::ObjectProperty(_) = children_property_node.kind() else {
            break;
        };
        let parent_route_node = ctx.nodes().parent_node(children_property_node.id());
        current_route = match parent_route_node.kind() {
            oxc_ast::AstKind::ObjectExpression(parent_route) => Some(parent_route),
            _ => None,
        };
    }
    route_objects.reverse();

    let mut path_segments = Vec::<String>::new();
    for route in route_objects {
        let Some(path_property) = get_static_route_property(route, "path") else {
            continue;
        };
        let route_path = get_static_string_expression(&path_property.value)?;
        if route_path.starts_with('/') {
            path_segments.clear();
        }
        let path_segment = route_path.trim_matches('/');
        if !path_segment.is_empty() {
            path_segments.push(path_segment.to_string());
        }
    }
    Some(format!("/{}", path_segments.join("/")))
}
