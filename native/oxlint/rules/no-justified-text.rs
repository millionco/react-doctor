use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Your users read big uneven gaps between words because justified text has no hyphens, so use text-align: left, or add hyphens: auto.";

#[derive(Debug, Default, Clone)]
pub struct NoJustifiedText;

declare_oxc_lint!(
    /// Require automatic hyphenation for justified inline text styles.
    NoJustifiedText,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require hyphenation for justified text.",
);

impl Rule for NoJustifiedText {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        let Some(style) = get_inline_style_object_expression(attribute) else {
            return;
        };
        let mut is_justified = false;
        let mut has_hyphens = false;
        for property in &style.properties {
            if get_static_style_property_string_value(property, "textAlign")
                .is_some_and(|(_, value)| value == "justify")
            {
                is_justified = true;
            }
            if ["hyphens", "WebkitHyphens"].iter().any(|property_name| {
                get_static_style_property_string_value(property, property_name)
                    .is_some_and(|(_, value)| value == "auto")
            }) {
                has_hyphens = true;
            }
        }
        if is_justified && !has_hyphens {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
        }
    }
}
