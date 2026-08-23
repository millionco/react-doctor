use oxc_ast::{
    AstKind,
    ast::{Expression, JSXChild, JSXElement, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::{
        get_element_type, get_string_literal_prop_value, has_jsx_prop_ignore_case,
        is_hidden_from_screen_reader,
    },
};

const DEFAULT_AMBIGUOUS_WORDS: [&str; 5] = ["click here", "here", "link", "a link", "learn more"];

#[derive(Debug, Default, Clone)]
pub struct AnchorAmbiguousText;

declare_oxc_lint!(
    /// Require descriptive anchor text.
    AnchorAmbiguousText,
    react_doctor_native,
    restriction,
    version = "0.1.0",
    short_description = "Require descriptive anchor text.",
);

impl Rule for AnchorAmbiguousText {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if get_element_type(ctx, &element.opening_element) != "a" {
            return;
        }
        let Some(accessible_text) = get_accessible_text(element, ctx) else {
            return;
        };
        if accessible_text.trim().is_empty() {
            return;
        }
        let normalized_text = normalize_anchor_text(&accessible_text);
        if ambiguous_words(ctx)
            .iter()
            .any(|word| word.to_lowercase() == normalized_text)
        {
            let message = format!(
                "Screen reader users can't tell where `{normalized_text}` goes, so name the destination, like \"View pricing details\"."
            );
            ctx.diagnostic(
                OxcDiagnostic::warn(message).with_label(element.opening_element.name.span()),
            );
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }
}

fn get_accessible_text<'a>(element: &JSXElement<'a>, ctx: &LintContext<'a>) -> Option<String> {
    if let Some(aria_label) = has_jsx_prop_ignore_case(&element.opening_element, "aria-label")
        && let Some(label) = get_string_literal_prop_value(aria_label)
    {
        return Some(label.to_string());
    }
    if get_element_type(ctx, &element.opening_element) == "img"
        && let Some(alt_attribute) = has_jsx_prop_ignore_case(&element.opening_element, "alt")
        && let Some(alt_text) = get_string_literal_prop_value(alt_attribute)
    {
        return Some(alt_text.to_string());
    }
    if is_hidden_from_screen_reader(ctx, &element.opening_element) {
        return None;
    }
    let mut text = String::new();
    for child in &element.children {
        match child {
            JSXChild::Text(text_child) => text.push_str(text_child.value.as_str()),
            JSXChild::Element(child_element) => {
                if let Some(child_text) = get_accessible_text(child_element, ctx) {
                    text.push_str(&child_text);
                }
            }
            JSXChild::ExpressionContainer(container) => {
                if let Some(expression_text) = static_expression_text(&container.expression) {
                    text.push_str(expression_text);
                }
            }
            _ => {}
        }
    }
    Some(text)
}

fn static_expression_text<'a>(expression: &'a JSXExpression<'_>) -> Option<&'a str> {
    let expression = expression.as_expression()?.get_inner_expression();
    match expression {
        Expression::StringLiteral(string_literal) => Some(string_literal.value.as_str()),
        Expression::TemplateLiteral(template_literal)
            if template_literal.expressions.is_empty() && template_literal.quasis.len() == 1 =>
        {
            let quasi = &template_literal.quasis[0];
            Some(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str()),
            )
        }
        _ => None,
    }
}

fn normalize_anchor_text(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .filter(|character| {
            !matches!(
                character,
                ',' | '.' | '?' | '¿' | '!' | '‽' | '¡' | ';' | ':'
            )
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn ambiguous_words<'a>(ctx: &'a LintContext<'_>) -> Vec<&'a str> {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("anchorAmbiguousText"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("words"))
        .and_then(serde_json::Value::as_array)
        .map(|words| words.iter().filter_map(serde_json::Value::as_str).collect())
        .unwrap_or_else(|| DEFAULT_AMBIGUOUS_WORDS.to_vec())
}
