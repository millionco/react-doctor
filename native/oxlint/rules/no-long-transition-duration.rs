use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXAttributeValue, JSXExpression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const LONG_TRANSITION_DURATION_THRESHOLD_MS: f64 = 1_000.0;
const MOTION_DURATION_THRESHOLD_SECONDS: f64 = 1.0;
const ANIMATION_PROPERTY_NAMES: [&str; 2] = ["animation", "animationDuration"];
const INFINITE_ANIMATION_UTILITIES: [&str; 4] = [
    "animate-ping",
    "animate-pulse",
    "animate-spin",
    "animate-bounce",
];
const INFINITE_ANIMATION_VARIANTS: [&str; 5] = [
    "motion-safe",
    "motion-reduce",
    "dark",
    "group-hover",
    "hover",
];

#[derive(Debug, Default, Clone)]
pub struct NoLongTransitionDuration;

declare_oxc_lint!(
    /// Disallow sluggish interface transition durations.
    NoLongTransitionDuration,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow sluggish interface transition durations.",
);

impl Rule for NoLongTransitionDuration {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => {
                let Some(style) = get_inline_style_object_expression(attribute) else {
                    return;
                };
                let AstKind::JSXOpeningElement(opening_element) =
                    ctx.nodes().parent_kind(node.id())
                else {
                    return;
                };
                if is_statically_hidden_from_screen_reader(opening_element, ctx) {
                    return;
                }
                let is_looping_animation = has_infinite_iteration_count(&style.properties)
                    || has_infinite_animation_class_name(opening_element);
                let has_forwards_fill_mode = style.properties.iter().any(|property| {
                    static_style_property(property, "animationFillMode")
                        .and_then(static_string_property_value)
                        == Some("forwards")
                });
                for property in &style.properties {
                    let ObjectPropertyKind::ObjectProperty(object_property) = property else {
                        continue;
                    };
                    let Some(property_name) = object_property.key.static_name() else {
                        continue;
                    };
                    let Some(value) = static_string_property_value(object_property) else {
                        continue;
                    };
                    let duration_ms = match property_name.as_ref() {
                        "transitionDuration" | "animationDuration" => {
                            longest_duration_property_ms(value)
                        }
                        "transition" => longest_shorthand_duration_ms(value, false),
                        "animation" => longest_shorthand_duration_ms(value, true),
                        _ => None,
                    };
                    if ANIMATION_PROPERTY_NAMES.contains(&property_name.as_ref())
                        && (is_looping_animation || has_forwards_fill_mode)
                    {
                        continue;
                    }
                    let Some(duration_ms) = duration_ms else {
                        continue;
                    };
                    if duration_ms <= LONG_TRANSITION_DURATION_THRESHOLD_MS {
                        continue;
                    }
                    ctx.diagnostic(
                        OxcDiagnostic::warn(format!(
                            "Your users wait through a sluggish {}ms transition, so keep UI transitions under 1000ms & save longer ones for big page-load animations.",
                            format_javascript_number(duration_ms)
                        ))
                        .with_label(object_property.span),
                    );
                }
            }
            AstKind::JSXOpeningElement(opening_element) => {
                if is_statically_hidden_from_screen_reader(opening_element, ctx) {
                    return;
                }
                for transition_object in get_static_motion_transition_objects(opening_element, ctx)
                {
                    if motion_transition_repeats_forever(transition_object)
                        || has_conflicting_motion_spring_duration(transition_object)
                    {
                        continue;
                    }
                    let Some(duration_property) =
                        get_effective_motion_object_property(transition_object, "duration")
                    else {
                        continue;
                    };
                    let Some(duration_seconds) =
                        get_static_style_property_number_value(duration_property)
                    else {
                        continue;
                    };
                    if duration_seconds <= MOTION_DURATION_THRESHOLD_SECONDS {
                        continue;
                    }
                    ctx.diagnostic(
                        OxcDiagnostic::warn(format!(
                            "This Motion transition lasts {}s, which makes routine UI feedback feel delayed. Keep ordinary interface motion under 1s.",
                            format_javascript_number(duration_seconds)
                        ))
                        .with_label(duration_property.span),
                    );
                }
            }
            _ => {}
        }
    }
}

fn static_style_property<'a, 'b>(
    property: &'b ObjectPropertyKind<'a>,
    target_name: &str,
) -> Option<&'b oxc_ast::ast::ObjectProperty<'a>> {
    let ObjectPropertyKind::ObjectProperty(object_property) = property else {
        return None;
    };
    (object_property.key.static_name().as_deref() == Some(target_name)).then_some(object_property)
}

