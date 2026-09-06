use oxc_ast::{ast::ObjectPropertyKind, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const DARK_BACKGROUND_CHANNEL_MAX: f64 = 35.0;
const DARK_GLOW_BLUR_THRESHOLD_PX: f64 = 4.0;
const MESSAGE: &str = "A strong colored glow on a dark background can feel heavy. Use a subtle, neutral shadow instead.";
const SHADOW_BLUR_TOKEN_INDEX: usize = 2;

#[derive(Debug, Default, Clone)]
pub struct NoDarkModeGlow;

declare_oxc_lint!(
    /// Disallow strong colored glows on dark inline-style backgrounds.
    NoDarkModeGlow,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow strong colored glows on dark inline-style backgrounds.",
);

impl Rule for NoDarkModeGlow {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        let Some(style) = get_inline_style_object_expression(attribute) else {
            return;
        };

        let mut has_dark_background = false;
        let mut shadow_property = None;
        let mut shadow_value = None;

        for property in &style.properties {
            let ObjectPropertyKind::ObjectProperty(object_property) = property else {
                continue;
            };
            let Some(property_name) = object_property.key.static_name() else {
                continue;
            };
            if matches!(property_name.as_ref(), "backgroundColor" | "background") {
                if let Some((_, value)) =
                    get_static_style_property_string_value(property, property_name.as_ref())
                {
                    if !value.is_empty() && is_dark_glow_background(value) {
                        has_dark_background = true;
                    }
                }
            }
            if property_name == "boxShadow" {
                shadow_property = Some(object_property);
                shadow_value = get_static_style_property_string_value(property, "boxShadow")
                    .map(|(_, value)| value);
            }
        }

        let (Some(shadow_property), Some(shadow_value)) = (shadow_property, shadow_value) else {
            return;
        };
        if has_dark_background && !shadow_value.is_empty() && has_colored_glow_shadow(shadow_value)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(shadow_property.span));
        }
    }
}

fn is_dark_glow_background(value: &str) -> bool {
    let normalized = value
        .trim_matches(|character| is_js_whitespace(character))
        .to_ascii_lowercase();
    if is_pure_black_color(&normalized) {
        return true;
    }
    parse_color_to_rgb(&normalized).is_some_and(|color| {
        color.red <= DARK_BACKGROUND_CHANNEL_MAX
            && color.green <= DARK_BACKGROUND_CHANNEL_MAX
            && color.blue <= DARK_BACKGROUND_CHANNEL_MAX
    })
}

fn has_colored_glow_shadow(value: &str) -> bool {
    split_shadow_layers(value).into_iter().any(|layer| {
        if shadow_layer_is_fully_transparent(layer) {
            return false;
        }
        extract_shadow_layer_color(layer).is_some_and(|color| {
            has_color_chroma(color) && parse_shadow_layer_blur(layer) > DARK_GLOW_BLUR_THRESHOLD_PX
        })
    })
}

fn split_shadow_layers(value: &str) -> Vec<&str> {
    let mut layers = Vec::new();
    let mut layer_start = 0;
    let mut parenthesis_depth = 0;
    for (index, character) in value.char_indices() {
        if character == '(' {
            parenthesis_depth += 1;
        }
        if character == ')' && parenthesis_depth > 0 {
            parenthesis_depth -= 1;
        }
        if character == ',' && parenthesis_depth == 0 {
            layers.push(&value[layer_start..index]);
            layer_start = index + 1;
        }
    }
    layers.push(&value[layer_start..]);
    layers
}

fn shadow_layer_is_fully_transparent(layer: &str) -> bool {
    if let Some((index, color)) = find_hex_shadow_color(layer, true) {
        if is_shadow_color_at_top_level(layer, index) {
            let digits = &color[1..];
            if digits.len() == 4 {
                return digits.ends_with('0');
            }
            if digits.len() == 8 {
                return digits.ends_with("00");
            }
        }
    }

    let Some((index, color)) = find_rgb_shadow_color(layer) else {
        return false;
    };
    if !is_shadow_color_at_top_level(layer, index) {
        return false;
    }
    let Some(arguments) = color
        .split_once('(')
        .map(|(_, arguments)| &arguments[..arguments.len().saturating_sub(1)])
    else {
        return false;
    };
    if let Some((_, alpha)) = arguments.rsplit_once('/') {
        return is_zero_shadow_alpha(alpha);
    }
    let mut legacy_arguments = arguments.split(',');
    let Some(_) = legacy_arguments.next() else {
        return false;
    };
    let Some(_) = legacy_arguments.next() else {
        return false;
    };
    let Some(_) = legacy_arguments.next() else {
        return false;
    };
    let Some(alpha) = legacy_arguments.next() else {
        return false;
    };
    legacy_arguments.next().is_none() && is_zero_shadow_alpha(alpha)
}

