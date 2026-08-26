use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const ROOT_FONT_SIZE_PX: f64 = 16.0;
const TAILWIND_SPACING_UNIT_PX: f64 = 4.0;
const INTERACTION_VARIANTS: [&str; 4] = ["active", "focus", "focus-visible", "hover"];
const FONT_WEIGHT_UTILITIES: [&str; 9] = [
    "font-black",
    "font-bold",
    "font-extrabold",
    "font-extralight",
    "font-light",
    "font-medium",
    "font-normal",
    "font-semibold",
    "font-thin",
];
static STATIC_LENGTH_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)^(-?(?:\d+(?:\.\d*)?|\.\d+))(cap|ch|cqb|cqh|cqi|cqmax|cqmin|cqw|em|ex|ic|lh|px|rem|rlh|vb|vh|vi|vmax|vmin|vw|%)$"
);
static UNSIGNED_DECIMAL_PATTERN: Lazy<Regex> =
    lazy_regex!(r"^(?:\d+(?:\.\d*)?|\.\d+)$");
static SIGNED_DECIMAL_PATTERN: Lazy<Regex> =
    lazy_regex!(r"^-?(?:\d+(?:\.\d*)?|\.\d+)$");

#[derive(Clone, Debug, PartialEq)]
enum LayoutPropertyValue {
    Number(f64),
    StaticLength {
        leading_hyphen_count: u8,
        magnitude: f64,
        unit: String,
    },
    Text(String),
}

#[derive(Clone, Debug)]
struct LayoutPropertyDeclaration {
    property: &'static str,
    value: Option<LayoutPropertyValue>,
}

#[derive(Debug, Default, Clone)]
pub struct NoLayoutShiftingInteractionState;

declare_oxc_lint!(
    /// Disallow interaction utilities that change layout geometry or font metrics.
    NoLayoutShiftingInteractionState,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow layout-shifting interaction utilities.",
);

impl Rule for NoLayoutShiftingInteractionState {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if opening_element.attributes.iter().any(|attribute| {
            matches!(
                attribute,
                oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
            )
        }) {
            return;
        }
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        let Some(token) = get_layout_shifting_interaction_token(class_name) else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "The interaction utility \"{token}\" changes layout or font metrics, so nearby content can jump. Use color, shadow, opacity, or transform feedback instead."
            ))
            .with_label(opening_element.span),
        );
    }
}

fn has_interaction_variant(variants: &[&str]) -> bool {
    variants
        .iter()
        .any(|variant| INTERACTION_VARIANTS.contains(variant))
}

fn parse_static_arbitrary_length(value: &str) -> Option<LayoutPropertyValue> {
    let arbitrary_value = value
        .strip_prefix("[length:")
        .or_else(|| value.strip_prefix('['))?
        .strip_suffix(']')?;
    if arbitrary_value.is_empty() {
        return None;
    }
    let captures = STATIC_LENGTH_PATTERN.captures(arbitrary_value)?;
    let numeric_value = captures.get(1)?.as_str().parse::<f64>().ok()?;
    let unit = captures.get(2)?.as_str().to_ascii_lowercase();
    if unit == "px" {
        return Some(LayoutPropertyValue::Number(numeric_value));
    }
    if unit == "rem" {
        return Some(LayoutPropertyValue::Number(
            numeric_value * ROOT_FONT_SIZE_PX,
        ));
    }
    let is_negative = numeric_value < 0.0;
    Some(LayoutPropertyValue::StaticLength {
        leading_hyphen_count: u8::from(is_negative),
        magnitude: if is_negative {
            -numeric_value
        } else {
            numeric_value
        },
        unit,
    })
}

