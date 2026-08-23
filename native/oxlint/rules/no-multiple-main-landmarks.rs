use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This static view contains more than one main landmark. Keep a single main region and use sectioning elements for subordinate content.";

#[derive(Debug, Default, Clone)]
pub struct NoMultipleMainLandmarks;

declare_oxc_lint!(
    /// Disallow multiple main landmarks in one static JSX tree.
    NoMultipleMainLandmarks,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow multiple main landmarks in one static JSX tree.",
);

impl Rule for NoMultipleMainLandmarks {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let Some(opening_elements) = get_static_jsx_tree_opening_elements(node, ctx) else {
            return;
        };
        for opening_element in opening_elements
            .into_iter()
            .filter(|opening_element| {
                resolve_jsx_element_type(opening_element, ctx)
                    .is_some_and(|(element_type, _)| element_type == "main")
            })
            .skip(1)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
        }
    }
}
