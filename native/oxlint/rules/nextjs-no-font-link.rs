use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str = "Loading Google Fonts with <link> blocks rendering & shifts layout.";

#[derive(Debug, Default, Clone)]
pub struct NextjsNoFontLink;

declare_oxc_lint!(
    /// Disallow render-blocking Google Fonts links in Next.js.
    NextjsNoFontLink,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow Google Fonts stylesheet links.",
);

impl Rule for NextjsNoFontLink {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type(opening_element, ctx).map(|(name, _)| name) != Some("link") {
            return;
        }
        let Some(href_value) = find_jsx_attribute(opening_element, "href")
            .and_then(|attribute| attribute.value.as_ref())
            .and_then(|value| get_direct_string_literal_attribute_value(value))
        else {
            return;
        };
        let rel_value = find_jsx_attribute(opening_element, "rel")
            .and_then(|attribute| attribute.value.as_ref())
            .and_then(|value| get_direct_string_literal_attribute_value(value));
        if rel_value.is_some_and(|value| value != "stylesheet")
            || !href_value.contains("fonts.googleapis.com")
            || !is_next_file_active(ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}
