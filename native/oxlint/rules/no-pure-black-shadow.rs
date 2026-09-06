use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const INLINE_MESSAGE: &str = "This shadow uses pure black, which can look detached from the surface beneath it. Use a tinted or neutral design token.";
const CLASS_MESSAGE: &str = "This shadow uses pure black as its color. Tint it toward the surrounding surface or use a neutral shadow token.";

#[derive(Clone, Copy)]
struct EffectiveBooleanState {
    is_declared: bool,
    value: Option<bool>,
}

#[derive(Clone, Copy)]
struct Rgb {
    red: f64,
    green: f64,
    blue: f64,
}

#[derive(Debug, Default, Clone)]
pub struct NoPureBlackShadow;

declare_oxc_lint!(
    /// Disallow pure-black surface shadows.
    NoPureBlackShadow,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow pure-black surface shadows.",
);

impl Rule for NoPureBlackShadow {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => {
                let Some(style) = get_inline_style_object_expression(attribute) else {
                    return;
                };
                let Some(property) = get_effective_static_style_property(style, "boxShadow")
                else {
                    return;
                };
                let oxc_ast::ast::Expression::StringLiteral(value) = &property.value else {
                    return;
                };
                if value.value.is_empty() || !has_pure_black_shadow_color(value.value.as_str()) {
                    return;
                }
                ctx.diagnostic(OxcDiagnostic::warn(INLINE_MESSAGE).with_label(property.span));
            }
            AstKind::JSXOpeningElement(opening_element) => {
                let Some(class_name) = get_static_class_name(opening_element) else {
                    return;
                };
                let tokens = tailwind_class_name_tokens(class_name)
                    .into_iter()
                    .filter(|token| token.variants.is_empty())
                    .map(|token| token.utility)
                    .collect::<Vec<_>>();
                if !has_visible_tailwind_shadow(&tokens) {
                    return;
                }
                let has_black_color = tokens
                    .iter()
                    .any(|token| is_visible_tailwind_black_shadow(token));
                let has_arbitrary_black_shadow = tokens.iter().any(|token| {
                    token.starts_with("shadow-[") && has_pure_black_shadow_color(token)
                });
                if !has_black_color && !has_arbitrary_black_shadow {
                    return;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(CLASS_MESSAGE).with_label(opening_element.span),
                );
            }
            _ => {}
        }
    }
}

fn has_pure_black_shadow_color(value: &str) -> bool {
    let normalized = value.replace('_', " ").to_ascii_lowercase();
    let bytes = normalized.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if normalized[index..].starts_with("black")
            && (index == 0 || !is_javascript_word_byte(bytes[index - 1]))
            && bytes
                .get(index + "black".len())
                .is_none_or(|byte| !is_javascript_word_byte(*byte))
        {
            return true;
        }
        if bytes[index] == b'#' {
            let mut end = index + 1;
            while end < bytes.len() && end - index <= 8 && bytes[end].is_ascii_hexdigit() {
                end += 1;
            }
            let digit_count = end - index - 1;
            if (3..=8).contains(&digit_count)
                && bytes
                    .get(end)
                    .is_none_or(|byte| !is_javascript_word_byte(*byte))
            {
                let color = &normalized[index..end];
                if !is_fully_transparent_hex(color) && parsed_color_is_pure_black(color) {
                    return true;
                }
                index = end;
                continue;
            }
        }
        if let Some(function_name_length) = color_function_name_length(&normalized[index..]) {
            let contents_start = index + function_name_length;
            if let Some(relative_end) = normalized[contents_start..].find(')') {
                let end = contents_start + relative_end + 1;
                let color = &normalized[index..end];
                if !is_fully_transparent_function(color) && parsed_color_is_pure_black(color) {
                    return true;
                }
                index = end;
                continue;
            }
        }
        index += normalized[index..]
            .chars()
            .next()
            .map_or(1, char::len_utf8);
    }
    false
}

fn color_function_name_length(value: &str) -> Option<usize> {
    ["rgba(", "rgb(", "hsla(", "hsl("]
        .iter()
        .find(|prefix| value.starts_with(**prefix))
        .map(|prefix| prefix.len())
}

fn is_fully_transparent_hex(value: &str) -> bool {
    let Some(hex) = value.strip_prefix('#') else {
        return false;
    };
    matches!(hex.len(), 4 if hex.ends_with('0'))
        || matches!(hex.len(), 8 if hex.ends_with("00"))
}

