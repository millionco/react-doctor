use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct NoLayoutTransitionInline;

declare_oxc_lint!(
    /// Disallow inline transitions of layout properties.
    NoLayoutTransitionInline,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow inline layout transitions.",
);

impl Rule for NoLayoutTransitionInline {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        let Some(style) = get_inline_style_object_expression(attribute) else {
            return;
        };
        if matches!(
            ctx.nodes().parent_kind(node.id()),
            AstKind::JSXOpeningElement(opening_element)
                if is_svg_layout_transition_exempt_element(opening_element)
        ) {
            return;
        }
        for property_name in ["transition", "transitionProperty"] {
            let Some((property, value)) =
                get_effective_static_style_property_string_value(style, property_name)
            else {
                continue;
            };
            let normalized_value = value.to_lowercase();
            let mut value_tokens = normalized_value
                .split(|character| character == ',' || is_js_whitespace(character))
                .filter(|token| !token.is_empty());
            if value_tokens.clone().any(|token| token == "all") {
                continue;
            }
            let Some(layout_property) =
                value_tokens.find(|token| is_layout_transition_property(token))
            else {
                continue;
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users see janky, stuttering animation because \"{layout_property}\" relayouts the page every frame, so animate transform & opacity instead."
                ))
                .with_label(property.span),
            );
        }
    }
}
