use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const CLASS_MESSAGE: &str = "This fixed-pixel grid is decorative rather than functional. Simplify the surface or tie the grid to spatial content.";
const DECORATIVE_GRID_MIN_GRADIENT_LAYERS: usize = 2;
const STYLE_MESSAGE: &str = "This fixed-pixel background draws a decorative coordinate grid. Use it only when the grid conveys spatial information.";

static LEADING_HAIRLINE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u)\b1(?:\.0+)?px\s*,\s*transparent\s+1(?:\.0+)?px\b"
);
static INVERTED_HAIRLINE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?is)transparent\s+calc\(\s*100%\s*-\s*1(?:\.0+)?px\s*\)\s*,.*\b1(?:\.0+)?px\b"
);
static VERTICAL_GRADIENT_DIRECTION_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u)^(?:to\s+(?:left|right)|(?:90|270)(?:\.0+)?deg)\s*,");
static HORIZONTAL_GRADIENT_DIRECTION_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u)^(?:to\s+(?:top|bottom)|(?:0|180|360)(?:\.0+)?deg)\s*,"
);
static EXPLICIT_GRADIENT_DIRECTION_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u)^(?:to\b|[-+.\d]+(?:deg|grad|rad|turn)\b|in\s)");
static FIXED_PIXEL_TILE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u)^(\d+(?:\.\d+)?)px(?:\s+(\d+(?:\.\d+)?)px)?(?:\s+(?:no-repeat|repeat|round|space)){0,2}$"
);

#[derive(Debug, Default, Clone)]
pub struct NoDecorativeGridBackground;

declare_oxc_lint!(
    /// Disallow decorative fixed-pixel coordinate-grid backgrounds.
    NoDecorativeGridBackground,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow decorative fixed-pixel coordinate-grid backgrounds.",
);

impl Rule for NoDecorativeGridBackground {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if is_data_visualization_context(opening_element, node, ctx) {
            return;
        }

        let mut inline_background_size = None;
        let style_attribute = get_authoritative_jsx_attribute(opening_element, "style", true);
        if style_attribute.is_none() && jsx_spread_may_provide_style(opening_element) {
            return;
        }
        if let Some(style_attribute) = style_attribute {
            let Some(style) =
                get_inline_style_object_expression_with_aliases(style_attribute, ctx)
            else {
                return;
            };
            if style
                .properties
                .iter()
                .any(|property| {
                    !matches!(
                        property,
                        ObjectPropertyKind::ObjectProperty(property)
                            if property.key.static_name().is_some()
                    )
                })
            {
                return;
            }

            let mut background_property = None;
            let mut background_size_property = None;
            for property in &style.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return;
                };
                match property.key.static_name().as_deref() {
                    Some("background") => {
                        background_property = Some(property.as_ref());
                        background_size_property = Some(property.as_ref());
                    }
                    Some("backgroundImage") => background_property = Some(property.as_ref()),
                    Some("backgroundSize") => background_size_property = Some(property.as_ref()),
                    _ => {}
                }
            }

            if background_property.is_some() || background_size_property.is_some() {
                let background_value = background_property.and_then(static_string_property_value);
                let background_size_value =
                    background_size_property.and_then(static_string_property_value);
                if background_size_property.is_some()
                    && !same_style_property(background_size_property, background_property)
                    && background_size_value.is_none()
                {
                    return;
                }
                if !same_style_property(background_size_property, background_property) {
                    inline_background_size = background_size_value.filter(|value| !value.is_empty());
                }
                if background_value.is_some_and(|value| {
                    is_decorative_grid_value(
                        value,
                        background_size_value,
                        same_style_property(background_size_property, background_property),
                        background_size_property.is_some_and(|property| {
                            property.key.static_name().as_deref() == Some("background")
                        }),
                    )
                }) {
                    let span = background_property
                        .map_or(style_attribute.span, |property| property.span);
                    ctx.diagnostic(OxcDiagnostic::warn(STYLE_MESSAGE).with_label(span));
                    return;
                }
                if background_property.is_some() {
                    return;
                }
            }
        }

        if get_static_class_name(opening_element).is_some_and(|class_name| {
            is_decorative_tailwind_grid(class_name, inline_background_size)
        }) {
            ctx.diagnostic(OxcDiagnostic::warn(CLASS_MESSAGE).with_label(opening_element.span));
        }
    }
}

fn jsx_spread_may_provide_style(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    opening_element.attributes.iter().any(|attribute| {
        matches!(
            attribute,
            JSXAttributeItem::SpreadAttribute(spread)
                if can_expression_override_jsx_attribute(&spread.argument, "style", false)
        )
    })
}

fn same_style_property(
    left: Option<&oxc_ast::ast::ObjectProperty<'_>>,
    right: Option<&oxc_ast::ast::ObjectProperty<'_>>,
) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => std::ptr::eq(left, right),
        (None, None) => true,
        _ => false,
    }
}

fn static_string_property_value<'a>(
    property: &'a oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'a str> {
    let Expression::StringLiteral(value) = &property.value else {
        return None;
    };
    Some(value.value.as_str())
}