fn is_fully_transparent_function(value: &str) -> bool {
    let Some(contents) = value.strip_suffix(')') else {
        return false;
    };
    let Some(separator) = contents.rfind([',', '/']) else {
        return false;
    };
    let alpha = contents[separator + 1..]
        .trim_matches(is_js_whitespace)
        .strip_suffix('%')
        .unwrap_or_else(|| contents[separator + 1..].trim_matches(is_js_whitespace));
    is_zero_decimal(alpha.trim_matches(is_js_whitespace))
}

fn parsed_color_is_pure_black(value: &str) -> bool {
    let parsed = if let Some(hex) = value.strip_prefix('#') {
        parse_hex_color(hex)
    } else if value.starts_with("rgb") {
        parse_rgb_color(value)
    } else if value.starts_with("hsl") {
        parse_hsl_color(value)
    } else {
        None
    };
    parsed.is_some_and(|color| color.red == 0.0 && color.green == 0.0 && color.blue == 0.0)
}

fn parse_hex_color(value: &str) -> Option<Rgb> {
    let channel = |value: &str| u8::from_str_radix(value, 16).ok().map(f64::from);
    match value.len() {
        3 | 4 => Some(Rgb {
            red: channel(&value[0..1].repeat(2))?,
            green: channel(&value[1..2].repeat(2))?,
            blue: channel(&value[2..3].repeat(2))?,
        }),
        6 | 8 => Some(Rgb {
            red: channel(&value[0..2])?,
            green: channel(&value[2..4])?,
            blue: channel(&value[4..6])?,
        }),
        _ => None,
    }
}

fn parse_rgb_color(value: &str) -> Option<Rgb> {
    let contents = value
        .strip_prefix("rgb(")
        .or_else(|| value.strip_prefix("rgba("))?
        .trim_start_matches(is_js_whitespace);
    let (red, remainder) = parse_unsigned_integer_prefix(contents)?;
    let (green, remainder) = parse_separated_unsigned_integer(remainder)?;
    let (blue, _) = parse_separated_unsigned_integer(remainder)?;
    Some(Rgb { red, green, blue })
}

fn parse_hsl_color(value: &str) -> Option<Rgb> {
    let contents = value
        .strip_prefix("hsl(")
        .or_else(|| value.strip_prefix("hsla("))?
        .trim_start_matches(is_js_whitespace);
    let (hue, remainder) = parse_unsigned_decimal_prefix(contents)?;
    let remainder = remainder.strip_prefix("deg").unwrap_or(remainder);
    let remainder = strip_color_component_separator(remainder)?;
    let (saturation, remainder) = parse_unsigned_decimal_prefix(remainder)?;
    let remainder = remainder.strip_prefix('%')?;
    let remainder = strip_color_component_separator(remainder)?;
    let (lightness, remainder) = parse_unsigned_decimal_prefix(remainder)?;
    remainder.strip_prefix('%')?;
    Some(convert_hsl_to_rgb(hue, saturation, lightness))
}

fn convert_hsl_to_rgb(hue_degrees: f64, saturation_percent: f64, lightness_percent: f64) -> Rgb {
    let hue = ((hue_degrees % 360.0) + 360.0) % 360.0;
    let saturation = saturation_percent / 100.0;
    let lightness = lightness_percent / 100.0;
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let secondary = chroma * (1.0 - ((hue / 60.0) % 2.0 - 1.0).abs());
    let offset = lightness - chroma / 2.0;
    let channels = match (hue / 60.0).floor() as i32 {
        0 => [chroma, secondary, 0.0],
        1 => [secondary, chroma, 0.0],
        2 => [0.0, chroma, secondary],
        3 => [0.0, secondary, chroma],
        4 => [secondary, 0.0, chroma],
        _ => [chroma, 0.0, secondary],
    };
    Rgb {
        red: javascript_round((channels[0] + offset) * 255.0),
        green: javascript_round((channels[1] + offset) * 255.0),
        blue: javascript_round((channels[2] + offset) * 255.0),
    }
}

fn javascript_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

fn parse_separated_unsigned_integer(value: &str) -> Option<(f64, &str)> {
    parse_unsigned_integer_prefix(strip_color_component_separator(value)?)
}

