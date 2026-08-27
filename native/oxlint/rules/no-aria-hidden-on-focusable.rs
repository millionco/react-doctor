use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "Screen reader users tab to this focusable element but hear nothing because `aria-hidden` skips it, so remove `aria-hidden` or stop it being focusable.";

#[derive(Debug, Default, Clone)]
pub struct NoAriaHiddenOnFocusable;

declare_oxc_lint!(
    /// Disallow aria-hidden on focusable elements.
    NoAriaHiddenOnFocusable,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow aria-hidden on focusable elements.",
);

impl Rule for NoAriaHiddenOnFocusable {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(oxc_ast::ast::JSXAttributeItem::Attribute(aria_hidden_attribute)) =
            has_jsx_prop_ignore_case(opening_element, "aria-hidden")
        else {
            return;
        };
        if !is_aria_hidden_true(aria_hidden_attribute)
            || !is_focusable_jsx_opening_element(
                opening_element,
                &resolve_configured_jsx_element_type(opening_element, ctx),
                false,
            )
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(aria_hidden_attribute.span));
    }
}

fn is_aria_hidden_true(attribute: &oxc_ast::ast::JSXAttribute) -> bool {
    match attribute.value.as_ref() {
        None => true,
        Some(oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal)) => {
            string_literal.value == "true"
        }
        Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) => {
            matches!(
                &container.expression,
                oxc_ast::ast::JSXExpression::BooleanLiteral(boolean_literal) if boolean_literal.value
            ) || matches!(
                &container.expression,
                oxc_ast::ast::JSXExpression::StringLiteral(string_literal) if string_literal.value == "true"
            )
        }
        _ => false,
    }
}
