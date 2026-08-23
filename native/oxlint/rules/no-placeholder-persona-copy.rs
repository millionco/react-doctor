use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const PLACEHOLDER_PERSONAS: [&str; 3] = ["example user", "jane doe", "john smith"];

#[derive(Debug, Default, Clone)]
pub struct NoPlaceholderPersonaCopy;

declare_oxc_lint!(
    /// Disallow placeholder persona names in top-level page copy.
    NoPlaceholderPersonaCopy,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow placeholder persona page copy.",
);

impl Rule for NoPlaceholderPersonaCopy {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !is_top_level_page_copy_root(element, node, ctx) {
            return;
        }
        let page_text = get_static_jsx_text(element);
        let Some(matched_persona) = find_placeholder_persona(&page_text) else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "“{matched_persona}” reads like unfinished demo content. Replace it with context-specific sample data or an explicit demo label."
            ))
            .with_label(element.opening_element.span),
        );
    }
}

fn find_placeholder_persona(value: &str) -> Option<&str> {
    let lowercase_value = value.to_ascii_lowercase();
    PLACEHOLDER_PERSONAS
        .iter()
        .flat_map(|persona| {
            lowercase_value
                .match_indices(persona)
                .map(move |(match_index, _)| (match_index, persona.len()))
        })
        .filter(|(match_index, match_length)| {
            let bytes = value.as_bytes();
            let before_is_boundary =
                *match_index == 0 || !is_ascii_word_byte(bytes[*match_index - 1]);
            let after_index = *match_index + *match_length;
            let after_is_boundary = bytes
                .get(after_index)
                .is_none_or(|byte| !is_ascii_word_byte(*byte));
            before_is_boundary && after_is_boundary
        })
        .min_by_key(|(match_index, _)| *match_index)
        .and_then(|(match_index, match_length)| value.get(match_index..match_index + match_length))
}

fn is_ascii_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
