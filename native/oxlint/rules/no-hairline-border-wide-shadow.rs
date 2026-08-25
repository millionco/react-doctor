use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const WIDE_SHADOW_BLUR_MIN_PX: f64 = 16.0;
const INLINE_MESSAGE: &str = "This surface combines a crisp hairline edge with a broad diffuse shadow. Pick one elevation signal to keep the shape clear.";
const CLASS_MESSAGE: &str = "This surface uses both a hairline border and a large diffuse shadow. Keep one clear depth treatment.";

#[derive(Debug, Default, Clone)]
pub struct NoHairlineBorderWideShadow;

declare_oxc_lint!(
    /// Disallow combining a hairline border with a diffuse shadow.
    NoHairlineBorderWideShadow,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow hairline borders paired with diffuse shadows.",
);

impl Rule for NoHairlineBorderWideShadow {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => {
                let Some(style) = get_inline_style_object_expression(attribute) else {
                    return;
                };
                if !has_one_pixel_border(style) {
                    return;
                }
                let Some(property) = get_effective_static_style_property(style, "boxShadow")
                else {
                    return;
                };
                let oxc_ast::ast::Expression::StringLiteral(shadow) = &property.value else {
                    return;
                };
                let shadow = shadow.value.as_str();
                if shadow.is_empty() || contains_javascript_word(shadow, "transparent") {
                    return;
                }
                let Some(shadow_blur_px) = get_shadow_blur_px(shadow) else {
                    return;
                };
                if shadow_blur_px < WIDE_SHADOW_BLUR_MIN_PX {
                    return;
                }
                ctx.diagnostic(OxcDiagnostic::warn(INLINE_MESSAGE).with_label(property.span));
            }
            AstKind::JSXOpeningElement(opening_element) => {
                let Some(class_name) = get_static_class_name(opening_element) else {
                    return;
                };
                let tokens = tailwind_class_name_tokens(class_name);
                let has_utility = |target: &str| {
                    tokens
                        .iter()
                        .any(|token| token.variants.is_empty() && token.utility == target)
                };
                if has_utility("border-0")
                    || has_utility("border-none")
                    || has_utility("border-transparent")
                    || !["border", "border-1", "border-px"]
                        .iter()
                        .any(|utility| has_utility(utility))
                    || has_utility("shadow-none")
                    || has_utility("shadow-transparent")
                    || !["shadow-xl", "shadow-2xl"]
                        .iter()
                        .any(|utility| has_utility(utility))
                {
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

fn has_one_pixel_border(style: &oxc_ast::ast::ObjectExpression<'_>) -> bool {
    let border_style = get_effective_static_style_property(style, "borderStyle")
        .and_then(get_style_property_string_value)
        .map(str::trim);
    let border_width = get_effective_static_style_property(style, "borderWidth");
    let has_separate_hairline_border = border_style.is_some_and(|value| {
        ["dashed", "dotted", "double", "solid"].contains(&value)
    }) && border_width.is_some_and(|property| {
        get_static_style_property_number_value(property) == Some(1.0)
            || get_style_property_string_value(property).map(str::trim) == Some("1px")
    });
    let border_value = get_effective_static_style_property(style, "border")
        .and_then(get_style_property_string_value)
        .map_or("", str::trim);
    has_separate_hairline_border || is_hairline_border_shorthand(border_value)
}

fn get_style_property_string_value<'a>(
    property: &'a oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'a str> {
    let oxc_ast::ast::Expression::StringLiteral(value) = &property.value else {
        return None;
    };
    Some(value.value.as_str())
}

fn is_hairline_border_shorthand(value: &str) -> bool {
    if contains_javascript_word(value, "transparent") {
        return false;
    }
    let Some(remainder) = value.strip_prefix("1px") else {
        return false;
    };
    let Some(first_character) = remainder.chars().next() else {
        return false;
    };
    if !is_js_whitespace(first_character) {
        return false;
    }
    let remainder = remainder.trim_start_matches(is_js_whitespace);
    ["solid", "dashed", "dotted"]
        .iter()
        .any(|style| starts_with_javascript_word(remainder, style))
}

fn get_shadow_blur_px(value: &str) -> Option<f64> {
    let lowercase_value = value.to_ascii_lowercase();
    let geometry_end = [
        "rgb(", "rgba(", "hsl(", "hsla(", "oklch(", "oklab(", "lab(", "lch(",
        "hwb(", "color(", "#",
    ]
    .iter()
    .filter_map(|marker| lowercase_value.find(marker))
    .min()
    .unwrap_or(value.len());
    let geometry = &value[..geometry_end];
    let bytes = geometry.as_bytes();
    let mut index = 0;
    let mut length_count = 0;
    while index < bytes.len() {
        let match_start = index;
        let mut number_start = index;
        if bytes[number_start] == b'-' {
            number_start += 1;
        }
        let mut number_end = number_start;
        while bytes
            .get(number_end)
            .is_some_and(|byte| byte.is_ascii_digit() || *byte == b'.')
        {
            number_end += 1;
        }
        if number_end > number_start && bytes.get(number_end..number_end + 2) == Some(b"px") {
            length_count += 1;
            if length_count == 3 {
                return Some(parse_javascript_decimal_prefix(&geometry[match_start..number_end]).abs());
            }
            index = number_end + 2;
            continue;
        }
        if bytes[index] == b'0'
            && (index == 0 || !is_decimal_byte(bytes[index - 1]))
            && bytes.get(index + 1).is_none_or(|byte| !is_decimal_byte(*byte))
        {
            length_count += 1;
            if length_count == 3 {
                return Some(0.0);
            }
        }
        index += 1;
    }
    None
}

fn parse_javascript_decimal_prefix(value: &str) -> f64 {
    let bytes = value.as_bytes();
    let mut end = usize::from(bytes.first() == Some(&b'-'));
    let mut has_digit = false;
    let mut has_decimal_point = false;
    while let Some(byte) = bytes.get(end) {
        if byte.is_ascii_digit() {
            has_digit = true;
        } else if *byte == b'.' && !has_decimal_point {
            has_decimal_point = true;
        } else {
            break;
        }
        end += 1;
    }
    if !has_digit {
        return f64::NAN;
    }
    value[..end].parse().unwrap_or(f64::NAN)
}

fn contains_javascript_word(value: &str, target: &str) -> bool {
    value.match_indices(target).any(|(start, matched)| {
        let end = start + matched.len();
        (start == 0 || !is_javascript_word_byte(value.as_bytes()[start - 1]))
            && (end == value.len() || !is_javascript_word_byte(value.as_bytes()[end]))
    })
}

fn starts_with_javascript_word(value: &str, target: &str) -> bool {
    value.strip_prefix(target).is_some_and(|remainder| {
        remainder
            .as_bytes()
            .first()
            .is_none_or(|byte| !is_javascript_word_byte(*byte))
    })
}

fn is_javascript_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn is_decimal_byte(byte: u8) -> bool {
    byte.is_ascii_digit() || byte == b'.'
}
