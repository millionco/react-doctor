use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "`100vw` is wider than the viewport whenever a scrollbar is visible, so it triggers horizontal scroll on most desktops. Use `w-full` / `width: 100%` (with the parent's padding) for a full-bleed element.";
const FULL_VIEWPORT_WIDTH_UTILITIES: [&str; 4] =
    ["w-screen", "min-w-screen", "w-[100vw]", "min-w-[100vw]"];

#[derive(Debug, Default, Clone)]
pub struct NoFullViewportWidth;

declare_oxc_lint!(
    /// Disallow full viewport width values that can overflow the scrollbar gutter.
    NoFullViewportWidth,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow full viewport width overflow patterns.",
);

impl Rule for NoFullViewportWidth {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => {
                let Some(style) = get_inline_style_object_expression(attribute) else {
                    return;
                };
                for property_name in ["width", "minWidth"] {
                    let Some((property, value)) =
                        get_effective_static_style_property_string_value(style, property_name)
                    else {
                        continue;
                    };
                    if value.trim().eq_ignore_ascii_case("100vw") {
                        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(property.span));
                    }
                }
            }
            AstKind::JSXOpeningElement(opening_element) => {
                let Some(class_name) = get_static_class_name(opening_element) else {
                    return;
                };
                if tailwind_class_name_tokens(class_name)
                    .iter()
                    .any(|token| FULL_VIEWPORT_WIDTH_UTILITIES.contains(&token.utility))
                {
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
                }
            }
            _ => {}
        }
    }
}
