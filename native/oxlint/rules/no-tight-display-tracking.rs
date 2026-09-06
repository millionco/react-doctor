use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const DISPLAY_HEADING_NAMES: [&str; 3] = ["h1", "h2", "h3"];
const MESSAGE: &str = "This display heading uses the tightest tracking preset, a common generated-hero default that can crowd letterforms. Use normal or moderately tight tracking.";

#[derive(Debug, Default, Clone)]
pub struct NoTightDisplayTracking;

declare_oxc_lint!(
    /// Disallow the tightest tracking preset on display headings.
    NoTightDisplayTracking,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow the tightest display heading tracking.",
);

impl Rule for NoTightDisplayTracking {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !matches!(
            &element.opening_element.name,
            JSXElementName::Identifier(identifier)
                if DISPLAY_HEADING_NAMES.contains(&identifier.name.as_str())
        ) || get_static_jsx_text(element)
            .trim_matches(|character| is_js_whitespace(character))
            .is_empty()
        {
            return;
        }
        let Some(class_name) = get_static_class_name(&element.opening_element) else {
            return;
        };
        if !tailwind_class_name_tokens(class_name)
            .iter()
            .any(|token| token.variants.is_empty() && token.utility == "tracking-tighter")
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}
