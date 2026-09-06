use oxc_ast::{
    AstKind,
    ast::{JSXChild, JSXElement, JSXExpression, JSXOpeningElement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This details disclosure has no explicit summary as its first content child, so the browser falls back to an implementation-defined label. Add a meaningful summary first.";

enum FirstStaticContent<'a> {
    Missing,
    Element(&'a JSXOpeningElement<'a>),
    Dynamic,
}

#[derive(Debug, Default, Clone)]
pub struct DetailsRequiresSummary;

declare_oxc_lint!(
    /// Require a summary as the first content child of details.
    DetailsRequiresSummary,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require a summary as the first content child of details.",
);

impl Rule for DetailsRequiresSummary {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let Some((element_type, _)) = resolve_jsx_element_type(&element.opening_element, ctx)
        else {
            return;
        };
        if element_type != "details" {
            return;
        }
        match get_first_static_content(element) {
            FirstStaticContent::Dynamic => {}
            FirstStaticContent::Element(opening_element) => {
                if resolve_jsx_element_type(opening_element, ctx)
                    .is_some_and(|(element_type, _)| element_type == "summary")
                {
                    return;
                }
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
            }
            FirstStaticContent::Missing => {
                ctx.diagnostic(
                    OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span),
                );
            }
        }
    }
}

fn get_first_static_content<'a>(element: &'a JSXElement<'a>) -> FirstStaticContent<'a> {
    for child in &element.children {
        match child {
            JSXChild::Text(text) if text.value.trim().is_empty() => {}
            JSXChild::Element(element) => {
                return FirstStaticContent::Element(&element.opening_element);
            }
            JSXChild::ExpressionContainer(container)
                if matches!(container.expression, JSXExpression::EmptyExpression(_)) => {}
            _ => return FirstStaticContent::Dynamic,
        }
    }
    FirstStaticContent::Missing
}
