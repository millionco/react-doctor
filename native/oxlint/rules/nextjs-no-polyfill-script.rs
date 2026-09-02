use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str =
    "This polyfill CDN script makes your users download polyfills Next.js already includes.";

#[derive(Debug, Default, Clone)]
pub struct NextjsNoPolyfillScript;

declare_oxc_lint!(
    /// Disallow redundant polyfill scripts in Next.js.
    NextjsNoPolyfillScript,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow redundant polyfill scripts.",
);

impl Rule for NextjsNoPolyfillScript {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some((element_name, _)) = resolve_jsx_element_type(opening_element, ctx) else {
            return;
        };
        if element_name != "script" && element_name != "Script" {
            return;
        }
        let Some(source_value) = find_jsx_attribute(opening_element, "src")
            .and_then(|attribute| attribute.value.as_ref())
            .and_then(|value| get_direct_string_literal_attribute_value(value))
        else {
            return;
        };
        let request_url = source_value.split('#').next().unwrap_or_default();
        if request_url.is_empty()
            || !has_network_scheme(request_url)
            || !is_polyfill_url(request_url)
            || !is_next_file_active(ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn has_network_scheme(request_url: &str) -> bool {
    let trimmed_request_url =
        request_url.trim_start_matches(|character| is_js_whitespace(character));
    let mut characters = trimmed_request_url.char_indices();
    let Some((_, first_character)) = characters.next() else {
        return false;
    };
    if !first_character.is_ascii_alphabetic() {
        return true;
    }
    let scheme_end = characters.find_map(|(index, character)| {
        (!character.is_ascii_alphanumeric()
            && character != '+'
            && character != '.'
            && character != '-')
            .then_some((index, character))
    });
    let Some((scheme_end_index, ':')) = scheme_end else {
        return true;
    };
    let scheme = &trimmed_request_url[..scheme_end_index];
    scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https")
}

fn is_polyfill_url(request_url: &str) -> bool {
    request_url.contains("polyfill.io")
        || request_url.contains("polyfill.min.js")
        || request_url.contains("cdn.polyfill")
}
