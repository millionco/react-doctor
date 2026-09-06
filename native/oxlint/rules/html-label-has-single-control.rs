use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const LABELABLE_TAG_NAMES: [&str; 7] = [
    "button", "input", "meter", "output", "progress", "select", "textarea",
];
const MESSAGE: &str = "This label contains multiple native controls, but a label can identify only one control. Split the labels or name the group with fieldset and legend.";

#[derive(Debug, Default, Clone)]
pub struct HtmlLabelHasSingleControl;

declare_oxc_lint!(
    /// Disallow labels that wrap multiple native controls.
    HtmlLabelHasSingleControl,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow labels that wrap multiple native controls.",
);

impl Rule for HtmlLabelHasSingleControl {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type(&element.opening_element, ctx)
            .is_none_or(|(element_type, _)| element_type != "label")
        {
            return;
        }
        let mut opening_elements = Vec::new();
        collect_static_jsx_opening_elements(&element.children, &mut opening_elements);
        let control_count = opening_elements
            .into_iter()
            .filter(|opening_element| {
                resolve_jsx_element_type(opening_element, ctx).is_some_and(
                    |(element_type, _)| LABELABLE_TAG_NAMES.contains(&element_type),
                )
            })
            .take(2)
            .count();
        if control_count < 2 {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span),
        );
    }
}
