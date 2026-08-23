use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "AnimatePresence `mode=\"wait\"` supports only one child at a time, but this tree has multiple direct children. Use one child or another mode.";

#[derive(Debug, Default, Clone)]
pub struct MotionAnimatePresenceWaitSingleChild;

declare_oxc_lint!(
    /// Require a single direct child in AnimatePresence wait mode.
    MotionAnimatePresenceWaitSingleChild,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require a single direct child in AnimatePresence wait mode.",
);

impl Rule for MotionAnimatePresenceWaitSingleChild {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !motion_react_component_matches(&element.opening_element.name, "AnimatePresence", ctx) {
            return;
        }
        let Some(mode_attribute) =
            get_authoritative_jsx_attribute(&element.opening_element, "mode", true)
        else {
            return;
        };
        if get_string_literal_attribute_value(mode_attribute) == Some("wait")
            && get_static_direct_jsx_elements(element).len() >= 2
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(mode_attribute.span));
        }
    }
}
