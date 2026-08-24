use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const LAYOUT_COMPONENT_NAMES: [&str; 3] = ["Box", "Spacer", "Static"];
const TEXT_COMPONENT_NAMES: [&str; 2] = ["Text", "Transform"];

#[derive(Debug, Default, Clone)]
pub struct InkNoLayoutInsideText;

declare_oxc_lint!(
    /// Disallow Ink layout components inside Ink text components.
    InkNoLayoutInsideText,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow Ink layout components inside text.",
);

impl Rule for InkNoLayoutInsideText {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(element_name) = resolve_imported_jsx_component_name(opening_element, "ink", ctx)
        else {
            return;
        };
        if !LAYOUT_COMPONENT_NAMES.contains(&element_name) {
            return;
        }
        let Some(parent_ink_element_name) = nearest_parent_ink_element_name(node, ctx) else {
            return;
        };
        if !TEXT_COMPONENT_NAMES.contains(&parent_ink_element_name) {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Ink `<{element_name}>` cannot render inside `<{parent_ink_element_name}>`."
            ))
            .with_label(opening_element.span),
        );
    }
}

fn nearest_parent_ink_element_name<'a, 'b>(
    node: &AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b str> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            return None;
        };
        if element.opening_element.node_id.get() == node.id() {
            return None;
        }
        resolve_imported_jsx_component_name(&element.opening_element, "ink", ctx)
    })
}
