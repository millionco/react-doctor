use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{Expression, ObjectExpression, ObjectProperty, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str =
    "Your users struggle to read gradient-filled text, so use a solid text color instead.";
static TAILWIND_GRADIENT_BACKGROUND_PATTERN: Lazy<Regex> = lazy_regex!(
    r"^(?:bg-gradient-to-(?:[tb][rl]|[trbl])|bg-linear-(?:[0-9]+|to-(?:[tb][rl]|[trbl])|\[(?s:.+)\]|\((?s:.+)\))|-bg-linear-(?:[0-9]+|\[(?s:.+)\])|bg-radial(?:-\[(?s:.+)\]|-\((?s:.+)\))?|-?bg-conic(?:-[0-9]+|-\[(?s:.+)\]|-\((?s:.+)\))?)$"
);
static TAILWIND_ARBITRARY_GRADIENT_BACKGROUND_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)^bg-\[(?:repeating-)?(?:linear|radial|conic)-gradient\((?s:.+)\)\]$");
static TAILWIND_ARBITRARY_BACKGROUND_IMAGE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)^bg-(?:\(image:--[A-Za-z0-9_-]+\)|\[(?:image:|(?:url|image-set|cross-fade|element)\()(?s:.+)\])$"
);
static CSS_GRADIENT_FUNCTION_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)^(?:repeating-)?(?:linear|radial|conic)-gradient\(");
static TRANSPARENT_COLOR_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)^(?:transparent|#[0-9a-f]{3}0|#[0-9a-f]{6}00|(?:rgb|hsl)a?\([^)]*[,/]\s*[+-]?0(?:\.0+)?%?\s*\)|(?:hwb|lab|lch|oklab|oklch|color)\([^)]*/\s*[+-]?0(?:\.0+)?%?\s*\))$"
);
static TAILWIND_NON_COLOR_TEXT_UTILITY_PATTERN: Lazy<Regex> = lazy_regex!(
    r"^text-(?:left|right|center|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|xs|sm|base|lg|xl|[2-9]xl)$"
);
static TAILWIND_ARBITRARY_FONT_SIZE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)^text-(?:\[(?:(?:length|percentage|absolute-size|relative-size):|(?:calc|min|max|clamp)\(|-?(?:[0-9]*\.)?[0-9]+(?:%|[a-z]+)\])|\((?:length|percentage|absolute-size|relative-size):)"
);

#[derive(Debug, Default, Clone)]
pub struct NoGradientText;

declare_oxc_lint!(
    /// Disallow gradient-filled text.
    NoGradientText,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow gradient-filled text.",
);

impl Rule for NoGradientText {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !is_proven_intrinsic_jsx_element(opening_element, ctx) {
            return;
        }
        let style_attribute = get_authoritative_jsx_attribute(opening_element, "style", true);
        if style_attribute.is_none()
            && opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(spread)
                        if can_expression_override_jsx_attribute(&spread.argument, "style", true)
                )
            })
        {
            return;
        }
        let style =
            style_attribute.and_then(|attribute| get_inline_style_object_expression(attribute));
        if style_attribute.is_some() && style.is_none()
            || style.is_some_and(|style| {
                style.properties.iter().any(|property| {
                    !matches!(
                        property,
                        ObjectPropertyKind::ObjectProperty(property)
                            if property.key.static_name().is_some()
                    )
                })
            })
        {
            return;
        }

        let background_property =
            gradient_effective_style_property_among(style, &["background", "backgroundImage"]);
        let background_value = background_property.and_then(gradient_style_string_value);
        let background_clip_property =
            gradient_effective_style_property(style, "WebkitBackgroundClip")
                .or_else(|| gradient_effective_style_property(style, "backgroundClip"));
        let background_clip_value = background_clip_property.and_then(gradient_style_string_value);
        let text_fill_property = gradient_effective_style_property(style, "WebkitTextFillColor")
            .or_else(|| gradient_effective_style_property(style, "color"));
        let text_fill_value = text_fill_property.and_then(gradient_style_string_value);
        if background_property.is_some() && background_value.is_none()
            || background_clip_property.is_some() && background_clip_value.is_none()
            || text_fill_property.is_some() && text_fill_value.is_none()
        {
            return;
        }

        let tokens = if has_capability_or_unspecified(ctx, "tailwind") {
            get_static_class_name(opening_element)
                .map(|class_name| tailwind_class_name_tokens(class_name))
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let mut target_variant_scopes: Vec<&[&str]> = vec![&[]];
        for token in &tokens {
            if !target_variant_scopes.contains(&token.variants.as_slice()) {
                target_variant_scopes.push(&token.variants);
            }
        }
        if !target_variant_scopes.iter().any(|target_scope| {
            gradient_text_matches_scope(
                &tokens,
                target_scope,
                background_property,
                background_value,
                background_clip_property,
                background_clip_value,
                text_fill_property,
                text_fill_value,
            )
        }) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn gradient_text_matches_scope<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    target_scope: &[&str],
    background_property: Option<&ObjectProperty<'a>>,
    background_value: Option<&str>,
    background_clip_property: Option<&ObjectProperty<'a>>,
    background_clip_value: Option<&str>,
    text_fill_property: Option<&ObjectProperty<'a>>,
    text_fill_value: Option<&str>,
) -> bool {
    let background_resolution = resolve_effective_tailwind_class_name_token(
        tokens,
        is_tailwind_background_image_utility,
        target_scope,
    );
    let background_clip_resolution = resolve_effective_tailwind_class_name_token(
        tokens,
        |utility| utility.starts_with("bg-clip-"),
        target_scope,
    );
    let text_color_resolution = resolve_effective_tailwind_class_name_token(
        tokens,
        is_tailwind_text_color_utility,
        target_scope,
    );
    let has_gradient_background =
        if background_property.is_some() && !background_resolution.is_important {
            background_value.is_some_and(has_css_gradient_function)
        } else {
            background_resolution
                .utility
                .is_some_and(is_tailwind_gradient_background_utility)
        };
    let has_text_background_clip =
        if background_clip_property.is_some() && !background_clip_resolution.is_important {
            background_clip_value.is_some_and(|value| value.eq_ignore_ascii_case("text"))
        } else {
            background_clip_resolution.utility == Some("bg-clip-text")
        };
    let has_transparent_text_fill =
        if text_fill_property.is_some() && !text_color_resolution.is_important {
            text_fill_value.is_some_and(|value| {
                TRANSPARENT_COLOR_PATTERN
                    .is_match(value.trim_matches(|character| is_js_whitespace(character)))
            })
        } else {
            text_color_resolution.utility.is_some_and(|utility| {
                tailwind_utility_without_modifier(utility) == "text-transparent"
            })
        };
    has_gradient_background && has_text_background_clip && has_transparent_text_fill
}

