use oxc_ast::{
    ast::{JSXAttributeValue, JSXExpression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "Server-side image maps require pointer coordinates and do not expose individual targets to keyboard or assistive-technology users. Replace this isMap image with semantic links.";

#[derive(Debug, Default, Clone)]
pub struct NoServerSideImageMap;

declare_oxc_lint!(
    /// Disallow server-side image maps.
    NoServerSideImageMap,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow server-side image maps.",
);

impl Rule for NoServerSideImageMap {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type(opening_element, ctx).map(|(name, _)| name) != Some("img") {
            return;
        }
        let Some(attribute) = get_authoritative_jsx_attribute(opening_element, "isMap", false)
        else {
            return;
        };
        if !is_statically_enabled(attribute) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
    }
}

fn is_statically_enabled(attribute: &oxc_ast::ast::JSXAttribute) -> bool {
    match attribute.value.as_ref() {
        None | Some(JSXAttributeValue::StringLiteral(_)) => true,
        Some(JSXAttributeValue::ExpressionContainer(container)) => match &container.expression {
            JSXExpression::BooleanLiteral(boolean_literal) => boolean_literal.value,
            JSXExpression::StringLiteral(_)
            | JSXExpression::NumericLiteral(_)
            | JSXExpression::NullLiteral(_)
            | JSXExpression::BigIntLiteral(_)
            | JSXExpression::RegExpLiteral(_) => true,
            _ => false,
        },
        _ => false,
    }
}