fn is_decorative_grid_value(
    background_value: &str,
    background_size_value: Option<&str>,
    should_use_background_shorthand_size: bool,
    is_background_size_shorthand: bool,
) -> bool {
    let hairline_axes = linear_gradient_bodies(background_value)
        .into_iter()
        .filter_map(hairline_gradient_axis)
        .collect::<Vec<_>>();
    if hairline_axes.is_empty() {
        return false;
    }
    let tile_dimension_count = usize::max(
        if should_use_background_shorthand_size {
            fixed_pixel_tile_dimension_count(background_value, true)
        } else {
            0
        },
        background_size_value.map_or(0, |value| {
            fixed_pixel_tile_dimension_count(value, is_background_size_shorthand)
        }),
    );
    if hairline_axes.len() >= DECORATIVE_GRID_MIN_GRADIENT_LAYERS {
        let has_horizontal = hairline_axes.contains(&"horizontal");
        let has_vertical = hairline_axes.contains(&"vertical");
        return has_horizontal && has_vertical && tile_dimension_count >= 1;
    }
    tile_dimension_count >= 2
}

fn linear_gradient_bodies(value: &str) -> Vec<&str> {
    let mut bodies = Vec::new();
    for (index, _) in value.char_indices() {
        let remainder = &value[index..];
        let Some(pattern_length) = linear_gradient_pattern_length(remainder) else {
            continue;
        };
        let prefix = &value[..index];
        if prefix.to_ascii_lowercase().ends_with("repeating-")
            || prefix
                .as_bytes()
                .last()
                .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        {
            continue;
        }
        let body_start = index + pattern_length;
        let mut parenthesis_depth = 1;
        for (relative_index, character) in value[body_start..].char_indices() {
            if character == '(' {
                parenthesis_depth += 1;
            }
            if character != ')' {
                continue;
            }
            parenthesis_depth -= 1;
            if parenthesis_depth == 0 {
                bodies.push(&value[body_start..body_start + relative_index]);
                break;
            }
        }
    }
    bodies
}

fn linear_gradient_pattern_length(value: &str) -> Option<usize> {
    [
        "-webkit-linear-gradient(",
        "-moz-linear-gradient(",
        "-ms-linear-gradient(",
        "-o-linear-gradient(",
        "linear-gradient(",
    ]
    .into_iter()
    .find(|pattern| {
        value
            .get(..pattern.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(pattern))
    })
    .map(str::len)
}

fn hairline_gradient_axis(body: &str) -> Option<&'static str> {
    let normalized = body
        .trim_matches(|character| is_js_whitespace(character))
        .to_ascii_lowercase();
    if !LEADING_HAIRLINE_PATTERN.is_match(&normalized)
        && !INVERTED_HAIRLINE_PATTERN.is_match(&normalized)
    {
        return None;
    }
    if VERTICAL_GRADIENT_DIRECTION_PATTERN.is_match(&normalized) {
        return Some("vertical");
    }
    if HORIZONTAL_GRADIENT_DIRECTION_PATTERN.is_match(&normalized) {
        return Some("horizontal");
    }
    if EXPLICIT_GRADIENT_DIRECTION_PATTERN.is_match(&normalized) {
        return None;
    }
    Some("horizontal")
}

fn fixed_pixel_tile_dimension_count(value: &str, is_shorthand: bool) -> usize {
    let Some(layers) = split_css_top_level(value, ',') else {
        return 0;
    };
    let mut maximum_dimension_count = 0;
    for layer in layers {
        let mut size_value = layer;
        if is_shorthand {
            let Some(parts) = split_css_top_level(layer, '/') else {
                continue;
            };
            if parts.len() != 2 || parts[1].is_empty() {
                continue;
            }
            size_value = parts[1];
        }
        let Some(captures) = FIXED_PIXEL_TILE_PATTERN.captures(size_value) else {
            continue;
        };
        let Some(first_dimension) = captures
            .get(1)
            .and_then(|capture| capture.as_str().parse::<f64>().ok())
        else {
            continue;
        };
        if first_dimension <= 0.0 {
            continue;
        }
        let second_dimension = captures
            .get(2)
            .and_then(|capture| capture.as_str().parse::<f64>().ok());
        if second_dimension.is_some_and(|dimension| dimension <= 0.0) {
            continue;
        }
        maximum_dimension_count = maximum_dimension_count.max(usize::from(second_dimension.is_some()) + 1);
    }
    maximum_dimension_count
}

enum EffectiveTailwindUtility<'a> {
    Ambiguous,
    Resolved(Option<&'a str>),
}

fn resolve_effective_decorative_grid_utility<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    predicate: impl Fn(&str) -> bool,
) -> EffectiveTailwindUtility<'a> {
    let has_important = tokens.iter().any(|token| {
        token.variants.is_empty() && token.is_important && predicate(token.utility)
    });
    let mut utility = None;
    for token in tokens {
        if !token.variants.is_empty()
            || has_important && !token.is_important
            || !predicate(token.utility)
        {
            continue;
        }
        if utility.is_some_and(|current| current != token.utility) {
            return EffectiveTailwindUtility::Ambiguous;
        }
        utility = Some(token.utility);
    }
    EffectiveTailwindUtility::Resolved(utility)
}

