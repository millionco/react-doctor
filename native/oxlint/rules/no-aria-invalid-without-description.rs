use oxc_ast::{
    ast::{JSXAttributeItem, JSXAttributeValue, JSXExpression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "This control is marked invalid but is not connected to explanatory error text. Reference the error with aria-describedby or aria-errormessage.";

#[derive(Debug, Default, Clone)]
pub struct NoAriaInvalidWithoutDescription;

declare_oxc_lint!(
    /// Require an error description for statically invalid form controls.
    NoAriaInvalidWithoutDescription,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require an error description for statically invalid form controls.",
);

impl Rule for NoAriaInvalidWithoutDescription {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !matches!(
            resolve_jsx_element_type(opening_element, ctx).map(|(name, _)| name),
            Some("input" | "select" | "textarea")
        ) || opening_element
            .attributes
            .iter()
            .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        {
            return;
        }
        let Some(invalid_attribute) =
            get_authoritative_jsx_attribute(opening_element, "aria-invalid", false)
        else {
            return;
        };
        if !is_statically_invalid(invalid_attribute)
            || find_jsx_attribute(opening_element, "aria-describedby").is_some()
            || find_jsx_attribute(opening_element, "aria-errormessage").is_some()
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(invalid_attribute.span));
    }
}

fn is_statically_invalid(attribute: &oxc_ast::ast::JSXAttribute) -> bool {
    match attribute.value.as_ref() {
        None => true,
        Some(JSXAttributeValue::StringLiteral(string_literal)) => {
            matches!(
                string_literal.value.as_str(),
                "true" | "grammar" | "spelling"
            )
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => match &container.expression {
            JSXExpression::BooleanLiteral(boolean_literal) => boolean_literal.value,
            JSXExpression::StringLiteral(string_literal) => string_literal.value == "true",
            _ => false,
        },
        _ => false,
    }
}
