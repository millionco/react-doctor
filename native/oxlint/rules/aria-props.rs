use oxc_ast::{AstKind, ast::JSXAttributeName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, globals::is_valid_aria_property, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct AriaProps;

declare_oxc_lint!(
    /// Disallow invalid ARIA attributes.
    AriaProps,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow invalid ARIA attributes.",
);

impl Rule for AriaProps {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        let JSXAttributeName::Identifier(identifier) = &attribute.name else {
            return;
        };
        let name = identifier.name.as_str();
        if name.starts_with("aria-") && !is_valid_aria_property(name) {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Screen reader users get no help from `{name}` because it isn't a real ARIA attribute, so fix the spelling against the WAI-ARIA list."
                ))
                .with_label(identifier.span),
            );
        }
    }
}
