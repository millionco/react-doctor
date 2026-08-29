fn is_inside_statically_hidden_jsx_subtree<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        let oxc_ast::AstKind::JSXElement(element) = ancestor.kind() else {
            return false;
        };
        is_statically_hidden_opening_element(&element.opening_element, ctx)
    })
}

fn is_statically_hidden_opening_element<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    if is_statically_hidden_from_screen_reader(opening_element, ctx) {
        return true;
    }
    let style_attribute = get_authoritative_jsx_attribute(opening_element, "style", true);
    if let Some(style_expression) =
        style_attribute
            .and_then(|attribute| get_inline_style_object_expression_with_aliases(attribute, ctx))
    {
        if get_effective_static_style_property(style_expression, "display")
            .and_then(get_object_property_string_value)
            .is_some_and(|value| value.eq_ignore_ascii_case("none"))
        {
            return true;
        }
        if get_effective_static_style_property(style_expression, "visibility")
            .and_then(get_object_property_string_value)
            .is_some_and(|value| {
                value.eq_ignore_ascii_case("hidden") || value.eq_ignore_ascii_case("collapse")
            })
        {
            return true;
        }
    }
    let Some(class_name) = get_static_class_name(opening_element) else {
        return false;
    };
    get_tailwind_visibility_at_breakpoints(class_name)
        .is_some_and(|visibility| visibility.iter().all(|is_visible| !is_visible))
}
