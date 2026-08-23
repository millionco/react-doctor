use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This direct AnimatePresence child has no key, so Motion cannot reliably match it with its exiting instance. Add a stable unique key.";

#[derive(Debug, Default, Clone)]
pub struct MotionAnimatePresenceRequiresKey;

declare_oxc_lint!(
    /// Require keys on multiple direct AnimatePresence children.
    MotionAnimatePresenceRequiresKey,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require keys on multiple direct AnimatePresence children.",
);

impl Rule for MotionAnimatePresenceRequiresKey {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !motion_react_component_matches(&element.opening_element.name, "AnimatePresence", ctx) {
            return;
        }
        let direct_elements = get_static_direct_jsx_elements(element);
        if direct_elements.len() < 2 {
            return;
        }
        for child in direct_elements {
            if find_jsx_attribute(&child.opening_element, "key").is_none() {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(child.opening_element.span));
            }
        }
    }
}