fn gradient_effective_style_property<'a>(
    style: Option<&'a ObjectExpression<'a>>,
    property_name: &str,
) -> Option<&'a ObjectProperty<'a>> {
    gradient_effective_style_property_among(style, &[property_name])
}

fn gradient_effective_style_property_among<'a>(
    style: Option<&'a ObjectExpression<'a>>,
    property_names: &[&str],
) -> Option<&'a ObjectProperty<'a>> {
    let properties = &style?.properties;
    let mut selected_first_index = None;
    let mut selected_property = None;
    for property_name in property_names {
        let mut first_index = None;
        let mut latest_property = None;
        for (property_index, property) in properties.iter().enumerate() {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            if property.key.static_name().as_deref() != Some(*property_name) {
                continue;
            }
            first_index.get_or_insert(property_index);
            latest_property = Some(property.as_ref());
        }
        if first_index > selected_first_index {
            selected_first_index = first_index;
            selected_property = latest_property;
        }
    }
    selected_property
}

fn gradient_style_string_value<'a>(property: &'a ObjectProperty<'a>) -> Option<&'a str> {
    let Expression::StringLiteral(string_literal) = &property.value else {
        return None;
    };
    Some(string_literal.value.as_str())
}

fn tailwind_utility_without_modifier(utility: &str) -> &str {
    tailwind_top_level_character_indices(utility, |character| character == '/')
        .first()
        .map_or(utility, |modifier_index| &utility[..*modifier_index])
}

fn is_tailwind_gradient_background_utility(utility: &str) -> bool {
    let utility_without_modifier = tailwind_utility_without_modifier(utility);
    TAILWIND_GRADIENT_BACKGROUND_PATTERN.is_match(utility_without_modifier)
        || utility == utility_without_modifier
            && TAILWIND_ARBITRARY_GRADIENT_BACKGROUND_PATTERN.is_match(utility_without_modifier)
}

fn is_tailwind_background_image_utility(utility: &str) -> bool {
    let utility_without_modifier = tailwind_utility_without_modifier(utility);
    utility == "bg-none"
        || is_tailwind_gradient_background_utility(utility)
        || utility == utility_without_modifier
            && TAILWIND_ARBITRARY_BACKGROUND_IMAGE_PATTERN.is_match(utility_without_modifier)
}

fn has_css_gradient_function(value: &str) -> bool {
    tailwind_top_level_character_indices(value, |character| {
        matches!(character, 'l' | 'L' | 'r' | 'R' | 'c' | 'C')
    })
    .into_iter()
    .any(|character_index| CSS_GRADIENT_FUNCTION_PATTERN.is_match(&value[character_index..]))
}

fn is_tailwind_text_color_utility(utility: &str) -> bool {
    let utility_without_modifier = tailwind_utility_without_modifier(utility);
    utility_without_modifier.starts_with("text-")
        && utility_without_modifier != "text-shadow"
        && !utility_without_modifier.starts_with("text-shadow-")
        && !utility_without_modifier.starts_with("text-opacity-")
        && utility_without_modifier != "text-box"
        && !utility_without_modifier.starts_with("text-box-")
        && !TAILWIND_NON_COLOR_TEXT_UTILITY_PATTERN.is_match(utility_without_modifier)
        && !TAILWIND_ARBITRARY_FONT_SIZE_PATTERN.is_match(utility_without_modifier)
}

fn tailwind_top_level_character_indices(
    value: &str,
    predicate: impl Fn(char) -> bool,
) -> Vec<usize> {
    let mut character_indices = Vec::new();
    let mut bracket_depth = 0_u32;
    let mut parenthesis_depth = 0_u32;
    let mut quote = None;
    let mut is_escaped = false;
    for (character_index, character) in value.char_indices() {
        if is_escaped {
            is_escaped = false;
            continue;
        }
        if character == '\\' {
            is_escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            }
            continue;
        }
        if character == '"' || character == '\'' {
            quote = Some(character);
            continue;
        }
        match character {
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            '(' => parenthesis_depth += 1,
            ')' => parenthesis_depth = parenthesis_depth.saturating_sub(1),
            _ => {}
        }
        if bracket_depth == 0 && parenthesis_depth == 0 && predicate(character) {
            character_indices.push(character_index);
        }
    }
    character_indices
}
