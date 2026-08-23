use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "A status is advisory and implicitly polite, but `aria-live=\"assertive\"` can interrupt or clear queued speech. Keep the status polite.";

#[derive(Debug, Default, Clone)]
pub struct NoAssertiveStatus;

declare_oxc_lint!(
    /// Disallow assertive status live regions.
    NoAssertiveStatus,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow assertive status live regions.",
);

impl Rule for NoAssertiveStatus {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !is_proven_intrinsic_jsx_element(opening_element, ctx) {
            return;
        }
        let Some(role_attribute) = get_authoritative_jsx_attribute(opening_element, "role", false)
        else {
            return;
        };
        let Some(live_attribute) =
            get_authoritative_jsx_attribute(opening_element, "aria-live", false)
        else {
            return;
        };
        if !get_string_literal_attribute_value(role_attribute)
            .is_some_and(|role| role.eq_ignore_ascii_case("status"))
            || !get_string_literal_attribute_value(live_attribute)
                .is_some_and(|live| live.eq_ignore_ascii_case("assertive"))
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(live_attribute.span));
    }
}
