use oxc_ast::{
    ast::{Expression, ObjectPropertyKind},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const BOLD_FONT_WEIGHT_MIN: f64 = 700.0;
const LARGE_BOLD_TEXT_MIN_PX: f64 = 18.66;
const LARGE_TEXT_MIN_PX: f64 = 24.0;
const ROOT_FONT_SIZE_PX: f64 = 16.0;
const WCAG_CONTRAST_LARGE_MIN: f64 = 3.0;
const WCAG_CONTRAST_NORMAL_MIN: f64 = 4.5;

#[derive(Debug, Default, Clone)]
pub struct NoLowContrastInlineStyle;

declare_oxc_lint!(
    /// Disallow provably low-contrast inline text colors.
    NoLowContrastInlineStyle,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow provably low-contrast inline text colors.",
);

impl Rule for NoLowContrastInlineStyle {
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
        if style.properties.iter().any(|property| {
            !matches!(property, ObjectPropertyKind::ObjectProperty(object_property) if object_property.key.static_name().is_some())
        }) {
            return;
        }

        let mut foreground = None;
        let mut background_color = None;
        let mut background = None;
        let mut background_image = None;
        let mut background_color_unknown = false;
        let mut background_unknown = false;
        let mut background_image_unknown = false;
        let mut background_clip = None;
        let mut webkit_background_clip = None;
        let mut background_clip_unknown = false;
        let mut webkit_background_clip_unknown = false;
        let mut font_size_px = None;
        let mut is_bold = None;

        for property in &style.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            let Some(property_name) = property.key.static_name() else {
                continue;
            };
            let string_value = string_property_value(property);
            match property_name.as_ref() {
                "backgroundImage" => {
                    background_image = string_value;
                    background_image_unknown = string_value.is_none();
                }
                "backgroundClip" => {
                    background_clip = string_value;
                    background_clip_unknown = string_value.is_none();
                }
                "WebkitBackgroundClip" => {
                    webkit_background_clip = string_value;
                    webkit_background_clip_unknown = string_value.is_none();
                }
                "fontSize" => font_size_px = property_size_px(property),
                "fontWeight" => is_bold = property_bold_weight(property),
                "color" => foreground = string_value.and_then(resolve_opaque_color),
                "backgroundColor" => {
                    background_color = string_value;
                    background_color_unknown = string_value.is_none();
                }
                "background" => {
                    background = string_value;
                    background_unknown = string_value.is_none();
                }
                _ => {}
            }
        }

        if background_color_unknown || background_unknown || background_image_unknown {
            return;
        }
        if background_color.is_some() && background.is_some() {
            return;
        }
        let Some(foreground) = foreground else {
            return;
        };
        let has_painted_background_image =
            background_image.is_some_and(|value| !value.trim().eq_ignore_ascii_case("none"));
        if has_painted_background_image && background.is_some() {
            return;
        }
        let mut backgrounds = if has_painted_background_image
            || (background.is_some() && background_image.is_none())
        {
            let gradient = if has_painted_background_image {
                background_image
            } else {
                background
            };
            let parsed = gradient.and_then(parse_opaque_gradient_stops);
            if has_painted_background_image && parsed.is_none() {
                return;
            }
            parsed
        } else {
            None
        };
        if backgrounds.is_some() {
            let clips_to_text = [background_clip, webkit_background_clip]
                .into_iter()
                .flatten()
                .any(|value| {
                    value
                        .split(',')
                        .any(|clip| clip.trim().eq_ignore_ascii_case("text"))
                });
            if background_clip_unknown || webkit_background_clip_unknown || clips_to_text {
                return;
            }
        }
        if backgrounds.is_none() {
            let Some(background) = background_color
                .or(background)
                .and_then(resolve_opaque_color)
            else {
                return;
            };
            backgrounds = Some(vec![background]);
        }

        let could_be_large = font_size_px.is_none_or(|size| size >= LARGE_TEXT_MIN_PX)
            || is_bold != Some(false)
                && font_size_px.is_some_and(|size| size >= LARGE_BOLD_TEXT_MIN_PX);
        let (threshold, threshold_label) = if could_be_large {
            (WCAG_CONTRAST_LARGE_MIN, "3")
        } else {
            (WCAG_CONTRAST_NORMAL_MIN, "4.5")
        };
        let ratio = backgrounds
            .unwrap_or_default()
            .into_iter()
            .map(|background| contrast_ratio(foreground, background))
            .fold(f64::INFINITY, f64::min);
        if ratio >= threshold {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users struggle to read this text: its contrast against the background is {}:1, below the {}:1 WCAG minimum, so darken or lighten one of the colors.",
                format_two_decimals(ratio),
                threshold_label,
            ))
            .with_label(attribute.span),
        );
    }
}

