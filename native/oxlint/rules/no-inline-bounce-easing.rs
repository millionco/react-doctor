use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const BOUNCE_ANIMATION_NAMES: [&str; 5] = ["bounce", "elastic", "wobble", "jiggle", "spring"];
const TIMING_PROPERTY_NAMES: [&str; 4] = [
    "transition",
    "transitionTimingFunction",
    "animation",
    "animationTimingFunction",
];

#[derive(Debug, Default, Clone)]
pub struct NoInlineBounceEasing;

declare_oxc_lint!(
    /// Disallow bouncy inline easing and default bounce utilities.
    NoInlineBounceEasing,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow bouncy interface motion.",
);

impl Rule for NoInlineBounceEasing {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => {
                let Some(style) = get_inline_style_object_expression(attribute) else {
                    return;
                };
                for property in &style.properties {
                    let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property
                    else {
                        continue;
                    };
                    let Some(property_name) = property.key.static_name() else {
                        continue;
                    };
                    let oxc_ast::ast::Expression::StringLiteral(string_literal) = &property.value
                    else {
                        continue;
                    };
                    let value = string_literal.value.as_str();
                    if TIMING_PROPERTY_NAMES.contains(&property_name.as_ref())
                        && is_overshoot_cubic_bezier(value)
                    {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(
                                "This bouncy easing can feel distracting. Use ease-out or cubic-bezier(0.16, 1, 0.3, 1) for a smoother finish.",
                            )
                            .with_label(property.span),
                        );
                    }
                    if matches!(property_name.as_ref(), "animation" | "animationName")
                        && has_bounce_animation_name(value)
                    {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(
                                "This bounce animation can feel distracting. Use a smooth ease-out, like ease-out-quart or expo, for a natural finish.",
                            )
                            .with_label(property.span),
                        );
                    }
                }
            }
            AstKind::JSXOpeningElement(opening_element) => {
                let Some(class_name) = get_static_class_name(opening_element) else {
                    return;
                };
                if !contains_javascript_word(class_name, "animate-bounce")
                    || class_name.contains("[animation-delay:")
                    || has_animation_delay_style(opening_element)
                {
                    return;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(
                        "Your users see a dated, tacky animate-bounce, so use a subtle ease-out transform for a smoother finish.",
                    )
                    .with_label(opening_element.span),
                );
            }
            _ => {}
        }
    }
}

fn is_overshoot_cubic_bezier(value: &str) -> bool {
    for (_, suffix) in value.match_indices("cubic-bezier(") {
        let Some(arguments) = suffix
            .strip_prefix("cubic-bezier(")
            .and_then(|arguments| arguments.split_once(')').map(|(arguments, _)| arguments))
        else {
            continue;
        };
        let values = arguments
            .split(',')
            .map(str::trim)
            .map(parse_cubic_bezier_number)
            .collect::<Option<Vec<_>>>();
        let Some(values) = values.filter(|values| values.len() == 4) else {
            continue;
        };
        return !(-0.1..=1.1).contains(&values[1]) || !(-0.1..=1.1).contains(&values[3]);
    }
    false
}

fn parse_cubic_bezier_number(value: &str) -> Option<f64> {
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

fn has_bounce_animation_name(value: &str) -> bool {
    let lowercase_value = value.to_lowercase();
    BOUNCE_ANIMATION_NAMES
        .iter()
        .any(|name| lowercase_value.contains(name))
}

fn contains_javascript_word(value: &str, target: &str) -> bool {
    value.match_indices(target).any(|(start, matched)| {
        let end = start + matched.len();
        (start == 0 || !is_javascript_word_byte(value.as_bytes()[start - 1]))
            && (end == value.len() || !is_javascript_word_byte(value.as_bytes()[end]))
    })
}

fn is_javascript_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn has_animation_delay_style(opening_element: &oxc_ast::ast::JSXOpeningElement) -> bool {
    opening_element.attributes.iter().any(|attribute| {
        let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
            return false;
        };
        let Some(style) = get_inline_style_object_expression(attribute) else {
            return false;
        };
        style.properties.iter().any(|property| {
            matches!(
                property,
                oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property)
                    if property.key.static_name().as_deref() == Some("animationDelay")
            )
        })
    })
}
