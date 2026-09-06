use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode, context::LintContext, globals::HTML_TAG, rule::Rule, utils::get_element_type,
};

const MESSAGE: &str = "The `scope` attribute only works on `<th>` cells, so screen readers get no table-header help from it here.";

#[derive(Debug, Default, Clone)]
pub struct Scope;

declare_oxc_lint!(
    /// Disallow scope attributes outside table headers.
    Scope,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow scope attributes outside table headers.",
);

impl Rule for Scope {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(scope_attribute) = opening_element.attributes.iter().find_map(|attribute| {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                return None;
            };
            matches!(
                &attribute.name,
                JSXAttributeName::Identifier(identifier) if identifier.name == "scope"
            )
            .then_some(attribute)
        }) else {
            return;
        };
        let tag_name = get_element_type(ctx, opening_element);
        if tag_name != "th" && HTML_TAG.contains(tag_name.as_ref()) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(scope_attribute.span));
        }
    }
}
