use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::LintContext,
    rule::Rule,
    utils::{get_string_literal_prop_value, has_jsx_prop_ignore_case},
};

const MESSAGE: &str = "`<img loading=\"lazy\">` defers the request while `fetchPriority=\"high\"` asks the browser to rush it, so the two directives contradict each other. Drop one: keep `fetchPriority=\"high\"` (and eager loading) for an LCP image, or `loading=\"lazy\"` for a below-the-fold one.";

#[derive(Debug, Default, Clone)]
pub struct NoImgLazyWithHighFetchpriority;

declare_oxc_lint!(
    /// Disallow lazy images with high fetch priority.
    NoImgLazyWithHighFetchpriority,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow lazy images with high fetch priority.",
);

impl Rule for NoImgLazyWithHighFetchpriority {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !resolve_jsx_element_type(opening_element, ctx)
            .is_some_and(|(element_type, _)| element_type == "img")
        {
            return;
        }
        let Some(loading_attribute) = has_jsx_prop_ignore_case(opening_element, "loading") else {
            return;
        };
        if !get_string_literal_prop_value(loading_attribute)
            .is_some_and(|value| value.eq_ignore_ascii_case("lazy"))
        {
            return;
        }
        let Some(fetch_priority_attribute) =
            has_jsx_prop_ignore_case(opening_element, "fetchPriority")
        else {
            return;
        };
        if get_string_literal_prop_value(fetch_priority_attribute)
            .is_some_and(|value| value.eq_ignore_ascii_case("high"))
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.name.span()));
        }
    }
}
