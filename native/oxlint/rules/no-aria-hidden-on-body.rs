use oxc_ast::{
    ast::{JSXAttributeValue, JSXExpression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "aria-hidden on the document body removes the entire page from the accessibility tree. Hide only the specific inactive region instead.";

#[derive(Debug, Default, Clone)]
pub struct NoAriaHiddenOnBody;

declare_oxc_lint!(
    /// Disallow aria-hidden on the document body.
    NoAriaHiddenOnBody,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow aria-hidden on the document body.",
);

impl Rule for NoAriaHiddenOnBody {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type(opening_element, ctx).map(|(name, _)| name) != Some("body") {
            return;
        }
        let Some(attribute) =
            get_authoritative_jsx_attribute(opening_element, "aria-hidden", false)
        else {
            return;
        };
        if !is_statically_true(attribute) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
    }
}

fn is_statically_true(attribute: &oxc_ast::ast::JSXAttribute) -> bool {
    match attribute.value.as_ref() {
        None => true,
        Some(JSXAttributeValue::StringLiteral(string_literal)) => string_literal.value == "true",
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            matches!(
                &container.expression,
                JSXExpression::BooleanLiteral(boolean_literal) if boolean_literal.value
            ) || matches!(
                &container.expression,
                JSXExpression::StringLiteral(string_literal) if string_literal.value == "true"
            )
        }
        _ => false,
    }
}
