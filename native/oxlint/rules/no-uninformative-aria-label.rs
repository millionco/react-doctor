use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "An `aria-label` should name the action or destination, not the element type — this value tells screen-reader users nothing. Use something like `aria-label=\"Search\"` or `aria-label=\"Close dialog\"`.";
const UNINFORMATIVE_LABELS: &[&str] = &[
    "icon", "button", "image", "img", "graphic", "svg", "picture", "element", "field", "input",
];

#[derive(Debug, Default, Clone)]
pub struct NoUninformativeAriaLabel;

declare_oxc_lint!(
    /// Disallow uninformative aria-label values.
    NoUninformativeAriaLabel,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow uninformative aria-label values.",
);

impl Rule for NoUninformativeAriaLabel {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(attribute) = find_jsx_attribute(opening_element, "aria-label") else {
            return;
        };
        let Some(label) = get_string_literal_attribute_value(attribute) else {
            return;
        };
        let normalized_label = label
            .trim_matches(|character: char| character.is_whitespace() || character == '\u{feff}')
            .to_lowercase();
        if !UNINFORMATIVE_LABELS.contains(&normalized_label.as_str()) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
    }
}
