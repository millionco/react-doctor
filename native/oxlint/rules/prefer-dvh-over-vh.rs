use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "`100vh` is taller than the visible viewport on mobile (it ignores the browser's dynamic toolbars), so full-height layouts get clipped. Use the dynamic-viewport unit: `h-dvh` / `min-h-dvh` (or `100dvh`).";
const FULL_VIEWPORT_HEIGHT_UTILITIES: [&str; 4] =
    ["h-screen", "min-h-screen", "h-[100vh]", "min-h-[100vh]"];

#[derive(Debug, Default, Clone)]
pub struct PreferDvhOverVh;

declare_oxc_lint!(
    /// Prefer dynamic viewport height units for full-height layouts.
    PreferDvhOverVh,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prefer dynamic viewport height units.",
);

impl Rule for PreferDvhOverVh {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => {
                let Some(style) = get_inline_style_object_expression(attribute) else {
                    return;
                };
                for property_name in ["height", "minHeight"] {
                    let Some((property, value)) =
                        get_effective_static_style_property_string_value(style, property_name)
                    else {
                        continue;
                    };
                    if value.trim().eq_ignore_ascii_case("100vh") {
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
                    .any(|token| FULL_VIEWPORT_HEIGHT_UTILITIES.contains(&token.utility))
                {
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
                }
            }
            _ => {}
        }
    }
}
