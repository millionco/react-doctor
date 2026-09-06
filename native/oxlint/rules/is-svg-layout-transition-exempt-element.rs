fn is_svg_layout_transition_exempt_element(
    opening_element: &oxc_ast::ast::JSXOpeningElement,
) -> bool {
    const SVG_LAYOUT_TRANSITION_EXEMPT_ELEMENT_NAMES: [&str; 24] = [
        "svg",
        "g",
        "rect",
        "circle",
        "ellipse",
        "image",
        "line",
        "path",
        "polygon",
        "polyline",
        "text",
        "tspan",
        "textPath",
        "use",
        "marker",
        "mask",
        "pattern",
        "symbol",
        "defs",
        "clipPath",
        "linearGradient",
        "radialGradient",
        "stop",
        "filter",
    ];
    matches!(
        &opening_element.name,
        oxc_ast::ast::JSXElementName::Identifier(identifier)
            if SVG_LAYOUT_TRANSITION_EXEMPT_ELEMENT_NAMES.contains(&identifier.name.as_str())
    )
}