fn is_decorative_tailwind_grid(
    class_name: &str,
    background_size_override: Option<&str>,
) -> bool {
    let tokens = tailwind_class_name_tokens(class_name);
    let background = resolve_effective_decorative_grid_utility(&tokens, |utility| {
        is_tailwind_background_property(utility) || is_tailwind_background_image(utility)
    });
    let background_size = resolve_effective_decorative_grid_utility(&tokens, |utility| {
        is_tailwind_background_shorthand_property(utility)
            || is_tailwind_background_size_property(utility)
            || is_tailwind_background_size(utility)
    });
    let (
        EffectiveTailwindUtility::Resolved(background_utility),
        EffectiveTailwindUtility::Resolved(background_size_utility),
    ) = (background, background_size)
    else {
        return false;
    };
    let Some(background_utility) = background_utility else {
        return false;
    };
    let Some(background_value) = tailwind_background_value(background_utility) else {
        return false;
    };
    let has_explicit_background_size = background_size_override.is_some()
        || background_size_utility.is_some_and(|utility| {
            !is_tailwind_background_shorthand_property(utility)
        });
    let resolved_background_size = background_size_override
        .map(str::to_string)
        .or_else(|| background_size_utility.and_then(tailwind_background_size_value));
    is_decorative_grid_value(
        &background_value,
        resolved_background_size.as_deref(),
        !has_explicit_background_size,
        false,
    )
}

fn is_tailwind_background_property(utility: &str) -> bool {
    let Some((property, value)) = arbitrary_property_parts(utility) else {
        return false;
    };
    !value.is_empty()
        && matches!(
            property.to_ascii_lowercase().as_str(),
            "background" | "background-image"
        )
}

fn is_tailwind_background_shorthand_property(utility: &str) -> bool {
    arbitrary_property_parts(utility).is_some_and(|(property, value)| {
        property.eq_ignore_ascii_case("background") && !value.is_empty()
    })
}

fn is_tailwind_background_size_property(utility: &str) -> bool {
    arbitrary_property_parts(utility).is_some_and(|(property, value)| {
        property.eq_ignore_ascii_case("background-size") && !value.is_empty()
    })
}

fn is_tailwind_background_image(utility: &str) -> bool {
    let normalized = utility.to_ascii_lowercase();
    normalized == "bg-none"
        || ["bg-conic", "bg-linear", "bg-radial"].iter().any(|prefix| {
            normalized == *prefix || normalized.starts_with(&format!("{prefix}-"))
        })
        || normalized
            .strip_prefix("bg-[")
            .and_then(|value| value.strip_suffix(']'))
            .is_some_and(|value| !value.to_ascii_lowercase().starts_with("length:"))
}

fn is_tailwind_background_size(utility: &str) -> bool {
    let normalized = utility.to_ascii_lowercase();
    matches!(normalized.as_str(), "bg-auto" | "bg-contain" | "bg-cover")
        || normalized
            .strip_prefix("bg-[length:")
            .and_then(|value| value.strip_suffix(']'))
            .is_some_and(|value| !value.is_empty())
}

fn arbitrary_property_parts(utility: &str) -> Option<(&str, &str)> {
    let contents = utility.strip_prefix('[')?.strip_suffix(']')?;
    let (property, value) = contents.split_once(':')?;
    if property.is_empty() || property.contains([':', ']']) || value.is_empty() {
        return None;
    }
    Some((property, value))
}

fn tailwind_background_value(utility: &str) -> Option<String> {
    if let Some((property, value)) = arbitrary_property_parts(utility) {
        if matches!(
            property.to_ascii_lowercase().as_str(),
            "background" | "background-image"
        ) {
            return Some(normalize_tailwind_arbitrary_utility_value(value));
        }
    }
    let value = utility.strip_prefix("bg-[")?.strip_suffix(']')?;
    let value = value
        .strip_prefix("image:")
        .filter(|value| !value.is_empty())
        .unwrap_or(value);
    (!value.is_empty()).then(|| normalize_tailwind_arbitrary_utility_value(value))
}

fn tailwind_background_size_value(utility: &str) -> Option<String> {
    if let Some((property, value)) = arbitrary_property_parts(utility) {
        if property.eq_ignore_ascii_case("background-size") {
            return Some(normalize_tailwind_arbitrary_utility_value(value));
        }
    }
    let normalized = utility.to_ascii_lowercase();
    if let Some(value) = normalized
        .strip_prefix("bg-[length:")
        .and_then(|value| value.strip_suffix(']'))
    {
        return (!value.is_empty()).then(|| normalize_tailwind_arbitrary_utility_value(value));
    }
    matches!(normalized.as_str(), "bg-auto" | "bg-contain" | "bg-cover")
        .then(|| utility[3..].to_string())
}
