use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct JsxNoDuplicateProps;

declare_oxc_lint!(
    /// Disallow duplicate JSX props.
    JsxNoDuplicateProps,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow duplicate JSX props.",
);

impl Rule for JsxNoDuplicateProps {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let mut seen_prop_names = FxHashSet::default();
        for attribute in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let JSXAttributeName::Identifier(identifier) = &attribute.name else {
                continue;
            };
            if !seen_prop_names.insert(identifier.name) {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Your users can get the wrong value because React keeps only the last \"{}\" & drops the first.",
                        identifier.name
                    ))
                    .with_label(attribute.span),
                );
            }
        }
    }
}
