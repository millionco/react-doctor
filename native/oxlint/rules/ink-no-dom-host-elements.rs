use oxc_ast::{ast::JSXElementName, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, globals::HTML_TAG, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct InkNoDomHostElements;

declare_oxc_lint!(
    /// Disallow DOM host elements inside Ink trees.
    InkNoDomHostElements,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow DOM host elements inside Ink trees.",
);

impl Rule for InkNoDomHostElements {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let ink_tree = module_jsx_tree_index("ink", ctx);
        if ink_tree.is_empty() {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let JSXElementName::Identifier(identifier) = &opening_element.name else {
                continue;
            };
            if !HTML_TAG.contains(identifier.name.as_str()) {
                continue;
            }
            let Some(element_span) = owning_jsx_element_span(node, ctx) else {
                continue;
            };
            if !ink_tree.contains_or_is_inside(element_span) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "DOM host `<{}>` cannot be rendered by Ink.",
                    identifier.name
                ))
                .with_label(opening_element.span),
            );
        }
    }
}
