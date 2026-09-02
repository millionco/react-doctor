use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

#[derive(Debug, Default, Clone)]
pub struct NoTailwindLayoutTransition;

declare_oxc_lint!(
    /// Disallow Tailwind transitions of layout properties.
    NoTailwindLayoutTransition,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow Tailwind transitions of layout properties.",
);

impl Rule for NoTailwindLayoutTransition {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if is_svg_layout_transition_exempt_element(opening_element) {
            return;
        }
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        for token in tailwind_class_name_tokens(class_name) {
            let Some(animated_properties) = token
                .utility
                .strip_prefix("transition-[")
                .and_then(|value| value.strip_suffix(']'))
                .filter(|value| !value.contains(']'))
            else {
                continue;
            };
            let Some(layout_property) = animated_properties
                .split(',')
                .map(|property| property.trim_matches(is_js_whitespace))
                .find(|property| is_layout_transition_property(property))
            else {
                continue;
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users see janky animation because `transition-[{animated_properties}]` animates \"{layout_property}\", a layout property the browser recomputes every frame, so animate transform & opacity instead."
                ))
                .with_label(opening_element.span),
            );
        }
    }
}
