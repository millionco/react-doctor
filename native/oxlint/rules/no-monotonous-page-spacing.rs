use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXElementName, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const PAGE_SPACING_MIN_SAMPLES: usize = 12;
const PAGE_SPACING_DOMINANT_RATIO: f64 = 0.67;
const PAGE_SPACING_MAX_DISTINCT_VALUES: usize = 4;
const ROOT_FONT_SIZE_PX: f64 = 16.0;
const TAILWIND_SPACING_UNIT_PX: f64 = 4.0;
const SPACING_STYLE_PROPERTIES: [&str; 17] = [
    "gap",
    "columnGap",
    "rowGap",
    "margin",
    "marginBlock",
    "marginInline",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "padding",
    "paddingBlock",
    "paddingInline",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
];

#[derive(Debug, Default, Clone)]
pub struct NoMonotonousPageSpacing;

declare_oxc_lint!(
    /// Disallow pages dominated by one explicit spacing value.
    NoMonotonousPageSpacing,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow monotonous explicit page spacing.",
);

impl Rule for NoMonotonousPageSpacing {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !matches!(
            &element.opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "main"
        ) {
            return;
        }

        let has_tailwind = has_capability_or_unspecified(ctx, "tailwind");
        let mut opening_elements = vec![element.opening_element.as_ref()];
        collect_static_jsx_opening_elements(&element.children, &mut opening_elements);
        let mut spacing_samples = Vec::new();
        for opening_element in opening_elements {
            if !is_proven_intrinsic_jsx_element(opening_element, ctx) {
                continue;
            }
            let sample_start_index = spacing_samples.len();
            let has_inline_spacing = collect_inline_spacing(opening_element, &mut spacing_samples);
            let class_name = get_static_class_name(opening_element);
            if class_name.is_some_and(|class_name| {
                has_tailwind
                    && has_inline_spacing
                    && has_important_class_spacing(class_name)
            }) {
                spacing_samples.truncate(sample_start_index);
                continue;
            }
            if let Some(class_name) = class_name
                && has_tailwind
                && !has_inline_spacing
            {
                collect_class_spacing(class_name, &mut spacing_samples);
            }
        }
        if spacing_samples.len() < PAGE_SPACING_MIN_SAMPLES {
            return;
        }

        let mut counts = Vec::<(u64, f64, usize)>::new();
        for sample in &spacing_samples {
            let sample_key = spacing_key(*sample);
            if let Some((_, _, count)) = counts
                .iter_mut()
                .find(|(existing_key, _, _)| *existing_key == sample_key)
            {
                *count += 1;
            } else {
                if counts.len() == PAGE_SPACING_MAX_DISTINCT_VALUES {
                    return;
                }
                counts.push((sample_key, *sample, 1));
            }
        }
        let dominant_count = counts.iter().map(|(_, _, count)| *count).max().unwrap_or(0);
        if dominant_count as f64 / (spacing_samples.len() as f64)
            < PAGE_SPACING_DOMINANT_RATIO
        {
            return;
        }
        let dominant_spacing = counts
            .iter()
            .find_map(|(_, value, count)| (*count == dominant_count).then_some(*value))
            .unwrap_or(f64::NAN);
        let dominant_spacing_text = format_javascript_number(dominant_spacing);
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "One {dominant_spacing_text}px spacing value accounts for {dominant_count} of {} explicit page measurements. Add spacing tiers that reflect content hierarchy.",
                spacing_samples.len(),
            ))
            .with_label(element.opening_element.span),
        );
    }
}

#[derive(Clone, Copy)]
struct TailwindSpacingState {
    is_ambiguous: bool,
    is_important: bool,
    value_px: f64,
}

fn collect_class_spacing(class_name: &str, spacing_samples: &mut Vec<f64>) {
    let mut state_by_slot = Vec::<(&str, TailwindSpacingState)>::new();
    for token in tailwind_class_name_tokens(class_name) {
        if !token.variants.is_empty() {
            continue;
        }
        let Some((spacing_prefix, spacing_value)) = parse_spacing_utility(token.utility) else {
            continue;
        };
        let parsed_value =
            parse_javascript_decimal_prefix_value(spacing_value).unwrap_or(f64::NAN);
        let value_px = parsed_value * TAILWIND_SPACING_UNIT_PX;
        for affected_slot in spacing_slots(spacing_prefix) {
            let current_state = state_by_slot
                .iter_mut()
                .find(|(slot, _)| slot == affected_slot);
            let Some((_, current_state)) = current_state else {
                state_by_slot.push((affected_slot, TailwindSpacingState {
                    is_ambiguous: false,
                    is_important: token.is_important,
                    value_px,
                }));
                continue;
            };
            if token.is_important && !current_state.is_important {
                *current_state = TailwindSpacingState {
                    is_ambiguous: false,
                    is_important: true,
                    value_px,
                };
                continue;
            }
            if !token.is_important && current_state.is_important {
                continue;
            }
            if current_state.value_px != value_px {
                current_state.is_ambiguous = true;
            }
        }
    }
    if state_by_slot
        .iter()
        .any(|(_, state)| state.is_ambiguous)
    {
        return;
    }
    let mut effective_value_keys = Vec::new();
    for (_, state) in state_by_slot {
        let value_key = spacing_key(state.value_px);
        if effective_value_keys.contains(&value_key) {
            continue;
        }
        effective_value_keys.push(value_key);
        spacing_samples.push(state.value_px);
    }
}

