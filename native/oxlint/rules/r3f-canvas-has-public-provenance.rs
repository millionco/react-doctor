fn r3f_canvas_has_public_provenance<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    const R3F_PUBLIC_MODULES: [&str; 5] = [
        "@react-three/fiber",
        "@react-three/fiber/legacy",
        "@react-three/fiber/native",
        "@react-three/fiber/webgpu",
        "react-three-fiber",
    ];
    R3F_PUBLIC_MODULES.iter().any(|module_source| {
        resolve_imported_jsx_component_name(opening_element, module_source, ctx) == Some("Canvas")
    })
}
