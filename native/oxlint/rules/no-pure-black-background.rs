use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const INLINE_MESSAGE: &str = "Your users see a harsh pure #000 background, so nudge it toward your brand color, like #0a0a0f.";
const CLASS_MESSAGE: &str = "Your users see a harsh pure black background (bg-black), so use a near-black with a hint of your brand color, like bg-gray-950.";

#[derive(Debug, Default, Clone)]
pub struct NoPureBlackBackground;

declare_oxc_lint!(
    /// Disallow pure black inline and Tailwind backgrounds.
    NoPureBlackBackground,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow pure black backgrounds.",
);

impl Rule for NoPureBlackBackground {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => {
                let Some(style) = get_inline_style_object_expression(attribute) else {
                    return;
                };
                for property in &style.properties {
                    let matched_property =
                        ["backgroundColor", "background"]
                            .iter()
                            .find_map(|property_name| {
                                get_static_style_property_string_value(property, property_name)
                            });
                    if let Some((object_property, value)) = matched_property
                        && is_pure_black_color(value)
                    {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(INLINE_MESSAGE).with_label(object_property.span),
                        );
                    }
                }
            }
            AstKind::JSXOpeningElement(opening_element) => {
                let Some(class_name) = get_static_class_name(opening_element) else {
                    return;
                };
                if contains_pure_black_background_class(class_name) {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(CLASS_MESSAGE).with_label(opening_element.span),
                    );
                }
            }
            _ => {}
        }
    }
}

fn contains_pure_black_background_class(class_name: &str) -> bool {
    let bytes = class_name.as_bytes();
    class_name
        .match_indices("bg-black")
        .any(|(match_index, _)| {
            let before_is_boundary = match_index == 0 || !is_word_byte(bytes[match_index - 1]);
            let after_index = match_index + "bg-black".len();
            let after_is_boundary = bytes
                .get(after_index)
                .is_none_or(|byte| !is_word_byte(*byte));
            let has_opacity_modifier = bytes.get(after_index) == Some(&b'/');
            before_is_boundary && after_is_boundary && !has_opacity_modifier
        })
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
