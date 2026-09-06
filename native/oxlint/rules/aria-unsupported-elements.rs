use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode, context::LintContext, globals::RESERVED_HTML_TAG, rule::Rule, utils::get_element_type,
};

#[derive(Debug, Default, Clone)]
pub struct AriaUnsupportedElements;

declare_oxc_lint!(
    /// Disallow ARIA attributes on unsupported elements.
    AriaUnsupportedElements,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow ARIA attributes on unsupported elements.",
);

impl Rule for AriaUnsupportedElements {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let tag_name = get_element_type(ctx, opening_element);
        if !RESERVED_HTML_TAG.contains(&tag_name.as_ref()) {
            return;
        }
        for attribute in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let JSXAttributeName::Identifier(identifier) = &attribute.name else {
                continue;
            };
            let attribute_name = identifier.name.as_str();
            if attribute_name != "role" && !attribute_name.starts_with("aria-") {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Screen reader users get no help from `{attribute_name}` because `<{tag_name}>` doesn't accept it, so remove it from this element."
                ))
                .with_label(attribute.span),
            );
        }
    }
}
