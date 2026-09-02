use oxc_ast::{
    ast::{JSXAttributeValue, JSXElementName},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str =
    "Manual Google Analytics scripts block rendering without Next.js' optimized loading strategy.";

#[derive(Debug, Default, Clone)]
pub struct NextjsNoGoogleAnalyticsScript;

declare_oxc_lint!(
    /// Disallow manually loaded Google Analytics scripts in Next.js.
    NextjsNoGoogleAnalyticsScript,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow manual Google Analytics scripts.",
);

impl Rule for NextjsNoGoogleAnalyticsScript {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let element_name = match &opening_element.name {
            JSXElementName::Identifier(identifier) => identifier.name.as_str(),
            JSXElementName::IdentifierReference(identifier) => identifier.name.as_str(),
            _ => return,
        };
        if !matches!(element_name, "script" | "Script") {
            return;
        }
        let Some(attribute) = find_jsx_attribute(opening_element, "src") else {
            return;
        };
        let Some(JSXAttributeValue::StringLiteral(source)) = &attribute.value else {
            return;
        };
        if !source.value.contains("google-analytics.com")
            && !source.value.contains("googletagmanager.com/gtag")
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}