fn string_property_value<'a, 'b>(
    property: &'b oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'b str> {
    let Expression::StringLiteral(value) = &property.value else {
        return None;
    };
    Some(value.value.as_str())
}

fn number_property_value(property: &oxc_ast::ast::ObjectProperty<'_>) -> Option<f64> {
    match property.value.get_inner_expression() {
        Expression::NumericLiteral(value) => Some(value.value),
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation =>
        {
            match unary.argument.get_inner_expression() {
                Expression::NumericLiteral(value) => Some(-value.value),
                _ => None,
            }
        }
        _ => None,
    }
}

fn property_size_px(property: &oxc_ast::ast::ObjectProperty<'_>) -> Option<f64> {
    if let Some(value) = number_property_value(property) {
        return Some(value);
    }
    let value = string_property_value(property)?;
    if let Some(number) = value.strip_suffix("px") {
        return parse_javascript_float_digits(number);
    }
    Some(parse_javascript_float_digits(value.strip_suffix("rem")?)? * ROOT_FONT_SIZE_PX)
}

fn property_bold_weight(property: &oxc_ast::ast::ObjectProperty<'_>) -> Option<bool> {
    if let Some(value) = number_property_value(property) {
        return Some(value >= BOLD_FONT_WEIGHT_MIN);
    }
    let value = string_property_value(property)?;
    match value {
        "bold" | "bolder" => Some(true),
        "normal" | "lighter" => Some(false),
        _ => {
            let trimmed = value.trim();
            let number: f64 = if trimmed.is_empty() {
                0.0
            } else {
                trimmed.parse().ok()?
            };
            number.is_finite().then_some(number >= BOLD_FONT_WEIGHT_MIN)
        }
    }
}

fn resolve_opaque_color(raw: &str) -> Option<Rgb> {
    let value = raw.trim().to_lowercase();
    if [
        "transparent",
        "currentcolor",
        "inherit",
        "initial",
        "unset",
        "revert",
        "none",
    ]
    .contains(&value.as_str())
        || value.starts_with("var(")
        || value.starts_with("oklch")
        || value.starts_with("rgba(")
        || value.starts_with("hsla(")
        || matches!(value.strip_prefix('#').map(str::len), Some(4 | 8))
    {
        return None;
    }
    if value == "white" {
        return Some(Rgb {
            red: 255.0,
            green: 255.0,
            blue: 255.0,
        });
    }
    if value == "black" {
        return Some(Rgb {
            red: 0.0,
            green: 0.0,
            blue: 0.0,
        });
    }
    if value.starts_with("rgb(") || value.starts_with("hsl(") {
        let opening = value.find('(').unwrap_or_default() + 1;
        let closing = value
            .rfind(')')
            .unwrap_or_else(|| value.len().saturating_sub(1));
        let inner = value.get(opening..closing).unwrap_or_default();
        if inner.contains('/') || inner.split(',').count() >= 4 {
            return None;
        }
    }
    parse_color_to_rgb(&value)
}

fn parse_opaque_gradient_stops(raw: &str) -> Option<Vec<Rgb>> {
    let value = raw.trim();
    if value.to_lowercase().contains("var(") || !is_gradient_function(value) {
        return None;
    }
    let contents = get_css_function_contents(value)?;
    let mut parts = split_css_top_level(contents, ',')?;
    if parts.len() < 2 {
        return None;
    }
    if parse_opaque_gradient_stop(parts[0]).is_none() && is_gradient_prelude(parts[0]) {
        parts.remove(0);
    }
    if parts.len() < 2 {
        return None;
    }
    parts.into_iter().map(parse_opaque_gradient_stop).collect()
}

fn is_gradient_function(value: &str) -> bool {
    let lower = value.to_lowercase();
    ["linear-gradient(", "radial-gradient(", "conic-gradient("]
        .iter()
        .any(|prefix| lower.starts_with(prefix))
}

fn parse_opaque_gradient_stop(stop: &str) -> Option<Rgb> {
    let trimmed = stop.trim();
    let color_end = if ["rgb(", "rgba(", "hsl(", "hsla("]
        .iter()
        .any(|prefix| trimmed.to_lowercase().starts_with(prefix))
    {
        functional_color_end(trimmed)?
    } else {
        trimmed.find(is_js_whitespace).unwrap_or(trimmed.len())
    };
    let color = resolve_opaque_color(&trimmed[..color_end])?;
    let position = trimmed[color_end..].trim();
    (position.is_empty() || valid_gradient_stop_position(position)).then_some(color)
}

fn functional_color_end(value: &str) -> Option<usize> {
    let opening = value.find('(')?;
    let mut depth = 0_i32;
    for (index, character) in value
        .char_indices()
        .skip_while(|(index, _)| *index < opening)
    {
        if character == '(' {
            depth += 1;
        }
        if character == ')' {
            depth -= 1;
        }
        if depth < 0 {
            return None;
        }
        if depth == 0 {
            return Some(index + 1);
        }
    }
    None
}

fn valid_gradient_stop_position(position: &str) -> bool {
    let tokens: Vec<_> = position
        .split(is_js_whitespace)
        .filter(|token| !token.is_empty())
        .collect();
    (tokens.len() == 1 || tokens.len() == 2)
        && tokens
            .iter()
            .all(|token| valid_gradient_position_token(token))
}

fn valid_gradient_position_token(token: &str) -> bool {
    let normalized = token.to_ascii_lowercase();
    let number = strip_optional_sign(&normalized);
    if number == "0" {
        return true;
    }
    ["%", "px", "rem", "em", "deg", "grad", "rad", "turn"]
        .iter()
        .any(|unit| {
            number
                .strip_suffix(unit)
                .is_some_and(|value| valid_decimal(value))
        })
}

fn is_gradient_prelude(value: &str) -> bool {
    let lower = value.trim().to_lowercase();
    ["to", "circle", "ellipse", "at", "from", "in"]
        .iter()
        .any(|keyword| starts_with_css_word(&lower, keyword))
        || ["closest-", "farthest-"]
            .iter()
            .any(|prefix| lower.starts_with(prefix))
        || ["deg", "grad", "rad", "turn"].iter().any(|unit| {
            lower
                .strip_suffix(unit)
                .is_some_and(|number| valid_signed_decimal(number))
        })
}

fn starts_with_css_word(value: &str, keyword: &str) -> bool {
    value.strip_prefix(keyword).is_some_and(|remainder| {
        remainder
            .chars()
            .next()
            .is_none_or(|character| !character.is_ascii_alphanumeric() && character != '_')
    })
}

fn valid_decimal(value: &str) -> bool {
    let mut parts = value.split('.');
    let integer = parts.next().unwrap_or_default();
    let fraction = parts.next();
    if parts.next().is_some() {
        return false;
    }
    let integer_is_digits = integer.bytes().all(|character| character.is_ascii_digit());
    match fraction {
        None => !integer.is_empty() && integer_is_digits,
        Some(fraction) => {
            integer_is_digits
                && fraction.bytes().all(|character| character.is_ascii_digit())
                && (!integer.is_empty() || !fraction.is_empty())
        }
    }
}

fn valid_signed_decimal(value: &str) -> bool {
    valid_decimal(strip_optional_sign(value))
}

fn strip_optional_sign(value: &str) -> &str {
    value
        .strip_prefix('+')
        .or_else(|| value.strip_prefix('-'))
        .unwrap_or(value)
}

fn parse_javascript_float_digits(value: &str) -> Option<f64> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|character| character.is_ascii_digit() || character == b'.')
        || !value.bytes().any(|character| character.is_ascii_digit())
    {
        return None;
    }
    (1..=value.len())
        .rev()
        .find_map(|end| value[..end].parse().ok())
}

fn contrast_ratio(foreground: Rgb, background: Rgb) -> f64 {
    let foreground = relative_luminance(foreground);
    let background = relative_luminance(background);
    (foreground.max(background) + 0.05) / (foreground.min(background) + 0.05)
}

fn relative_luminance(color: Rgb) -> f64 {
    0.2126 * linearize_channel(color.red)
        + 0.7152 * linearize_channel(color.green)
        + 0.0722 * linearize_channel(color.blue)
}

fn linearize_channel(channel: f64) -> f64 {
    let normalized = channel / 255.0;
    if normalized <= 0.03928 {
        normalized / 12.92
    } else {
        ((normalized + 0.055) / 1.055).powf(2.4)
    }
}

fn format_two_decimals(value: f64) -> String {
    format!("{:.2}", (value * 100.0).round() / 100.0)
}