fn has_important_class_spacing(class_name: &str) -> bool {
    tailwind_class_name_tokens(class_name).iter().any(|token| {
        token.variants.is_empty()
            && token.is_important
            && parse_spacing_utility(token.utility).is_some()
    })
}

fn collect_inline_spacing(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    spacing_samples: &mut Vec<f64>,
) -> bool {
    let style_attribute = get_authoritative_jsx_attribute(opening_element, "style", true);
    let Some(style_attribute) = style_attribute else {
        return opening_element
            .attributes
            .iter()
            .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)));
    };
    let Some(style_expression) = get_inline_style_object_expression(style_attribute) else {
        return true;
    };
    let mut has_inline_spacing = false;
    for property_name in SPACING_STYLE_PROPERTIES {
        let Some(property) = get_effective_static_style_property(style_expression, property_name)
        else {
            continue;
        };
        has_inline_spacing = true;
        if let Some(spacing_px) = get_spacing_px(property) {
            spacing_samples.push(spacing_px);
        }
    }
    has_inline_spacing
        || style_expression.properties.iter().any(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return true;
            };
            property.key.static_name().is_none()
        })
}

fn get_spacing_px(property: &oxc_ast::ast::ObjectProperty<'_>) -> Option<f64> {
    if let Some(number_value) = get_static_style_property_number_value(property) {
        return Some(number_value);
    }
    let Expression::StringLiteral(string_literal) = &property.value else {
        return None;
    };
    let string_value = string_literal
        .value
        .trim_matches(|character| is_js_whitespace(character));
    let (number, multiplier) = if let Some(number) = string_value.strip_suffix("px") {
        (number, 1.0)
    } else if let Some(number) = string_value.strip_suffix("rem") {
        (number, ROOT_FONT_SIZE_PX)
    } else {
        return None;
    };
    if number.is_empty()
        || !number
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || *byte == b'.')
    {
        return None;
    }
    Some(
        parse_javascript_decimal_prefix_value(number).unwrap_or(f64::NAN) * multiplier,
    )
}

fn parse_spacing_utility(utility: &str) -> Option<(&str, &str)> {
    for spacing_prefix in [
        "gap-x", "gap-y", "gap", "px", "py", "pt", "pr", "pb", "pl", "mx", "my",
        "mt", "mr", "mb", "ml", "p", "m",
    ] {
        let Some(value) = utility
            .strip_prefix(spacing_prefix)
            .and_then(|suffix| suffix.strip_prefix('-'))
        else {
            continue;
        };
        if !value.is_empty()
            && value
                .as_bytes()
                .iter()
                .all(|byte| byte.is_ascii_digit() || *byte == b'.')
        {
            return Some((spacing_prefix, value));
        }
    }
    None
}

fn spacing_slots(prefix: &str) -> &'static [&'static str] {
    match prefix {
        "p" => &["padding-top", "padding-right", "padding-bottom", "padding-left"],
        "px" => &["padding-right", "padding-left"],
        "py" => &["padding-top", "padding-bottom"],
        "pt" => &["padding-top"],
        "pr" => &["padding-right"],
        "pb" => &["padding-bottom"],
        "pl" => &["padding-left"],
        "m" => &["margin-top", "margin-right", "margin-bottom", "margin-left"],
        "mx" => &["margin-right", "margin-left"],
        "my" => &["margin-top", "margin-bottom"],
        "mt" => &["margin-top"],
        "mr" => &["margin-right"],
        "mb" => &["margin-bottom"],
        "ml" => &["margin-left"],
        "gap" => &["row-gap", "column-gap"],
        "gap-x" => &["column-gap"],
        "gap-y" => &["row-gap"],
        _ => &[],
    }
}

fn spacing_key(value: f64) -> u64 {
    if value == 0.0 {
        return 0.0_f64.to_bits();
    }
    if value.is_nan() {
        return f64::NAN.to_bits();
    }
    value.to_bits()
}
