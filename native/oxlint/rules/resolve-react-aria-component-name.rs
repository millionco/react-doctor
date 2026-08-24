fn resolve_react_aria_component_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<String> {
    let api_path = resolve_jsx_import_api_path(
        element_name,
        |module_source| module_source == "react-aria-components",
        ctx,
    )?;
    let [component_name] = api_path.as_slice() else {
        return None;
    };
    Some(component_name.clone())
}