fn parse_spacing_value(value: &str, is_negative: bool) -> Option<LayoutPropertyValue> {
    let sign = if is_negative { -1.0 } else { 1.0 };
    if value == "px" {
        return Some(LayoutPropertyValue::Number(sign));
    }
    if UNSIGNED_DECIMAL_PATTERN.is_match(value) {
        return value.parse::<f64>().ok().map(|numeric_value| {
            LayoutPropertyValue::Number(
                sign * numeric_value * TAILWIND_SPACING_UNIT_PX,
            )
        });
    }
    if let Some(arbitrary_length) = parse_static_arbitrary_length(value) {
        return Some(match arbitrary_length {
            LayoutPropertyValue::Number(numeric_value) => {
                LayoutPropertyValue::Number(sign * numeric_value)
            }
            LayoutPropertyValue::StaticLength {
                leading_hyphen_count,
                magnitude,
                unit,
            } => LayoutPropertyValue::StaticLength {
                leading_hyphen_count: leading_hyphen_count + u8::from(is_negative),
                magnitude,
                unit,
            },
            LayoutPropertyValue::Text(text) => LayoutPropertyValue::Text(text),
        });
    }
    (!value.starts_with('[')).then(|| {
        LayoutPropertyValue::Text(format!("{}{value}", if is_negative { "-" } else { "" }))
    })
}

fn parse_flex_factor(value: &str) -> Option<LayoutPropertyValue> {
    let arbitrary_value = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'));
    if let Some(arbitrary_value) = arbitrary_value
        && SIGNED_DECIMAL_PATTERN.is_match(arbitrary_value)
    {
        return arbitrary_value
            .parse::<f64>()
            .ok()
            .map(LayoutPropertyValue::Number);
    }
    if SIGNED_DECIMAL_PATTERN.is_match(value) {
        return value
            .parse::<f64>()
            .ok()
            .map(LayoutPropertyValue::Number);
    }
    (!value.starts_with('[')).then(|| LayoutPropertyValue::Text(value.to_string()))
}

fn declarations(
    properties: &[&'static str],
    value: Option<LayoutPropertyValue>,
) -> Vec<LayoutPropertyDeclaration> {
    properties
        .iter()
        .map(|property| LayoutPropertyDeclaration {
            property,
            value: value.clone(),
        })
        .collect()
}

fn spacing_properties(prefix: &str) -> Option<&'static [&'static str]> {
    match prefix {
        "m" => Some(&["margin-top", "margin-right", "margin-bottom", "margin-left"]),
        "mx" => Some(&["margin-right", "margin-left"]),
        "my" => Some(&["margin-top", "margin-bottom"]),
        "mt" => Some(&["margin-top"]),
        "mr" => Some(&["margin-right"]),
        "mb" => Some(&["margin-bottom"]),
        "ml" => Some(&["margin-left"]),
        "ms" => Some(&["margin-inline-start"]),
        "me" => Some(&["margin-inline-end"]),
        "p" => Some(&["padding-top", "padding-right", "padding-bottom", "padding-left"]),
        "px" => Some(&["padding-right", "padding-left"]),
        "py" => Some(&["padding-top", "padding-bottom"]),
        "pt" => Some(&["padding-top"]),
        "pr" => Some(&["padding-right"]),
        "pb" => Some(&["padding-bottom"]),
        "pl" => Some(&["padding-left"]),
        "ps" => Some(&["padding-inline-start"]),
        "pe" => Some(&["padding-inline-end"]),
        _ => None,
    }
}