fn static_string_property_value<'a, 'b>(
    property: &'b oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'b str> {
    let Expression::StringLiteral(string_literal) = &property.value else {
        return None;
    };
    Some(string_literal.value.as_str())
}

fn has_infinite_iteration_count(properties: &[ObjectPropertyKind<'_>]) -> bool {
    properties.iter().any(|property| {
        let Some(object_property) = static_style_property(property, "animationIterationCount")
        else {
            return false;
        };
        static_string_property_value(object_property) == Some("infinite")
            || matches!(
                object_property.value.get_inner_expression(),
                Expression::Identifier(identifier) if identifier.name == "Infinity"
            )
    })
}

fn has_infinite_animation_class_name(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    let Some(class_name) = static_class_name_text(opening_element) else {
        return false;
    };
    class_name
        .split(|character| is_js_whitespace(character))
        .filter(|token| !token.is_empty())
        .any(is_infinite_animation_class_token)
}

fn static_class_name_text(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> Option<String> {
    for attribute in &opening_element.attributes {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            continue;
        };
        let oxc_ast::ast::JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            continue;
        };
        if !matches!(attribute_name.name.as_str(), "className" | "class") {
            continue;
        }
        return match attribute.value.as_ref()? {
            JSXAttributeValue::StringLiteral(string_literal) => {
                Some(string_literal.value.to_string())
            }
            JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
                JSXExpression::StringLiteral(string_literal) => {
                    Some(string_literal.value.to_string())
                }
                JSXExpression::TemplateLiteral(template_literal) => Some(
                    template_literal
                        .quasis
                        .iter()
                        .map(|quasi| {
                            quasi
                                .value
                                .cooked
                                .as_ref()
                                .map_or("", |cooked| cooked.as_str())
                        })
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
                _ => None,
            },
            _ => None,
        };
    }
    None
}

fn is_infinite_animation_class_token(mut token: &str) -> bool {
    loop {
        let Some((variant, remainder)) = token.split_once(':') else {
            break;
        };
        if !INFINITE_ANIMATION_VARIANTS.contains(&variant) {
            return false;
        }
        token = remainder;
    }
    INFINITE_ANIMATION_UTILITIES.contains(&token)
}

fn longest_duration_property_ms(value: &str) -> Option<f64> {
    value
        .split(',')
        .filter_map(|segment| {
            parse_duration_segment_ms(segment.trim_matches(|character| is_js_whitespace(character)))
        })
        .fold(None, |longest, duration| {
            Some(longest.map_or(duration, |current: f64| current.max(duration)))
        })
        .filter(|duration| *duration > 0.0)
}

fn parse_duration_segment_ms(segment: &str) -> Option<f64> {
    let (number, multiplier) = if let Some(number) = segment.strip_suffix("ms") {
        (number, 1.0)
    } else {
        (segment.strip_suffix('s')?, 1_000.0)
    };
    if number.is_empty()
        || !number
            .bytes()
            .all(|character| character.is_ascii_digit() || character == b'.')
    {
        return None;
    }
    Some(parse_javascript_float(number)? * multiplier)
}

fn longest_shorthand_duration_ms(value: &str, is_animation: bool) -> Option<f64> {
    value
        .split(',')
        .filter_map(|segment| {
            if is_animation
                && (segment_has_token(segment, "infinite")
                    || segment_has_token(segment, "forwards"))
            {
                return None;
            }
            first_time_token_ms(segment)
        })
        .fold(None, |longest, duration| {
            Some(longest.map_or(duration, |current: f64| current.max(duration)))
        })
        .filter(|duration| *duration > 0.0)
}

fn segment_has_token(segment: &str, target: &str) -> bool {
    segment
        .trim_matches(|character| is_js_whitespace(character))
        .split(|character| is_js_whitespace(character))
        .any(|token| token == target)
}

fn first_time_token_ms(segment: &str) -> Option<f64> {
    let bytes = segment.as_bytes();
    let mut start = 0;
    while start < bytes.len() {
        if !(bytes[start].is_ascii_digit() || bytes[start] == b'.')
            || (start > 0 && bytes[start - 1].is_ascii_alphanumeric())
        {
            start += 1;
            continue;
        }
        let mut number_end = start;
        while number_end < bytes.len()
            && (bytes[number_end].is_ascii_digit() || bytes[number_end] == b'.')
        {
            number_end += 1;
        }
        let (unit_end, multiplier) = if bytes.get(number_end..number_end + 2) == Some(b"ms") {
            (number_end + 2, 1.0)
        } else if bytes.get(number_end) == Some(&b's') {
            (number_end + 1, 1_000.0)
        } else {
            start = number_end.max(start + 1);
            continue;
        };
        if bytes
            .get(unit_end)
            .is_some_and(|character| character.is_ascii_alphanumeric() || *character == b'-')
        {
            start = unit_end;
            continue;
        }
        if let Some(number) = parse_javascript_float(&segment[start..number_end]) {
            return Some(number * multiplier);
        }
        start = unit_end;
    }
    None
}

fn parse_javascript_float(value: &str) -> Option<f64> {
    (1..=value.len())
        .rev()
        .find_map(|end| value[..end].parse::<f64>().ok())
}

fn motion_transition_repeats_forever(
    transition_object: &oxc_ast::ast::ObjectExpression<'_>,
) -> bool {
    let Some(repeat_property) = get_effective_motion_object_property(transition_object, "repeat")
    else {
        return false;
    };
    matches!(
        repeat_property.value.get_inner_expression(),
        Expression::Identifier(identifier) if identifier.name == "Infinity"
    ) || matches!(
        repeat_property.value.get_inner_expression(),
        Expression::NumericLiteral(number) if number.value.is_infinite()
    )
}

fn has_conflicting_motion_spring_duration(
    transition_object: &oxc_ast::ast::ObjectExpression<'_>,
) -> bool {
    let Some(type_property) = get_effective_motion_object_property(transition_object, "type")
    else {
        return false;
    };
    if static_string_property_value(type_property) != Some("spring")
        || !["stiffness", "damping", "mass"]
            .iter()
            .any(|property_name| {
                get_effective_motion_object_property(transition_object, property_name).is_some()
            })
    {
        return false;
    }
    ["duration", "bounce"].iter().any(|property_name| {
        get_effective_motion_object_property(transition_object, property_name).is_some()
    })
}
