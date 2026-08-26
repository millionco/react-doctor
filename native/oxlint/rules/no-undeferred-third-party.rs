use oxc_ast::{AstKind, ast::JSXAttributeValue};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EXECUTABLE_SCRIPT_TYPES: [&str; 3] = [
    "text/javascript",
    "application/javascript",
    "module",
];
const MESSAGE: &str = "This <script> blocks the page from showing to your users until it loads. Add defer or async so it loads in the background.";

#[derive(Debug, Default, Clone)]
pub struct NoUndeferredThirdParty;

declare_oxc_lint!(
    /// Disallow render-blocking third-party scripts.
    NoUndeferredThirdParty,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow render-blocking third-party scripts.",
);

impl Rule for NoUndeferredThirdParty {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type(opening_element, ctx).map(|(name, _)| name) != Some("script") {
            return;
        }
        let Some(source_attribute) = find_jsx_attribute(opening_element, "src") else {
            return;
        };
        if matches!(
            source_attribute.value.as_ref(),
            Some(JSXAttributeValue::StringLiteral(source))
                if !no_undeferred_third_party_is_external_url(source.value.as_str())
        )
            || find_jsx_attribute(opening_element, "noModule").is_some()
        {
            return;
        }
        if let Some(JSXAttributeValue::StringLiteral(script_type)) =
            find_jsx_attribute(opening_element, "type").and_then(|attribute| attribute.value.as_ref())
            && (script_type.value == "module"
                || !EXECUTABLE_SCRIPT_TYPES.contains(&script_type.value.as_str()))
        {
            return;
        }
        if find_jsx_attribute(opening_element, "defer").is_none()
            && find_jsx_attribute(opening_element, "async").is_none()
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
        }
    }
}

fn no_undeferred_third_party_is_external_url(source: &str) -> bool {
    source.starts_with("//")
        || source
            .get(..7)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://"))
        || source
            .get(..8)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
}
