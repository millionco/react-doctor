use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const ROOT_FONT_SIZE_PX: f64 = 16.0;
const WIDE_TRACKING_THRESHOLD_EM: f64 = 0.05;

#[derive(Debug, Default, Clone)]
pub struct NoWideLetterSpacing;

declare_oxc_lint!(
    /// Disallow wide letter spacing on body text.
    NoWideLetterSpacing,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow wide letter spacing on body text.",
);

impl Rule for NoWideLetterSpacing {
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
        let AstKind::JSXOpeningElement(opening_element) = ctx.nodes().parent_kind(node.id()) else {
            return;
        };
        if has_uppercase_sibling_prop(opening_element) {
            return;
        }
        let mut is_uppercase = false;
        let mut letter_spacing_property = None;
        let mut letter_spacing_em = None;
        for property in &style.properties {
            let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            let Some(property_name) = property.key.static_name() else {
                continue;
            };
            if property_name == "textTransform"
                && matches!(
                    &property.value,
                    Expression::StringLiteral(value) if value.value == "uppercase"
                )
            {
                is_uppercase = true;
            }
            if property_name != "letterSpacing" {
                continue;
            }
            letter_spacing_property = Some(property.as_ref());
            match &property.value {
                Expression::StringLiteral(value) if !value.value.is_empty() => {
                    if let Some(value) = parse_letter_spacing_em(value.value.as_str()) {
                        letter_spacing_em = Some(value);
                    }
                }
                _ => {
                    if let Some(value) = get_static_style_property_number_value(property)
                        && value > 0.0
                    {
                        letter_spacing_em = Some(value / ROOT_FONT_SIZE_PX);
                    }
                }
            }
        }
        let (Some(property), Some(letter_spacing_em)) =
            (letter_spacing_property, letter_spacing_em)
        else {
            return;
        };
        if is_uppercase || !(letter_spacing_em > WIDE_TRACKING_THRESHOLD_EM) {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users find body text harder to read at {}em letter spacing, so save wide spacing for short uppercase labels.",
                format_two_decimals(letter_spacing_em),
            ))
            .with_label(property.span),
        );
    }
}

fn has_uppercase_sibling_prop(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    opening_element.attributes.iter().any(|attribute| {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            return false;
        };
        let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            return false;
        };
        match attribute_name.name.as_str() {
            "uppercase" => is_truthy_boolean_jsx_attribute(attribute.value.as_ref()),
            "textTransform" => {
                get_direct_jsx_attribute_string_value(attribute.value.as_ref()) == Some("uppercase")
            }
            _ => false,
        }
    })
}

fn is_truthy_boolean_jsx_attribute(value: Option<&JSXAttributeValue<'_>>) -> bool {
    match value {
        None => true,
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            matches!(&container.expression, JSXExpression::BooleanLiteral(value) if value.value)
        }
        _ => false,
    }
}

fn get_direct_jsx_attribute_string_value<'a>(
    value: Option<&'a JSXAttributeValue<'a>>,
) -> Option<&'a str> {
    match value? {
        JSXAttributeValue::StringLiteral(value) => Some(value.value.as_str()),
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::StringLiteral(value) => Some(value.value.as_str()),
            _ => None,
        },
        _ => None,
    }
}

fn parse_letter_spacing_em(value: &str) -> Option<f64> {
    if let Some(value) = value.strip_suffix("em") {
        return parse_unsigned_decimal(value);
    }
    parse_unsigned_decimal(value.strip_suffix("px")?).map(|value| value / ROOT_FONT_SIZE_PX)
}

fn parse_unsigned_decimal(value: &str) -> Option<f64> {
    if value.is_empty()
        || !value
            .chars()
            .all(|character| character.is_ascii_digit() || character == '.')
    {
        return None;
    }
    let mut has_digit = false;
    let mut has_decimal_point = false;
    let mut prefix_end = 0;
    for (index, character) in value.char_indices() {
        if character.is_ascii_digit() {
            has_digit = true;
            prefix_end = index + character.len_utf8();
        } else if !has_decimal_point {
            has_decimal_point = true;
            prefix_end = index + character.len_utf8();
        } else {
            break;
        }
    }
    if !has_digit {
        return Some(f64::NAN);
    }
    Some(value[..prefix_end].parse().unwrap_or(f64::NAN))
}

fn format_two_decimals(value: f64) -> String {
    format!("{:.2}", (value * 100.0).round() / 100.0)
}
