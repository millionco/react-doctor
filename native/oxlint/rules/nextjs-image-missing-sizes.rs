use oxc_ast::{
    ast::{Expression, JSXAttributeItem, JSXAttributeValue, JSXElementName},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str =
    "next/image uses fill without sizes, so your users download the largest image.";

#[derive(Debug, Default, Clone)]
pub struct NextjsImageMissingSizes;

declare_oxc_lint!(
    /// Require sizes when a Next.js Image uses fill.
    NextjsImageMissingSizes,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require sizes on fill images.",
);

impl Rule for NextjsImageMissingSizes {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let is_image = match &opening_element.name {
            JSXElementName::Identifier(identifier) => identifier.name == "Image",
            JSXElementName::IdentifierReference(identifier) => identifier.name == "Image",
            _ => false,
        };
        if !is_image
            || opening_element
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        {
            return;
        }
        let Some(fill_attribute) = find_jsx_attribute(opening_element, "fill") else {
            return;
        };
        let is_fill_active = match &fill_attribute.value {
            None => true,
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                !matches!(container.expression.as_expression(), Some(Expression::BooleanLiteral(value)) if !value.value)
            }
            Some(_) => true,
        };
        if is_fill_active
            && find_jsx_attribute(opening_element, "sizes").is_none()
            && is_next_file_active(ctx)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
        }
    }
}
