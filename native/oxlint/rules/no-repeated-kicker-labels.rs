use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REPEATED_DECORATIVE_LABEL_MIN_COUNT: usize = 3;
const SHORT_DECORATIVE_LABEL_MAX_CHARACTERS: usize = 32;
const MESSAGE: &str = "The same uppercase tracked kicker repeats across several sections and makes the page feel templated. Vary the section structure.";

#[derive(Debug, Default, Clone)]
pub struct NoRepeatedKickerLabels;

declare_oxc_lint!(
    /// Disallow repeated tracked uppercase labels before section headings.
    NoRepeatedKickerLabels,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow repeated decorative kicker labels.",
);

impl Rule for NoRepeatedKickerLabels {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut first_candidate_span = None;
        let mut candidate_count = 0;
        for node in ctx.nodes().iter() {
            let AstKind::JSXElement(element) = node.kind() else {
                continue;
            };
            if !is_short_tracked_uppercase_label(element)
                || !is_followed_by_heading(element, node, ctx)
            {
                continue;
            }
            first_candidate_span.get_or_insert(element.opening_element.span);
            candidate_count += 1;
        }
        if candidate_count < REPEATED_DECORATIVE_LABEL_MIN_COUNT {
            return;
        }
        if let Some(span) = first_candidate_span {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(span));
        }
    }
}

fn is_short_tracked_uppercase_label(element: &oxc_ast::ast::JSXElement<'_>) -> bool {
    let text = get_static_jsx_text(element);
    let text_length = normalized_js_whitespace_utf16_length(&text);
    if text_length == 0 || text_length > SHORT_DECORATIVE_LABEL_MAX_CHARACTERS {
        return false;
    }
    let Some(class_name) = get_static_class_name(&element.opening_element) else {
        return false;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    tokens
        .iter()
        .any(|token| token.variants.is_empty() && token.utility == "uppercase")
        && tokens
            .iter()
            .any(|token| token.variants.is_empty() && token.utility.starts_with("tracking-"))
}

fn normalized_js_whitespace_utf16_length(value: &str) -> usize {
    let mut length = 0;
    let mut has_pending_whitespace = false;
    for character in value.chars() {
        if is_js_whitespace(character) {
            has_pending_whitespace = length > 0;
            continue;
        }
        if has_pending_whitespace {
            length += 1;
            has_pending_whitespace = false;
        }
        length += character.len_utf16();
    }
    length
}

fn is_followed_by_heading<'a>(
    element: &'a oxc_ast::ast::JSXElement<'a>,
    node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(sibling) = get_next_static_jsx_element_sibling(element, node, ctx) else {
        return false;
    };
    matches!(
        &sibling.opening_element.name,
        oxc_ast::ast::JSXElementName::Identifier(identifier)
            if matches!(identifier.name.as_str(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
    )
}
