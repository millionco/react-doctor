use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This form is nested inside another form, which is invalid HTML and can make controls submit through the wrong form. Separate the forms.";

#[derive(Debug, Default, Clone)]
pub struct HtmlNoNestedForm;

declare_oxc_lint!(
    /// Disallow nested form elements.
    HtmlNoNestedForm,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow nested form elements.",
);

impl Rule for HtmlNoNestedForm {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !is_form_element(opening_element, ctx)
            || !ctx.nodes().ancestors(node.id()).skip(1).any(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::JSXElement(element) if is_form_element(&element.opening_element, ctx)
                )
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn is_form_element<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    resolve_jsx_element_type(opening_element, ctx)
        .is_some_and(|(element_type, _)| element_type == "form")
}