fn is_zero_shadow_alpha(value: &str) -> bool {
    let value = value.trim_matches(|character| is_js_whitespace(character));
    let value = value.strip_suffix('%').unwrap_or(value);
    let value = value
        .strip_prefix('+')
        .or_else(|| value.strip_prefix('-'))
        .unwrap_or(value);
    if let Some(fraction) = value.strip_prefix('.') {
        return !fraction.is_empty() && fraction.bytes().all(|byte| byte == b'0');
    }
    let mut parts = value.split('.');
    let Some(integer) = parts.next() else {
        return false;
    };
    let fraction = parts.next();
    parts.next().is_none()
        && !integer.is_empty()
        && integer.bytes().all(|byte| byte == b'0')
        && fraction.is_none_or(|digits| digits.bytes().all(|byte| byte == b'0'))
}

fn extract_shadow_layer_color(layer: &str) -> Option<Rgb> {
    find_rgb_shadow_color(layer)
        .map(|(_, color)| color)
        .or_else(|| find_hex_shadow_color(layer, true).map(|(_, color)| color))
        .and_then(parse_color_to_rgb)
}

fn find_rgb_shadow_color(value: &str) -> Option<(usize, &str)> {
    value.char_indices().find_map(|(index, _)| {
        let remainder = &value[index..];
        let function_name_length = if remainder
            .get(..5)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("rgba("))
        {
            5
        } else if remainder
            .get(..4)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("rgb("))
        {
            4
        } else {
            return None;
        };
        let relative_end = remainder[function_name_length..].find(')')?;
        let end = function_name_length + relative_end + 1;
        Some((index, &remainder[..end]))
    })
}

fn find_hex_shadow_color(value: &str, exact_lengths: bool) -> Option<(usize, &str)> {
    value.char_indices().find_map(|(index, character)| {
        if character != '#' {
            return None;
        }
        let remainder = &value[index + 1..];
        let digit_count = remainder
            .bytes()
            .take_while(|byte| byte.is_ascii_hexdigit())
            .count();
        let matched_length = if exact_lengths {
            [8, 6, 4, 3].into_iter().find(|length| {
                digit_count >= *length
                    && remainder
                        .as_bytes()
                        .get(*length)
                        .is_none_or(|byte| !is_dark_glow_word_byte(*byte))
            })?
        } else {
            if !(3..=8).contains(&digit_count)
                || remainder
                    .as_bytes()
                    .get(digit_count)
                    .is_some_and(|byte| is_dark_glow_word_byte(*byte))
            {
                return None;
            }
            digit_count
        };
        Some((index, &value[index..index + matched_length + 1]))
    })
}

fn is_dark_glow_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn is_shadow_color_at_top_level(value: &str, color_index: usize) -> bool {
    let mut parenthesis_depth = 0;
    for character in value[..color_index].chars() {
        if character == '(' {
            parenthesis_depth += 1;
        }
        if character == ')' && parenthesis_depth > 0 {
            parenthesis_depth -= 1;
        }
    }
    parenthesis_depth == 0
}

fn parse_shadow_layer_blur(layer: &str) -> f64 {
    let mut without_colors = String::with_capacity(layer.len());
    let mut index = 0;
    while index < layer.len() {
        if let Some((_, color)) = find_rgb_shadow_color(&layer[index..]).filter(|(start, _)| *start == 0)
        {
            index += color.len();
            continue;
        }
        if layer.as_bytes()[index] == b'#' {
            if let Some((_, color)) = find_hex_shadow_color(&layer[index..], false) {
                index += color.len();
                continue;
            }
        }
        let character = layer[index..].chars().next().unwrap_or_default();
        without_colors.push(character);
        index += character.len_utf8();
    }

    let bytes = without_colors.as_bytes();
    let mut index = 0;
    let mut token_index = 0;
    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index < bytes.len() && bytes[index] == b'.' {
            let fraction_start = index;
            index += 1;
            let digits_start = index;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                index += 1;
            }
            if index == digits_start {
                index = fraction_start;
            }
        }
        if token_index == SHADOW_BLUR_TOKEN_INDEX {
            return without_colors[start..index].parse().unwrap_or_default();
        }
        token_index += 1;
    }
    0.0
}
