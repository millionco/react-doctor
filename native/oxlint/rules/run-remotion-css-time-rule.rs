fn run_remotion_css_time_rule<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
    style_property_names: &[&str],
    class_token_is_forbidden: fn(&str) -> bool,
    class_message: &'static str,
    style_message: &'static str,
) {
    let oxc_ast::AstKind::JSXAttribute(attribute) = node.kind() else {
        return;
    };
    if !is_render_phase_component_or_hook(node, ctx)
        || !remotion_render_function_has_evidence(node, ctx)
    {
        return;
    }
    let oxc_ast::ast::JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
        return;
    };
    if attribute_name.name == "className" {
        let Some(class_name) = get_string_literal_attribute_value(attribute) else {
            return;
        };
        if class_name.split_whitespace().any(|class_token| {
            class_token_is_forbidden(class_token.rsplit(':').next().unwrap_or(class_token))
        }) {
            ctx.diagnostic(
                oxc_diagnostics::OxcDiagnostic::warn(class_message).with_label(attribute.span),
            );
        }
        return;
    }
    let Some(style) = get_inline_style_object_expression(attribute) else {
        return;
    };
    for property in &style.properties {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let Some(property_name) = property.key.static_name() else {
            continue;
        };
        if !style_property_names.contains(&property_name.as_ref())
            || get_static_string_expression(&property.value)
                .is_some_and(|value| value.trim().eq_ignore_ascii_case("none"))
        {
            continue;
        }
        ctx.diagnostic(
            oxc_diagnostics::OxcDiagnostic::warn(style_message).with_label(property.span),
        );
    }
}
