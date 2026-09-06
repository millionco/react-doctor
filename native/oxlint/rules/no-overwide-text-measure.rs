use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const READABLE_LINE_LENGTH_MAX_CH: f64 = 80.0;
const TEXT_ELEMENT_NAMES: [&str; 5] = ["blockquote", "dd", "figcaption", "li", "p"];

#[derive(Debug, Default, Clone)]
pub struct NoOverwideTextMeasure;

declare_oxc_lint!(
    /// Disallow text measures wider than 80 characters.
    NoOverwideTextMeasure,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow overwide text measures.",
);

impl Rule for NoOverwideTextMeasure {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &opening_element.name else {
            return;
        };
        if !TEXT_ELEMENT_NAMES.contains(&identifier.name.as_str()) {
            return;
        }
        if let Some(class_name) = get_static_class_name(opening_element) {
            let tokens = tailwind_class_name_tokens(class_name);
            if let Some(overwide_utility) = tokens.iter().find_map(|token| {
                parse_character_width_utility(token.utility)
                    .is_some_and(|(_, value)| value > READABLE_LINE_LENGTH_MAX_CH)
                    .then_some(token.utility)
            }) {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "The explicit {overwide_utility} measure creates lines that are difficult to track. Keep body text at 80ch or less."
                    ))
                    .with_label(opening_element.span),
                );
                return;
            }
        }
        for attribute in &opening_element.attributes {
            let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let Some(style) = get_inline_style_object_expression(attribute) else {
                continue;
            };
            for property_name in ["width", "maxWidth"] {
                let Some(property) = get_effective_static_style_property(style, property_name)
                else {
                    continue;
                };
                let oxc_ast::ast::Expression::StringLiteral(string_literal) = &property.value
                else {
                    continue;
                };
                let property_value = string_literal
                    .value
                    .trim_matches(|character| is_js_whitespace(character));
                let Some((number, value)) = parse_character_width_value(property_value) else {
                    continue;
                };
                if value <= READABLE_LINE_LENGTH_MAX_CH {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "This {number}ch text measure is too wide for comfortable reading. Constrain it to 80ch or less."
                    ))
                    .with_label(property.span),
                );
            }
        }
    }
}

fn parse_character_width_utility(utility: &str) -> Option<(&str, f64)> {
    let value = utility
        .strip_prefix("max-w-[")
        .or_else(|| utility.strip_prefix("w-["))?
        .strip_suffix(']')?;
    parse_character_width_value(value)
}

fn parse_character_width_value(value: &str) -> Option<(&str, f64)> {
    let number = value.strip_suffix("ch")?;
    if number.is_empty()
        || !number
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
    {
        return None;
    }
    let decimal_end = number
        .bytes()
        .scan(false, |has_decimal_point, byte| {
            if byte == b'.' {
                if *has_decimal_point {
                    return None;
                }
                *has_decimal_point = true;
            }
            Some(())
        })
        .count();
    let parsed_number = number[..decimal_end].parse::<f64>().ok()?;
    Some((number, parsed_number))
}
