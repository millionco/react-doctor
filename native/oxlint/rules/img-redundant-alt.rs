use oxc_ast::{
    AstKind,
    ast::{JSXAttribute, JSXAttributeItem, JSXAttributeValue, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::has_jsx_prop_ignore_case,
};

const MESSAGE: &str = "Screen reader users hear \"image\" or \"photo\" twice because they already announce it, so describe what the image shows instead.";
const DEFAULT_COMPONENTS: [&str; 1] = ["img"];
const DEFAULT_REDUNDANT_WORDS: [&str; 3] = ["image", "photo", "picture"];

#[derive(Debug, Default, Clone)]
pub struct ImgRedundantAlt;

declare_oxc_lint!(
    /// Disallow redundant image words in alt text.
    ImgRedundantAlt,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow redundant image words in alt text.",
);

impl Rule for ImgRedundantAlt {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_generated_image_render_filename(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let components = img_redundant_alt_setting(ctx, "components", &DEFAULT_COMPONENTS);
        let words = img_redundant_alt_setting(ctx, "words", &DEFAULT_REDUNDANT_WORDS);
        let generated_opening_element_ids = generated_image_jsx_opening_element_ids(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if generated_opening_element_ids.contains(&node.id()) {
                continue;
            }
            let element_type = resolve_configured_jsx_element_type(opening_element, ctx);
            if !components.iter().any(|component| component == &element_type)
                || is_statically_hidden_from_screen_reader(opening_element, ctx)
            {
                continue;
            }
            let Some(alt_attribute) = has_jsx_prop_ignore_case(opening_element, "alt")
                .and_then(JSXAttributeItem::as_attribute)
            else {
                continue;
            };
            if alt_value_is_redundant(alt_attribute, &words) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(alt_attribute.span));
            }
        }
    }
}

fn img_redundant_alt_setting(
    ctx: &LintContext<'_>,
    setting_name: &str,
    default_values: &[&str],
) -> Vec<String> {
    let mut values = default_values
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    values.extend(
        ctx.settings()
            .json
            .as_ref()
            .and_then(|settings| settings.get("react-doctor"))
            .and_then(|settings| settings.get("imgRedundantAlt"))
            .and_then(|settings| settings.get(setting_name))
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(serde_json::Value::as_str)
            .map(str::to_string),
    );
    values
}

fn alt_value_is_redundant(attribute: &JSXAttribute<'_>, words: &[String]) -> bool {
    match attribute.value.as_ref() {
        Some(JSXAttributeValue::StringLiteral(string_literal)) => {
            contains_redundant_alt_word(string_literal.value.as_str(), words)
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => match &container.expression {
            JSXExpression::StringLiteral(string_literal) => {
                contains_redundant_alt_word(string_literal.value.as_str(), words)
            }
            JSXExpression::TemplateLiteral(template_literal) => template_literal
                .quasis
                .iter()
                .any(|quasi| contains_redundant_alt_word(quasi.value.raw.as_str(), words)),
            _ => false,
        },
        _ => false,
    }
}

fn contains_redundant_alt_word(alt_text: &str, words: &[String]) -> bool {
    let lowercase_alt_text = alt_text.to_lowercase();
    for word in words {
        let lowercase_word = word.to_lowercase();
        let mut cursor = 0;
        while cursor < lowercase_alt_text.len() {
            let Some(relative_index) = lowercase_alt_text[cursor..].find(&lowercase_word) else {
                break;
            };
            let start = cursor + relative_index;
            let end = start + lowercase_word.len();
            let starts_at_boundary = start == 0
                || !is_alt_word_character(lowercase_alt_text.as_bytes()[start - 1]);
            let ends_at_boundary = end == lowercase_alt_text.len()
                || !is_alt_word_character(lowercase_alt_text.as_bytes()[end]);
            if starts_at_boundary && ends_at_boundary {
                return true;
            }
            cursor = lowercase_alt_text[start..]
                .char_indices()
                .nth(1)
                .map_or(lowercase_alt_text.len(), |(offset, _)| start + offset);
        }
    }
    false
}

fn is_alt_word_character(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')
}
