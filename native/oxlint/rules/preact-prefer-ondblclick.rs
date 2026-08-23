use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "Your users get no response from `onDoubleClick` in Preact core, where it never fires, so use `onDblClick` instead, which matches the DOM event name.";

#[derive(Debug, Default, Clone)]
pub struct PreactPreferOndblclick;

declare_oxc_lint!(
    /// Prefer Preact's DOM-standard onDblClick event name.
    PreactPreferOndblclick,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prefer onDblClick on Preact host elements.",
);

impl Rule for PreactPreferOndblclick {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some((element_name, _)) = resolve_jsx_element_type(opening_element, ctx) else {
            return;
        };
        if !element_name.chars().next().is_some_and(|first_character| {
            first_character
                .to_lowercase()
                .eq(std::iter::once(first_character))
        }) {
            return;
        }
        let Some(attribute) = find_jsx_attribute(opening_element, "onDoubleClick") else {
            return;
        };
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
    }
}
