fn is_r3f_host_intrinsic<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some((element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
        return false;
    };
    element_type
        .chars()
        .next()
        .is_some_and(|first_character| first_character.is_lowercase())
        && !element_type.contains('-')
        && !crate::globals::HTML_TAG.contains(element_type)
        && (!is_svg_tag_name(element_type)
            || (element_type == "line"
                && !ctx
                    .nodes()
                    .ancestors(opening_element.node_id.get())
                    .any(|ancestor| {
                        matches!(
                            ancestor.kind(),
                            oxc_ast::AstKind::JSXElement(element)
                                if matches!(
                                    &element.opening_element.name,
                                    oxc_ast::ast::JSXElementName::Identifier(identifier)
                                        if identifier.name == "svg"
                                )
                        )
                    })))
}
