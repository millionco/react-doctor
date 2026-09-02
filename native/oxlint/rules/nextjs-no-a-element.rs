use oxc_ast::{
    ast::{JSXAttributeValue, JSXExpression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Plain <a> reloads the whole page for internal links, so Next.js loses client-side navigation and prefetching.";

#[derive(Debug, Default, Clone)]
pub struct NextjsNoAElement;

declare_oxc_lint!(
    /// Prefer Next.js Link for internal navigation.
    NextjsNoAElement,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer Next.js Link for internal navigation.",
);

impl Rule for NextjsNoAElement {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_next_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type(opening_element, ctx)
            .is_none_or(|(element_name, _)| element_name != "a")
        {
            return;
        }
        if let Some(download_attribute) = find_jsx_attribute(opening_element, "download") {
            let Some(download_value) = &download_attribute.value else {
                return;
            };
            if !is_false_or_null_literal(download_value) {
                return;
            }
        }
        if find_jsx_attribute(opening_element, "target")
            .and_then(|attribute| attribute.value.as_ref())
            .and_then(get_literal_string_value)
            == Some("_blank")
        {
            return;
        }
        let Some(href) = find_jsx_attribute(opening_element, "href")
            .and_then(|attribute| attribute.value.as_ref())
            .and_then(get_literal_string_value)
        else {
            return;
        };
        if !href.starts_with('/') || href.starts_with("//") {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn is_false_or_null_literal(value: &JSXAttributeValue) -> bool {
    let JSXAttributeValue::ExpressionContainer(container) = value else {
        return false;
    };
    matches!(&container.expression, JSXExpression::NullLiteral(_))
        || matches!(
            &container.expression,
            JSXExpression::BooleanLiteral(boolean) if !boolean.value
        )
}

fn get_literal_string_value<'a>(value: &'a JSXAttributeValue<'a>) -> Option<&'a str> {
    match value {
        JSXAttributeValue::StringLiteral(string_literal) => Some(string_literal.value.as_str()),
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::StringLiteral(string_literal) => Some(string_literal.value.as_str()),
            _ => None,
        },
        _ => None,
    }
}
