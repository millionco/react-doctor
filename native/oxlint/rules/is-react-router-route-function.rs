fn is_react_router_route_function(
    function_node: &crate::AstNode<'_>,
    expected_name: &str,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(function_node.id());
    if let oxc_ast::AstKind::ObjectProperty(property) = parent.kind()
        && property.key.static_name().as_deref() == Some(expected_name)
        && oxc_span::GetSpan::span(&property.value) == oxc_span::GetSpan::span(function_node)
    {
        let route_object_node = ctx.nodes().parent_node(parent.id());
        return matches!(
            route_object_node.kind(),
            oxc_ast::AstKind::ObjectExpression(route_object)
                if is_static_react_router_route_object(route_object, ctx)
        );
    }

    if !has_capability(ctx, "react-router-framework") {
        return false;
    }

    if let oxc_ast::AstKind::Function(function) = function_node.kind()
        && function
            .id
            .as_ref()
            .is_some_and(|identifier| identifier.name == expected_name)
    {
        return matches!(parent.kind(), oxc_ast::AstKind::ExportDeclaration(_))
            && is_react_router_framework_module_filename(ctx);
    }
    let oxc_ast::AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return false;
    };
    if declarator.init.as_ref().is_none_or(|initializer| {
        oxc_span::GetSpan::span(initializer) != oxc_span::GetSpan::span(function_node)
    }) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.name != expected_name)
    {
        return false;
    }
    let declaration = ctx.nodes().parent_node(parent.id());
    if !matches!(declaration.kind(), oxc_ast::AstKind::VariableDeclaration(_)) {
        return false;
    }
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        oxc_ast::AstKind::ExportDeclaration(_)
    ) && is_react_router_framework_module_filename(ctx)
}

fn is_react_router_framework_module_filename(ctx: &crate::context::LintContext<'_>) -> bool {
    let is_absolute_filename = ctx.file_path().is_absolute();
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    let root_directory = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("rootDirectory"))
        .and_then(serde_json::Value::as_str)
        .filter(|root_directory| !root_directory.is_empty())
        .map(|root_directory| root_directory.replace('\\', "/"));
    let relative_filename = if is_absolute_filename && let Some(root_directory) = root_directory {
        let root_directory = root_directory.trim_end_matches('/');
        let Some(relative_filename) = filename
            .strip_prefix(root_directory)
            .and_then(|filename| filename.strip_prefix('/'))
        else {
            return false;
        };
        relative_filename
    } else {
        filename.as_str()
    };
    let is_route =
        relative_filename.starts_with("app/routes/") || relative_filename.contains("/app/routes/");
    let basename = relative_filename.rsplit('/').next().unwrap_or_default();
    let parent = relative_filename
        .strip_suffix(basename)
        .unwrap_or_default()
        .trim_end_matches('/');
    let is_app_module = parent == "app" || parent.ends_with("/app");
    is_route
        || (is_app_module
            && (["root.js", "root.jsx", "root.ts", "root.tsx"].contains(&basename)
                || [
                    "entry.client.js",
                    "entry.client.jsx",
                    "entry.client.ts",
                    "entry.client.tsx",
                    "entry.server.js",
                    "entry.server.jsx",
                    "entry.server.ts",
                    "entry.server.tsx",
                ]
                .contains(&basename)))
}
