use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttribute, JSXAttributeItem, JSXAttributeValue, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule, utils::has_jsx_prop_ignore_case};

const MESSAGE: &str = "Autoplaying media with sound is hostile to your users (and browsers block it). Add `muted` (with `playsInline`) to the autoplaying `<video>` / `<audio>`, or drop `autoPlay`.";

#[derive(Debug, Default, Clone)]
pub struct NoAutoplayWithoutMuted;

declare_oxc_lint!(
    /// Require autoplaying media to be muted.
    NoAutoplayWithoutMuted,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require autoplaying media to be muted.",
);

impl Rule for NoAutoplayWithoutMuted {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &opening_element.name else {
            return;
        };
        if !matches!(identifier.name.as_str(), "video" | "audio")
            || opening_element
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        {
            return;
        }
        let Some(JSXAttributeItem::Attribute(autoplay_attribute)) =
            has_jsx_prop_ignore_case(opening_element, "autoplay")
        else {
            return;
        };
        if resolve_static_boolean(autoplay_attribute) != Some(true) {
            return;
        }
        if let Some(JSXAttributeItem::Attribute(muted_attribute)) =
            has_jsx_prop_ignore_case(opening_element, "muted")
            && resolve_static_boolean(muted_attribute) != Some(false)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.name.span()));
    }
}

fn resolve_static_boolean(attribute: &JSXAttribute) -> Option<bool> {
    let Some(value) = attribute.value.as_ref() else {
        return Some(true);
    };
    match value {
        JSXAttributeValue::StringLiteral(_) => Some(true),
        JSXAttributeValue::ExpressionContainer(container) => {
            match container.expression.as_expression()?.get_inner_expression() {
                Expression::StringLiteral(_) => Some(true),
                Expression::BooleanLiteral(boolean_literal) => Some(boolean_literal.value),
                _ => None,
            }
        }
        _ => None,
    }
}
