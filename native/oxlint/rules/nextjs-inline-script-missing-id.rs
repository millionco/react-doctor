use oxc_ast::{
    ast::{JSXAttributeItem, JSXElementName},
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
    "Without an id, Next.js can't track this inline <Script> & may execute it twice.";

#[derive(Debug, Default, Clone)]
pub struct NextjsInlineScriptMissingId;

declare_oxc_lint!(
    /// Require an id on inline Next.js Script elements.
    NextjsInlineScriptMissingId,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require an id on inline Next.js Script elements.",
);

impl Rule for NextjsInlineScriptMissingId {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !matches!(
            &opening_element.name,
            JSXElementName::IdentifierReference(identifier) if identifier.name == "Script"
        ) || opening_element.attributes.iter().any(|attribute| {
            matches!(attribute, JSXAttributeItem::SpreadAttribute(_))
                || attribute.as_attribute().is_some_and(|attribute| {
                    attribute.is_identifier("src") || attribute.is_identifier("id")
                })
        }) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}
