fn is_r3f_canvas<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    [
        "@react-three/fiber",
        "@react-three/fiber/legacy",
        "@react-three/fiber/native",
        "@react-three/fiber/webgpu",
        "react-three-fiber",
    ]
    .iter()
    .any(|module_source| {
        resolve_imported_jsx_component_name(opening_element, module_source, ctx) == Some("Canvas")
    })
}
