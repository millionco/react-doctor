fn resolve_general_shadcn_ui_component_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<String> {
    let api_path = resolve_jsx_import_api_path(element_name, is_general_shadcn_ui_module, ctx)?;
    let [component_name] = api_path.as_slice() else {
        return None;
    };
    Some(component_name.clone())
}

fn is_general_shadcn_ui_module(module_source: &str) -> bool {
    let normalized_source = module_source.replace('\\', "/");
    let Some(ui_tail) = normalized_source.strip_prefix("ui/").or_else(|| {
        normalized_source
            .split_once("/ui/")
            .map(|(_, ui_tail)| ui_tail)
    }) else {
        return false;
    };
    let component_tail = ui_tail.strip_prefix("components/").unwrap_or(ui_tail);
    !component_tail.is_empty() && !component_tail.contains('/')
}
