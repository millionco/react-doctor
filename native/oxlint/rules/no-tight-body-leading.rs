use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const ROOT_FONT_SIZE_PX: f64 = 16.0;
const TIGHT_LINE_HEIGHT_RATIO: f64 = 1.3;
const DISPLAY_TEXT_MIN_FONT_SIZE_PX: f64 = 24.0;
const LONG_BODY_TEXT_MIN_CHARACTERS: usize = 48;
const BODY_TEXT_ELEMENT_NAMES: [&str; 6] = ["blockquote", "dd", "figcaption", "li", "p", "td"];
const TIGHT_LEADING_CLASS_NAMES: [&str; 2] = ["leading-none", "leading-tight"];
const CLASS_MESSAGE: &str = "This line spacing is too tight for a long passage. Increase the leading so readers can track between lines.";

#[derive(Debug, Default, Clone)]
pub struct NoTightBodyLeading;

declare_oxc_lint!(
    /// Disallow cramped line spacing on long body copy.
    NoTightBodyLeading,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow tight body-copy leading.",
);

impl Rule for NoTightBodyLeading {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &element.opening_element.name else {
            return;
        };
        if !BODY_TEXT_ELEMENT_NAMES.contains(&identifier.name.as_str()) {
            return;
        }
        let static_text = normalize_js_whitespace(&get_static_jsx_text(element));
        if static_text.encode_utf16().count() < LONG_BODY_TEXT_MIN_CHARACTERS {
            return;
        }
        let class_name = get_static_class_name(&element.opening_element);
        let style_expression = find_jsx_attribute(&element.opening_element, "style")
            .and_then(|attribute| get_inline_style_object_expression(attribute));
        let font_size_property = style_expression
            .and_then(|style| get_effective_static_style_property(style, "fontSize"));
        let inline_font_size_px = font_size_property.and_then(get_pixel_value);
        let tailwind_font_size_px =
            class_name.and_then(|value| get_static_tailwind_font_size(value));
        let effective_font_size_px = inline_font_size_px.or(tailwind_font_size_px);
        if effective_font_size_px
            .is_some_and(|font_size| font_size >= DISPLAY_TEXT_MIN_FONT_SIZE_PX)
        {
            return;
        }
        if class_name.is_some_and(|value| {
            tailwind_class_name_tokens(value).iter().any(|token| {
                token.variants.is_empty() && TIGHT_LEADING_CLASS_NAMES.contains(&token.utility)
            })
        }) {
            ctx.diagnostic(
                OxcDiagnostic::warn(CLASS_MESSAGE).with_label(element.opening_element.span),
            );
            return;
        }
        let Some(style_expression) = style_expression else {
            return;
        };
        let Some(line_height_property) =
            get_effective_static_style_property(style_expression, "lineHeight")
        else {
            return;
        };
        let mut line_height_ratio = get_unitless_line_height(line_height_property);
        if line_height_ratio.is_none()
            && let Some(font_size_property) = font_size_property
            && let (Some(font_size_px), Some(line_height_px)) = (
                get_pixel_value(font_size_property),
                get_pixel_value(line_height_property),
            )
            && font_size_px != 0.0
            && line_height_px != 0.0
        {
            line_height_ratio = Some(line_height_px / font_size_px);
        }
        let Some(line_height_ratio) = line_height_ratio else {
            return;
        };
        if line_height_ratio >= TIGHT_LINE_HEIGHT_RATIO {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This {line_height_ratio:.2} line-height ratio crowds a long passage. Use at least 1.3 for body copy."
            ))
            .with_label(line_height_property.span),
        );
    }
}

fn get_pixel_value(property: &oxc_ast::ast::ObjectProperty) -> Option<f64> {
    if let Some(number_value) = get_static_style_property_number_value(property) {
        return Some(number_value);
    }
    let oxc_ast::ast::Expression::StringLiteral(string_literal) = &property.value else {
        return None;
    };
    let string_value = string_literal
        .value
        .trim_matches(|character| is_js_whitespace(character));
    string_value
        .strip_suffix("px")
        .and_then(parse_decimal_value)
        .or_else(|| {
            string_value
                .strip_suffix("rem")
                .and_then(parse_decimal_value)
                .map(|value| value * ROOT_FONT_SIZE_PX)
        })
}

fn get_unitless_line_height(property: &oxc_ast::ast::ObjectProperty) -> Option<f64> {
    if let Some(number_value) = get_static_style_property_number_value(property) {
        return Some(number_value);
    }
    let oxc_ast::ast::Expression::StringLiteral(string_literal) = &property.value else {
        return None;
    };
    parse_decimal_value(
        string_literal
            .value
            .trim_matches(|character| is_js_whitespace(character)),
    )
}

fn parse_decimal_value(value: &str) -> Option<f64> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
    {
        return None;
    }
    value.parse::<f64>().ok()
}

fn normalize_js_whitespace(value: &str) -> String {
    value
        .split(|character| is_js_whitespace(character))
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