fn get_layout_property_declarations(utility: &str) -> Vec<LayoutPropertyDeclaration> {
    let is_negative = utility.starts_with('-');
    let unsigned_utility = utility.strip_prefix('-').unwrap_or(utility);

    if let Some((prefix, value)) = unsigned_utility.split_once('-')
        && prefix.starts_with(['m', 'p'])
        && prefix.len() <= 2
        && let Some(properties) = spacing_properties(prefix)
    {
        return declarations(properties, parse_spacing_value(value, is_negative));
    }

    if let Some(value) = unsigned_utility.strip_prefix("gap-") {
        let (properties, value) = if let Some(value) = value.strip_prefix("x-") {
            (&["column-gap"][..], value)
        } else if let Some(value) = value.strip_prefix("y-") {
            (&["row-gap"][..], value)
        } else {
            (&["row-gap", "column-gap"][..], value)
        };
        if !value.is_empty() {
            return declarations(properties, parse_spacing_value(value, false));
        }
    }

    if let Some(value) = unsigned_utility.strip_prefix("space-x-")
        && !value.is_empty()
    {
        return declarations(&["space-x"], parse_spacing_value(value, is_negative));
    }
    if let Some(value) = unsigned_utility.strip_prefix("space-y-")
        && !value.is_empty()
    {
        return declarations(&["space-y"], parse_spacing_value(value, is_negative));
    }

    for (prefix, properties) in [
        ("w", &["width"][..]),
        ("h", &["height"][..]),
        ("size", &["width", "height"][..]),
        ("min-w", &["min-width"][..]),
        ("min-h", &["min-height"][..]),
        ("max-w", &["max-width"][..]),
        ("max-h", &["max-height"][..]),
        ("basis", &["flex-basis"][..]),
    ] {
        let Some(value) = unsigned_utility
            .strip_prefix(prefix)
            .and_then(|value| value.strip_prefix('-'))
        else {
            continue;
        };
        return declarations(properties, parse_spacing_value(value, is_negative));
    }

    for (prefix, property) in [("grow", "flex-grow"), ("shrink", "flex-shrink")] {
        if unsigned_utility == prefix {
            return declarations(&[property], Some(LayoutPropertyValue::Number(1.0)));
        }
        if let Some(value) = unsigned_utility
            .strip_prefix(prefix)
            .and_then(|value| value.strip_prefix('-'))
            && !value.is_empty()
        {
            return declarations(&[property], parse_flex_factor(value));
        }
    }

    if let Some(value) = unsigned_utility.strip_prefix("leading-")
        && !value.is_empty()
    {
        return declarations(&["line-height"], parse_spacing_value(value, is_negative));
    }
    if let Some(value) = unsigned_utility.strip_prefix("tracking-")
        && !value.is_empty()
    {
        return declarations(
            &["letter-spacing"],
            parse_spacing_value(value, is_negative),
        );
    }
    if FONT_WEIGHT_UTILITIES.contains(&unsigned_utility) {
        return declarations(
            &["font-weight"],
            Some(LayoutPropertyValue::Text(unsigned_utility.to_string())),
        );
    }
    if let Some(font_size_px) = parse_static_tailwind_font_size(unsigned_utility) {
        return declarations(
            &["font-size"],
            Some(LayoutPropertyValue::Number(font_size_px)),
        );
    }
    Vec::new()
}

fn get_layout_property_declaration(
    utility: &str,
    property: &str,
) -> Option<LayoutPropertyDeclaration> {
    get_layout_property_declarations(utility)
        .into_iter()
        .find(|declaration| declaration.property == property)
}

fn get_layout_shifting_interaction_token<'a>(class_name: &'a str) -> Option<&'a str> {
    let tokens = tailwind_class_name_tokens(class_name);
    let resting_tokens = tailwind_class_name_tokens(class_name)
        .into_iter()
        .filter(|token| !has_interaction_variant(&token.variants))
        .collect::<Vec<_>>();
    let mut interaction_tokens = tokens
        .iter()
        .filter(|token| has_interaction_variant(&token.variants))
        .collect::<Vec<_>>();
    interaction_tokens.sort_by(|left, right| right.is_important.cmp(&left.is_important));

    for interaction_token in interaction_tokens {
        for interaction_declaration in
            get_layout_property_declarations(interaction_token.utility)
        {
            if interaction_declaration.value.is_none() {
                continue;
            }
            let property = interaction_declaration.property;
            let effective_resolution = resolve_effective_tailwind_class_name_token(
                &tokens,
                |utility| get_layout_property_declaration(utility, property).is_some(),
                &interaction_token.variants,
            );
            if effective_resolution.utility != Some(interaction_token.utility) {
                continue;
            }
            let Some(effective_declaration) = effective_resolution
                .utility
                .and_then(|utility| get_layout_property_declaration(utility, property))
            else {
                continue;
            };
            let Some(effective_value) = effective_declaration.value else {
                continue;
            };
            let resting_resolution = resolve_effective_tailwind_class_name_token(
                &resting_tokens,
                |utility| get_layout_property_declaration(utility, property).is_some(),
                &interaction_token.variants,
            );
            if resting_resolution.is_ambiguous {
                continue;
            }
            let Some(resting_utility) = resting_resolution.utility else {
                return Some(interaction_token.raw_token);
            };
            let Some(resting_declaration) =
                get_layout_property_declaration(resting_utility, property)
            else {
                continue;
            };
            let Some(resting_value) = resting_declaration.value else {
                continue;
            };
            if resting_value != effective_value {
                return Some(interaction_token.raw_token);
            }
        }
    }
    None
}