fn strip_color_component_separator(value: &str) -> Option<&str> {
    let remainder = value
        .trim_start_matches(|character: char| character == ',' || is_js_whitespace(character));
    (remainder.len() < value.len()).then_some(remainder)
}

fn parse_unsigned_integer_prefix(value: &str) -> Option<(f64, &str)> {
    let end = value
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(value.len());
    if end == 0 {
        return None;
    }
    Some((value[..end].parse().ok()?, &value[end..]))
}

fn parse_unsigned_decimal_prefix(value: &str) -> Option<(f64, &str)> {
    let end = value
        .find(|character: char| !character.is_ascii_digit() && character != '.')
        .unwrap_or(value.len());
    if end == 0 {
        return None;
    }
    Some((parse_javascript_decimal(&value[..end]), &value[end..]))
}

fn parse_javascript_decimal(value: &str) -> f64 {
    let mut end = 0;
    let mut has_digit = false;
    let mut has_decimal_point = false;
    for (index, character) in value.char_indices() {
        if character.is_ascii_digit() {
            has_digit = true;
        } else if character == '.' && !has_decimal_point {
            has_decimal_point = true;
        } else {
            break;
        }
        end = index + character.len_utf8();
    }
    if !has_digit {
        return f64::NAN;
    }
    value[..end].parse().unwrap_or(f64::NAN)
}

fn has_visible_tailwind_shadow(tokens: &[&str]) -> bool {
    let mut geometry_state = make_boolean_state(false);
    let mut color_state = make_boolean_state(true);
    for token in tokens {
        if *token == "shadow-none" {
            geometry_state = update_boolean_state(geometry_state, false);
        } else if is_shadow_geometry(token) {
            geometry_state = update_boolean_state(geometry_state, true);
        } else if *token == "shadow-transparent"
            || token
                .strip_prefix("shadow-")
                .is_some_and(|value| value.ends_with("/0"))
        {
            color_state = update_boolean_state(color_state, false);
        } else if token.starts_with("shadow-") {
            color_state = update_boolean_state(color_state, true);
        }
    }
    geometry_state.value == Some(true) && color_state.value == Some(true)
}

fn make_boolean_state(value: bool) -> EffectiveBooleanState {
    EffectiveBooleanState {
        is_declared: false,
        value: Some(value),
    }
}

fn update_boolean_state(
    current: EffectiveBooleanState,
    value: bool,
) -> EffectiveBooleanState {
    if !current.is_declared {
        return EffectiveBooleanState {
            is_declared: true,
            value: Some(value),
        };
    }
    if current.value == Some(value) {
        return current;
    }
    EffectiveBooleanState {
        is_declared: true,
        value: None,
    }
}

fn is_shadow_geometry(token: &str) -> bool {
    if token == "shadow"
        || ["shadow-2xl", "shadow-inner", "shadow-lg", "shadow-md", "shadow-sm", "shadow-xl", "shadow-xs"]
            .contains(&token)
    {
        return true;
    }
    token
        .strip_prefix("shadow-[")
        .and_then(|value| value.strip_suffix(']'))
        .is_some_and(|value| {
            !value.contains(']') && ["em", "px", "rem"].iter().any(|unit| value.contains(unit))
        })
}

fn is_visible_tailwind_black_shadow(token: &str) -> bool {
    (token == "shadow-black" || token.starts_with("shadow-black/"))
        && !is_fully_transparent_tailwind_black(token)
}

fn is_fully_transparent_tailwind_black(token: &str) -> bool {
    let Some(opacity) = token.strip_prefix("shadow-black/") else {
        return false;
    };
    if let Some(bracketed) = opacity.strip_prefix('[').and_then(|value| value.strip_suffix(']')) {
        return is_zero_decimal(bracketed.strip_suffix('%').unwrap_or(bracketed));
    }
    is_zero_decimal(opacity)
}

fn is_zero_decimal(value: &str) -> bool {
    if let Some(fraction) = value.strip_prefix('.') {
        return !fraction.is_empty() && fraction.bytes().all(|byte| byte == b'0');
    }
    let mut parts = value.split('.');
    let integer = parts.next().unwrap_or_default();
    let fraction = parts.next();
    if parts.next().is_some() || integer.is_empty() || !integer.bytes().all(|byte| byte == b'0') {
        return false;
    }
    fraction.is_none_or(|value| value.bytes().all(|byte| byte == b'0'))
}

fn is_javascript_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
