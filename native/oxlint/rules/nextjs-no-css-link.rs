use oxc_ast::{ast::JSXAttributeValue, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str =
    "This <link rel=\"stylesheet\"> bypasses Next.js CSS handling, so the CSS loads unbundled and unoptimized.";

#[derive(Debug, Default, Clone)]
pub struct NextjsNoCssLink;

declare_oxc_lint!(
    /// Warns when a local stylesheet bypasses Next.js CSS handling.
    NextjsNoCssLink,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when a stylesheet bypasses Next.js CSS handling.",
);

impl Rule for NextjsNoCssLink {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_next_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type(opening_element, ctx).map(|(name, _)| name) != Some("link")
            || find_jsx_attribute(opening_element, "rel").and_then(|attribute| {
                match attribute.value.as_ref()? {
                    JSXAttributeValue::StringLiteral(literal) => Some(literal.value.as_str()),
                    JSXAttributeValue::ExpressionContainer(container) => {
                        let oxc_ast::ast::Expression::StringLiteral(literal) =
                            container.expression.as_expression()?
                        else {
                            return None;
                        };
                        Some(literal.value.as_str())
                    }
                    _ => None,
                }
            }) != Some("stylesheet")
            || find_jsx_attribute(opening_element, "href")
                .and_then(|attribute| attribute.value.as_ref())
                .is_none()
        {
            return;
        }
        if get_authoritative_jsx_attribute(opening_element, "href", true)
            .and_then(|attribute| get_static_jsx_attribute_string_values(attribute, ctx))
            .is_some_and(|href_candidates| {
                !href_candidates.is_empty()
                    && href_candidates
                        .iter()
                        .all(|href_candidate| is_http_stylesheet_url(href_candidate))
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn is_http_stylesheet_url(value: &str) -> bool {
    value
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://"))
        || value
            .get(..8)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
}
