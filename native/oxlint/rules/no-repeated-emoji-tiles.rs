use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REPEATED_EMOJI_TILE_MIN_COUNT: usize = 3;
static EMOJI_PATTERN: Lazy<Regex> = lazy_regex!(r"\p{Extended_Pictographic}");
static EMOJI_MODIFIER_PATTERN: Lazy<Regex> = lazy_regex!(r"\p{Emoji_Modifier}");

#[derive(Debug, Default, Clone)]
pub struct NoRepeatedEmojiTiles;

declare_oxc_lint!(
    /// Disallow repeated boxed emoji used as feature icons.
    NoRepeatedEmojiTiles,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow repeated boxed emoji tiles.",
);

impl Rule for NoRepeatedEmojiTiles {
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
        let mut elements = Vec::new();
        collect_static_jsx_elements(element, &mut elements);
        let emoji_tile_count = elements
            .into_iter()
            .filter(|element| is_emoji_tile(element))
            .count();
        if emoji_tile_count < REPEATED_EMOJI_TILE_MIN_COUNT {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This page uses {emoji_tile_count} rounded emoji tiles as its icon system. Replace them with a consistent visual language tied to the product."
            ))
            .with_label(element.opening_element.span),
        );
    }
}

fn is_emoji_tile(element: &oxc_ast::ast::JSXElement<'_>) -> bool {
    let static_text = get_static_jsx_text(element);
    let text = static_text.trim_matches(is_js_whitespace);
    if !EMOJI_PATTERN.is_match(text)
        || !text.chars().all(|character| {
            character == '\u{200d}'
                || character == '\u{fe0f}'
                || is_js_whitespace(character)
                || matches_unicode_pattern(character, &EMOJI_PATTERN)
                || matches_unicode_pattern(character, &EMOJI_MODIFIER_PATTERN)
        })
    {
        return false;
    }
    let Some(class_name) = get_static_class_name(&element.opening_element) else {
        return false;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    let utilities = tokens
        .iter()
        .filter(|token| token.variants.is_empty())
        .map(|token| token.utility)
        .collect::<Vec<_>>();
    let has_square_size = utilities.iter().any(|utility| is_tile_size(utility))
        || (utilities.iter().any(|utility| is_tile_height(utility))
            && utilities.iter().any(|utility| is_tile_width(utility)));
    has_square_size
        && utilities.iter().any(|utility| is_tile_rounding(utility))
        && has_visible_tailwind_background(&utilities)
}

fn matches_unicode_pattern(character: char, pattern: &Regex) -> bool {
    let mut buffer = [0; 4];
    pattern.is_match(character.encode_utf8(&mut buffer))
}

fn is_tile_size(utility: &str) -> bool {
    matches!(
        utility,
        "size-8" | "size-9" | "size-10" | "size-11" | "size-12" | "size-14" | "size-16"
    )
}

fn is_tile_height(utility: &str) -> bool {
    matches!(
        utility,
        "h-8" | "h-9" | "h-10" | "h-11" | "h-12" | "h-14" | "h-16"
    )
}

fn is_tile_width(utility: &str) -> bool {
    matches!(
        utility,
        "w-8" | "w-9" | "w-10" | "w-11" | "w-12" | "w-14" | "w-16"
    )
}

fn is_tile_rounding(utility: &str) -> bool {
    matches!(
        utility,
        "rounded"
            | "rounded-full"
            | "rounded-lg"
            | "rounded-md"
            | "rounded-sm"
            | "rounded-xl"
            | "rounded-xs"
            | "rounded-2xl"
            | "rounded-3xl"
            | "rounded-4xl"
            | "rounded-5xl"
            | "rounded-6xl"
            | "rounded-7xl"
            | "rounded-8xl"
            | "rounded-9xl"
    )
}
