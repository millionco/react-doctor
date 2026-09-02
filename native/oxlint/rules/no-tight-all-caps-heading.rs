use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const LONG_ALL_CAPS_HEADING_MIN_CHARACTERS: usize = 24;
const MESSAGE: &str = "This long all-caps heading can wrap with less than 1.0 line-height, causing adjacent capital lines to collide. Increase the leading or use ordinary casing.";

#[derive(Debug, Default, Clone)]
pub struct NoTightAllCapsHeading;

declare_oxc_lint!(
    /// Disallow collision-prone leading on long all-caps headings.
    NoTightAllCapsHeading,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow tight all-caps headings.",
);

impl Rule for NoTightAllCapsHeading {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &element.opening_element.name else {
            return;
        };
        if !is_heading_element_name(identifier.name.as_str()) {
            return;
        }
        let text = normalize_js_whitespace(&get_static_jsx_text(element));
        if text.encode_utf16().count() < LONG_ALL_CAPS_HEADING_MIN_CHARACTERS
            || !text.chars().any(char::is_alphabetic)
        {
            return;
        }
        let Some(class_name) = get_static_class_name(&element.opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let is_all_caps = tokens
            .iter()
            .any(|token| token.variants.is_empty() && token.utility == "uppercase")
            || !text.chars().any(char::is_lowercase);
        let has_tight_leading = tokens.iter().any(|token| {
            token.variants.is_empty()
                && (token.utility == "leading-none" || is_arbitrary_tight_leading(token.utility))
        });
        if !is_all_caps || !has_tight_leading {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn is_heading_element_name(name: &str) -> bool {
    name.len() == 2
        && name.starts_with('h')
        && name.as_bytes()[1].is_ascii_digit()
        && name.as_bytes()[1] >= b'1'
        && name.as_bytes()[1] <= b'6'
}

fn is_arbitrary_tight_leading(utility: &str) -> bool {
    let Some(value) = utility
        .strip_prefix("leading-[")
        .and_then(|value| value.strip_suffix(']'))
    else {
        return false;
    };
    if value == "0" {
        return true;
    }
    let Some(decimal) = value.strip_prefix("0.").or_else(|| value.strip_prefix('.')) else {
        return false;
    };
    !decimal.is_empty() && decimal.bytes().all(|byte| byte.is_ascii_digit())
}

fn normalize_js_whitespace(value: &str) -> String {
    value
        .split(|character| is_js_whitespace(character))
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
