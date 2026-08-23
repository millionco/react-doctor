use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const ROOT_FONT_SIZE_PX: f64 = 16.0;
const CRUSHED_TRACKING_THRESHOLD_EM: f64 = -0.08;

#[derive(Debug, Default, Clone)]
pub struct NoCrushedLetterSpacing;

declare_oxc_lint!(
    /// Disallow letter spacing that compresses text excessively.
    NoCrushedLetterSpacing,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow crushed letter spacing.",
);

impl Rule for NoCrushedLetterSpacing {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => {
                let Some(style) = get_inline_style_object_expression(attribute) else {
                    return;
                };
                let Some(element) = ancestor_jsx_element(node, ctx) else {
                    return;
                };
                if get_static_jsx_text(element)
                    .trim_matches(|character| is_js_whitespace(character))
                    .is_empty()
                {
                    return;
                }
                let Some(property) = get_effective_static_style_property(style, "letterSpacing")
                else {
                    return;
                };
                let Some(tracking_em) = get_tracking_em(property) else {
                    return;
                };
                if tracking_em >= CRUSHED_TRACKING_THRESHOLD_EM {
                    return;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "This {tracking_em:.2}em tracking compresses the letterforms and hurts readability. Use a less aggressive value."
                    ))
                    .with_label(property.span),
                );
            }
            AstKind::JSXOpeningElement(opening_element) => {
                let Some(element) = ancestor_jsx_element(node, ctx) else {
                    return;
                };
                if get_static_jsx_text(element)
                    .trim_matches(|character| is_js_whitespace(character))
                    .is_empty()
                {
                    return;
                }
                let Some(class_name) = get_static_class_name(opening_element) else {
                    return;
                };
                let tokens = tailwind_class_name_tokens(class_name);
                let Some(tracking_em) = tokens
                    .iter()
                    .find_map(|token| get_arbitrary_tracking_em(token.utility))
                else {
                    return;
                };
                if tracking_em >= CRUSHED_TRACKING_THRESHOLD_EM {
                    return;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "This {tracking_em:.2}em tracking crowds the characters together. Loosen it to preserve legibility."
                    ))
                    .with_label(opening_element.span),
                );
            }
            _ => {}
        }
    }
}

fn ancestor_jsx_element<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::JSXElement<'a>> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            return None;
        };
        Some(element)
    })
}

fn get_tracking_em(property: &oxc_ast::ast::ObjectProperty) -> Option<f64> {
    if let Some(number_value) = get_static_style_property_number_value(property) {
        return Some(number_value / ROOT_FONT_SIZE_PX);
    }
    let oxc_ast::ast::Expression::StringLiteral(string_literal) = &property.value else {
        return None;
    };
    parse_tracking_length(
        string_literal
            .value
            .trim_matches(|character| is_js_whitespace(character)),
    )
}

fn get_arbitrary_tracking_em(utility: &str) -> Option<f64> {
    let value = utility.strip_prefix("tracking-[")?.strip_suffix(']')?;
    parse_tracking_length(value)
}

fn parse_tracking_length(value: &str) -> Option<f64> {
    let (number, divisor) = value
        .strip_suffix("em")
        .map(|number| (number, 1.0))
        .or_else(|| {
            value
                .strip_suffix("px")
                .map(|number| (number, ROOT_FONT_SIZE_PX))
        })?;
    parse_javascript_decimal(number).map(|value| value / divisor)
}

fn parse_javascript_decimal(value: &str) -> Option<f64> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'.' | b'-'))
    {
        return None;
    }
    let bytes = value.as_bytes();
    let mut end = usize::from(bytes.first() == Some(&b'-'));
    let mut has_digit = false;
    let mut has_decimal_point = false;
    while let Some(byte) = bytes.get(end) {
        if byte.is_ascii_digit() {
            has_digit = true;
            end += 1;
        } else if *byte == b'.' && !has_decimal_point {
            has_decimal_point = true;
            end += 1;
        } else {
            break;
        }
    }
    has_digit
        .then(|| value[..end].parse::<f64>().ok())
        .flatten()
}
