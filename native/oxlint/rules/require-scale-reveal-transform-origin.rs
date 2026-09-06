use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This menu scales into view without an explicit transform origin, so it expands from its center instead of its trigger. Set a static origin that matches the attachment edge.";

#[derive(Debug, Default, Clone)]
pub struct RequireScaleRevealTransformOrigin;

declare_oxc_lint!(
    /// Require transform origins on menus and listboxes that scale into view.
    RequireScaleRevealTransformOrigin,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Require transform origins on scaled reveal surfaces.",
);

impl Rule for RequireScaleRevealTransformOrigin {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let role = get_authoritative_jsx_attribute(opening_element, "role", false)
            .and_then(|attribute| get_string_literal_attribute_value(attribute));
        if !role.is_some_and(|role| {
            role.eq_ignore_ascii_case("listbox") || role.eq_ignore_ascii_case("menu")
        }) || !has_scale_reveal(opening_element, ctx)
            || has_explicit_transform_origin(opening_element)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn has_scale_reveal<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ["initial", "exit"].iter().any(|property_name| {
        get_static_motion_property_object(opening_element, property_name, ctx)
            .and_then(|motion_object| get_effective_static_style_property(motion_object, "scale"))
            .and_then(|property| get_static_style_property_number_value(property))
            .is_some_and(|scale| (0.0..1.0).contains(&scale))
    })
}

fn has_explicit_transform_origin(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    if get_static_class_name(opening_element).is_some_and(|class_name| {
        tailwind_class_name_tokens(class_name)
            .iter()
            .any(|token| token.variants.is_empty() && token.utility.starts_with("origin-"))
    }) {
        return true;
    }
    opening_element.attributes.iter().any(|attribute| {
        let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
            return false;
        };
        let Some(style) = get_inline_style_object_expression(attribute) else {
            return false;
        };
        ["transformOrigin", "originX", "originY"]
            .iter()
            .any(|property_name| {
                get_effective_static_style_property(style, property_name).is_some()
            })
    })
}
