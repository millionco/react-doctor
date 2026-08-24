fn resolve_shadcn_component_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    module_name: &str,
    ctx: &crate::context::LintContext<'a>,
) -> Option<String> {
    let api_path = resolve_jsx_import_api_path(
        element_name,
        |module_source| is_shadcn_component_module(module_source, module_name),
        ctx,
    )?;
    let [component_name] = api_path.as_slice() else {
        return None;
    };
    Some(component_name.clone())
}

fn is_shadcn_component_module(module_source: &str, module_name: &str) -> bool {
    let normalized_source = module_source.replace('\\', "/");
    let expected_suffix = format!("/{module_name}");
    normalized_source.ends_with(&expected_suffix)
        && (normalized_source.starts_with("./")
            || normalized_source.starts_with("../")
            || normalized_source == format!("ui/{module_name}")
            || normalized_source.contains("/ui/"))
}
