use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, ObjectExpression, ObjectProperty, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const COLOR_CHROMA_THRESHOLD: f64 = 30.0;
const MAX_VISIBLE_STOPS: usize = 2;
const MIN_HEIGHT_PX: f64 = 160.0;
const MIN_WIDTH_PX: f64 = 240.0;
const ROOT_FONT_SIZE_PX: f64 = 16.0;
const TRANSPARENT_ALPHA_MAX: f64 = 0.05;
const VISIBLE_ALPHA_MAX: f64 = 0.45;
const MESSAGE: &str = "This large translucent radial glow is generic decorative scaffolding. Replace it with a visual treatment tied to the product or simplify the surface.";
const SPOTLIGHT_SURFACE_ELEMENT_NAMES: [&str; 6] =
    ["article", "aside", "div", "header", "main", "section"];

static CSS_STATIC_LENGTH_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u)^(\d+(?:\.\d*)?|\.\d+)(px|rem)$");
static CSS_STATIC_ZERO_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u)^[+-]?(?:0+(?:\.0*)?|\.0+)(?:px|rem)?$");
static CSS_ALPHA_VALUE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u)^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$"
);
static CSS_STOP_POSITION_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u)^(?:0|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|px|rem))(?:\s+(?:0|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|px|rem)))?$"
);
static RADIAL_GRADIENT_PRELUDE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u)\b(?:at|circle|closest-corner|closest-side|ellipse|farthest-corner|farthest-side)\b"
);

#[derive(Debug, Default, Clone)]
pub struct NoDecorativeRadialSpotlight;

declare_oxc_lint!(
    /// Disallow large translucent decorative radial spotlights.
    NoDecorativeRadialSpotlight,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow large translucent decorative radial spotlights.",
);

impl Rule for NoDecorativeRadialSpotlight {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let oxc_ast::ast::JSXElementName::Identifier(element_name) = &opening_element.name else {
            return;
        };
        if !is_proven_intrinsic_jsx_element(opening_element, ctx)
            || !SPOTLIGHT_SURFACE_ELEMENT_NAMES.contains(&element_name.name.as_str())
            || is_data_visualization_context(opening_element, node, ctx)
        {
            return;
        }

        let class_name_attribute =
            get_authoritative_jsx_attribute(opening_element, "className", true);
        let style_attribute = get_authoritative_jsx_attribute(opening_element, "style", true);
        if class_name_attribute.is_none()
            && jsx_spread_may_provide_spotlight_attribute(opening_element, "className")
            || style_attribute.is_none()
                && jsx_spread_may_provide_spotlight_attribute(opening_element, "style")
        {
            return;
        }
        let class_name = if class_name_attribute.is_some() {
            let Some(class_name) = get_static_class_name(opening_element) else {
                return;
            };
            class_name
        } else {
            ""
        };
        let style = if let Some(style_attribute) = style_attribute {
            let Some(style) =
                get_inline_style_object_expression_with_aliases(style_attribute, ctx)
            else {
                return;
            };
            if style.properties.iter().any(|property| {
                !matches!(
                    property,
                    ObjectPropertyKind::ObjectProperty(property)
                        if property.key.static_name().is_some()
                )
            }) {
                return;
            }
            Some(style)
        } else {
            None
        };

        let tokens = if !class_name.is_empty() && has_capability_or_unspecified(ctx, "tailwind") {
            tailwind_class_name_tokens(class_name)
        } else {
            Vec::new()
        };
        let tailwind_background = resolve_static_tailwind_background_image(&tokens);
        let TailwindResolution::Resolved {
            utility: tailwind_background_utility,
            is_important: tailwind_background_is_important,
        } = tailwind_background
        else {
            return;
        };
        let tailwind_background_value =
            tailwind_background_utility.and_then(static_tailwind_background_image_value);
        let inline_background_property = effective_style_property_among(
            style,
            &["background", "backgroundImage"],
        );
        let inline_background_value =
            inline_background_property.and_then(static_spotlight_style_string_value);
        let background_value = if inline_background_property.is_some()
            && !tailwind_background_is_important
        {
            inline_background_value.map(str::to_string)
        } else {
            tailwind_background_value
        };
        if background_value
            .as_deref()
            .is_none_or(|value| !has_decorative_radial_spotlight_gradient(value))
        {
            return;
        }

        let tailwind_surface = tailwind_surface_evidence(&tokens);
        if tailwind_surface.width_is_ambiguous || tailwind_surface.height_is_ambiguous {
            return;
        }
        let inline_width_property = effective_style_property(style, "width");
        let inline_height_property = effective_style_property(style, "height");
        let inline_width_px = inline_width_property.and_then(parse_static_style_length_px);
        let inline_height_px = inline_height_property.and_then(parse_static_style_length_px);
        let width_px = if tailwind_surface.width_is_important {
            tailwind_surface.width_px
        } else if inline_width_property.is_some() {
            inline_width_px
        } else {
            tailwind_surface.width_px
        };
        let height_px = if tailwind_surface.height_is_important {
            tailwind_surface.height_px
        } else if inline_height_property.is_some() {
            inline_height_px
        } else {
            tailwind_surface.height_px
        };
        let has_width = if tailwind_surface.width_is_important {
            tailwind_surface.has_width
        } else {
            inline_width_property.is_some() || tailwind_surface.has_width
        };
        let has_height = if tailwind_surface.height_is_important {
            tailwind_surface.has_height
        } else {
            inline_height_property.is_some() || tailwind_surface.has_height
        };
        let position_property = effective_style_property(style, "position");
        let position_is_fixed = if tailwind_surface.position_is_ambiguous {
            None
        } else if tailwind_surface.position_is_important {
            tailwind_surface.position_is_fixed
        } else if let Some(position_property) = position_property {
            static_spotlight_style_string_value(position_property)
                .map(|position| position.eq_ignore_ascii_case("fixed"))
        } else {
            tailwind_surface.position_is_fixed
        };
        let inset_edges_are_zero = [
            effective_inset_edge_is_zero(
                style,
                &["inset", "top"],
                tailwind_surface.inset_top,
            ),
            effective_inset_edge_is_zero(
                style,
                &["inset", "right"],
                tailwind_surface.inset_right,
            ),
            effective_inset_edge_is_zero(
                style,
                &["bottom", "inset"],
                tailwind_surface.inset_bottom,
            ),
            effective_inset_edge_is_zero(
                style,
                &["inset", "left"],
                tailwind_surface.inset_left,
            ),
        ]
        .into_iter()
        .all(|is_zero| is_zero == Some(true));
        let is_fixed_viewport =
            !has_width && !has_height && position_is_fixed == Some(true) && inset_edges_are_zero;
        let is_large_surface = is_fixed_viewport
            || width_px.is_some_and(|width| width >= MIN_WIDTH_PX)
                && height_px.is_some_and(|height| height >= MIN_HEIGHT_PX);
        if !is_large_surface {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(MESSAGE)
                .with_label(inline_background_property.map_or(opening_element.span, GetSpan::span)),
        );
    }
}

#[derive(Clone, Copy)]
enum TailwindResolution<'a> {
    Ambiguous,
    Resolved {
        utility: Option<&'a str>,
        is_important: bool,
    },
}

fn resolve_spotlight_tailwind_utility<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    predicate: impl Fn(&str) -> bool,
) -> TailwindResolution<'a> {
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
            return TailwindResolution::Ambiguous;
        }
        utility = Some(token.utility);
    }
    TailwindResolution::Resolved {
        utility,
        is_important: has_important,
    }
}

fn resolve_static_tailwind_background_image<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
) -> TailwindResolution<'a> {
    resolve_spotlight_tailwind_utility(tokens, is_static_tailwind_background_image_utility)
}

fn is_static_tailwind_background_image_utility(utility: &str) -> bool {
    let normalized = utility.to_ascii_lowercase();
    if normalized == "bg-none" {
        return true;
    }
    if let Some(value) = normalized
        .strip_prefix("bg-[")
        .and_then(|value| value.strip_suffix(']'))
    {
        if value.strip_prefix("image:").is_some_and(|value| !value.is_empty()) {
            return true;
        }
        return [
            "radial-gradient(",
            "repeating-radial-gradient(",
            "linear-gradient(",
            "repeating-linear-gradient(",
            "conic-gradient(",
            "repeating-conic-gradient(",
            "url(",
        ]
        .iter()
        .any(|prefix| value.starts_with(prefix) && value.ends_with(')') && value.len() > prefix.len());
    }
    normalized
        .strip_prefix("[background:")
        .or_else(|| normalized.strip_prefix("[background-image:"))
        .and_then(|value| value.strip_suffix(']'))
        .is_some_and(|value| !value.is_empty())
}

fn static_tailwind_background_image_value(utility: &str) -> Option<String> {
    if utility == "bg-none" {
        return None;
    }
    let arbitrary_value = if let Some(value) = utility
        .strip_prefix("bg-[")
        .and_then(|value| value.strip_suffix(']'))
    {
        value.get("image:".len()..).filter(|_| {
            value
                .get(.."image:".len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("image:"))
        }).unwrap_or(value)
    } else {
        let contents = utility.strip_prefix('[')?.strip_suffix(']')?;
        let (property, value) = contents.split_once(':')?;
        if !matches!(
            property.to_ascii_lowercase().as_str(),
            "background" | "background-image"
        ) {
            return None;
        }
        value
    };
    (!arbitrary_value.is_empty())
        .then(|| normalize_tailwind_arbitrary_utility_value(arbitrary_value))
}

#[derive(Clone, Copy)]
enum TailwindZeroValueEvidence {
    Ambiguous,
    Resolved {
        is_important: bool,
        is_zero: Option<bool>,
    },
}

struct TailwindSurfaceEvidence {
    height_px: Option<f64>,
    height_is_ambiguous: bool,
    height_is_important: bool,
    has_height: bool,
    has_width: bool,
    inset_bottom: TailwindZeroValueEvidence,
    inset_left: TailwindZeroValueEvidence,
    inset_right: TailwindZeroValueEvidence,
    inset_top: TailwindZeroValueEvidence,
    position_is_ambiguous: bool,
    position_is_fixed: Option<bool>,
    position_is_important: bool,
    width_px: Option<f64>,
    width_is_ambiguous: bool,
    width_is_important: bool,
}

fn tailwind_surface_evidence<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
) -> TailwindSurfaceEvidence {
    let width_resolution = resolve_spotlight_tailwind_utility(tokens, |utility| {
        utility.starts_with("size-") || utility.starts_with("w-")
    });
    let height_resolution = resolve_spotlight_tailwind_utility(tokens, |utility| {
        utility.starts_with("h-") || utility.starts_with("size-")
    });
    let position_resolution = resolve_spotlight_tailwind_utility(tokens, |utility| {
        matches!(utility, "absolute" | "fixed" | "relative" | "static" | "sticky")
    });
    let (width_utility, width_is_important, width_is_ambiguous) =
        spotlight_resolution_parts(width_resolution);
    let (height_utility, height_is_important, height_is_ambiguous) =
        spotlight_resolution_parts(height_resolution);
    let (position_utility, position_is_important, position_is_ambiguous) =
        spotlight_resolution_parts(position_resolution);
    TailwindSurfaceEvidence {
        height_px: height_utility.and_then(|utility| {
            parse_static_tailwind_length_px(utility, "size")
                .or_else(|| parse_static_tailwind_length_px(utility, "h"))
        }),
        height_is_ambiguous,
        height_is_important,
        has_height: height_utility.is_some() || height_is_ambiguous,
        has_width: width_utility.is_some() || width_is_ambiguous,
        inset_bottom: tailwind_inset_edge_evidence(tokens, "bottom"),
        inset_left: tailwind_inset_edge_evidence(tokens, "left"),
        inset_right: tailwind_inset_edge_evidence(tokens, "right"),
        inset_top: tailwind_inset_edge_evidence(tokens, "top"),
        position_is_ambiguous,
        position_is_fixed: (!position_is_ambiguous)
            .then(|| position_utility.map(|utility| utility == "fixed"))
            .flatten(),
        position_is_important,
        width_px: width_utility.and_then(|utility| {
            parse_static_tailwind_length_px(utility, "size")
                .or_else(|| parse_static_tailwind_length_px(utility, "w"))
        }),
        width_is_ambiguous,
        width_is_important,
    }
}

fn spotlight_resolution_parts(
    resolution: TailwindResolution<'_>,
) -> (Option<&str>, bool, bool) {
    match resolution {
        TailwindResolution::Ambiguous => (None, false, true),
        TailwindResolution::Resolved {
            utility,
            is_important,
        } => (utility, is_important, false),
    }
}

fn tailwind_inset_edge_evidence<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    edge: &str,
) -> TailwindZeroValueEvidence {
    let axis = if matches!(edge, "top" | "bottom") {
        "y"
    } else {
        "x"
    };
    let resolution = resolve_spotlight_tailwind_utility(tokens, |utility| {
        let unsigned_utility = utility.strip_prefix('-').unwrap_or(utility);
        unsigned_utility.starts_with("inset-")
            && !unsigned_utility.starts_with("inset-x-")
            && !unsigned_utility.starts_with("inset-y-")
            || unsigned_utility.starts_with(&format!("inset-{axis}-"))
            || unsigned_utility.starts_with(&format!("{edge}-"))
            || matches!(edge, "left" | "right")
                && (unsigned_utility.starts_with("start-")
                    || unsigned_utility.starts_with("end-"))
    });
    let TailwindResolution::Resolved {
        utility,
        is_important,
    } = resolution
    else {
        return TailwindZeroValueEvidence::Ambiguous;
    };
    let Some(utility) = utility else {
        return TailwindZeroValueEvidence::Resolved {
            is_important,
            is_zero: None,
        };
    };
    let unsigned_utility = utility.strip_prefix('-').unwrap_or(utility);
    let is_logical_inset =
        unsigned_utility.starts_with("start-") || unsigned_utility.starts_with("end-");
    let utility_prefix = utility.rfind('-').map(|index| &utility[..index]);
    TailwindZeroValueEvidence::Resolved {
        is_important,
        is_zero: Some(
            !is_logical_inset
                && utility_prefix
                    .and_then(|prefix| parse_static_tailwind_length_px(utility, prefix))
                    == Some(0.0),
        ),
    }
}

fn effective_inset_edge_is_zero<'a>(
    style: Option<&'a ObjectExpression<'a>>,
    property_names: &[&str],
    tailwind_evidence: TailwindZeroValueEvidence,
) -> Option<bool> {
    let TailwindZeroValueEvidence::Resolved {
        is_important,
        is_zero,
    } = tailwind_evidence
    else {
        return None;
    };
    let inline_property = effective_style_property_among(style, property_names);
    if is_important {
        return is_zero;
    }
    inline_property
        .map(parse_static_style_zero)
        .unwrap_or(is_zero)
}

fn effective_style_property<'a>(
    style: Option<&'a ObjectExpression<'a>>,
    property_name: &str,
) -> Option<&'a ObjectProperty<'a>> {
    effective_style_property_among(style, &[property_name])
}

fn effective_style_property_among<'a>(
    style: Option<&'a ObjectExpression<'a>>,
    property_names: &[&str],
) -> Option<&'a ObjectProperty<'a>> {
    style?.properties.iter().rev().find_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        property
            .key
            .static_name()
            .is_some_and(|name| property_names.contains(&name.as_ref()))
            .then_some(property.as_ref())
    })
}

fn static_spotlight_style_string_value<'a>(property: &'a ObjectProperty<'a>) -> Option<&'a str> {
    let Expression::StringLiteral(string_literal) = &property.value else {
        return None;
    };
    Some(string_literal.value.as_str())
}

fn parse_static_style_length_px(property: &ObjectProperty<'_>) -> Option<f64> {
    if let Some(value) = get_static_style_property_number_value(property) {
        return (value.is_finite() && value >= 0.0).then_some(value);
    }
    let value = static_spotlight_style_string_value(property)?;
    let captures = CSS_STATIC_LENGTH_PATTERN
        .captures(value.trim_matches(|character| is_js_whitespace(character)))?;
    let number = captures.get(1)?.as_str().parse::<f64>().ok()?;
    Some(if captures.get(2)?.as_str().eq_ignore_ascii_case("rem") {
        number * ROOT_FONT_SIZE_PX
    } else {
        number
    })
}

fn parse_static_style_zero(property: &ObjectProperty<'_>) -> Option<bool> {
    if let Some(value) = get_static_style_property_number_value(property) {
        return value.is_finite().then_some(value == 0.0);
    }
    static_spotlight_style_string_value(property).map(|value| {
        CSS_STATIC_ZERO_PATTERN
            .is_match(value.trim_matches(|character| is_js_whitespace(character)))
    })
}

#[derive(Clone, Copy)]
struct StaticCssColorWithAlpha {
    alpha: f64,
    blue: f64,
    green: f64,
    red: f64,
}

fn has_decorative_radial_spotlight_gradient(background_value: &str) -> bool {
    let Some(stops) = parse_static_radial_gradient(background_value) else {
        return false;
    };
    let Some(final_stop) = stops.last() else {
        return false;
    };
    if final_stop.alpha > TRANSPARENT_ALPHA_MAX {
        return false;
    }
    let visible_stops = stops[..stops.len() - 1]
        .iter()
        .filter(|stop| stop.alpha > TRANSPARENT_ALPHA_MAX)
        .copied()
        .collect::<Vec<_>>();
    if visible_stops.is_empty()
        || visible_stops.len() > MAX_VISIBLE_STOPS
        || visible_stops
            .iter()
            .any(|stop| stop.alpha >= VISIBLE_ALPHA_MAX || !spotlight_color_has_chroma(*stop))
    {
        return false;
    }
    let first = visible_stops[0];
    visible_stops.iter().all(|stop| {
        stop.red == first.red && stop.green == first.green && stop.blue == first.blue
    })
}

fn parse_static_radial_gradient(value: &str) -> Option<Vec<StaticCssColorWithAlpha>> {
    let normalized = value.trim_matches(|character| is_js_whitespace(character));
    if !normalized
        .get(.."radial-gradient(".len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("radial-gradient("))
    {
        return None;
    }
    let contents = get_css_function_contents(normalized)?;
    let parts = split_css_top_level(contents, ',')?;
    if parts.len() < 2 {
        return None;
    }
    let first_stop = parse_static_css_gradient_stop(parts[0]);
    if first_stop.is_none() && !RADIAL_GRADIENT_PRELUDE_PATTERN.is_match(parts[0]) {
        return None;
    }
    let stop_parts = if first_stop.is_some() {
        parts.as_slice()
    } else {
        &parts[1..]
    };
    if stop_parts.len() < 2 {
        return None;
    }
    stop_parts
        .iter()
        .map(|stop| parse_static_css_gradient_stop(stop))
        .collect()
}

fn parse_static_css_gradient_stop(stop: &str) -> Option<StaticCssColorWithAlpha> {
    let trimmed = stop.trim_matches(|character| is_js_whitespace(character));
    let normalized = trimmed.to_ascii_lowercase();
    if ["rgb(", "rgba(", "hsl(", "hsla("]
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
    {
        let opening = trimmed.find('(')?;
        let mut depth = 0_i32;
        for (index, character) in trimmed.char_indices().skip_while(|(index, _)| *index < opening) {
            if character == '(' {
                depth += 1;
            }
            if character == ')' {
                depth -= 1;
            }
            if depth != 0 {
                continue;
            }
            let color_value = &trimmed[..index + character.len_utf8()];
            let position_value = trimmed[index + character.len_utf8()..]
                .trim_matches(|character| is_js_whitespace(character));
            if !position_value.is_empty() && !CSS_STOP_POSITION_PATTERN.is_match(position_value) {
                return None;
            }
            return parse_static_css_color_with_alpha(color_value);
        }
        return None;
    }
    let color_end = trimmed
        .find(|character| is_js_whitespace(character))
        .unwrap_or(trimmed.len());
    let color_value = &trimmed[..color_end];
    let normalized_color = color_value.to_ascii_lowercase();
    if normalized_color != "transparent"
        && !(normalized_color.starts_with('#')
            && (3..=8).contains(&normalized_color.len().saturating_sub(1))
            && normalized_color[1..].chars().all(|character| character.is_ascii_hexdigit()))
    {
        return None;
    }
    let position_value = trimmed[color_end..]
        .trim_matches(|character| is_js_whitespace(character));
    if !position_value.is_empty() && !CSS_STOP_POSITION_PATTERN.is_match(position_value) {
        return None;
    }
    parse_static_css_color_with_alpha(color_value)
}

fn parse_static_css_color_with_alpha(value: &str) -> Option<StaticCssColorWithAlpha> {
    let normalized = value
        .trim_matches(|character| is_js_whitespace(character))
        .to_ascii_lowercase();
    if normalized == "transparent" {
        return Some(StaticCssColorWithAlpha {
            alpha: 0.0,
            blue: 0.0,
            green: 0.0,
            red: 0.0,
        });
    }
    let color = parse_color_to_rgb(&normalized)?;
    let alpha = if normalized.starts_with('#') && normalized.len() == 5 {
        u8::from_str_radix(&normalized[4..], 16).ok()? as f64 / 15.0
    } else if normalized.starts_with('#') && normalized.len() == 9 {
        u8::from_str_radix(&normalized[7..], 16).ok()? as f64 / 255.0
    } else if ["rgb(", "rgba(", "hsl(", "hsla("]
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
    {
        parse_functional_color_alpha(&normalized)?
    } else {
        1.0
    };
    Some(StaticCssColorWithAlpha {
        alpha,
        blue: color.blue,
        green: color.green,
        red: color.red,
    })
}

fn parse_functional_color_alpha(value: &str) -> Option<f64> {
    let contents = get_css_function_contents(value)?;
    let slash_parts = split_css_top_level(contents, '/')?;
    if slash_parts.len() > 2 {
        return None;
    }
    if slash_parts.len() == 2 {
        return parse_css_alpha(slash_parts[1]);
    }
    let comma_parts = split_css_top_level(contents, ',')?;
    if comma_parts.len() == 4 {
        parse_css_alpha(comma_parts[3])
    } else {
        Some(1.0)
    }
}

fn parse_css_alpha(value: &str) -> Option<f64> {
    let trimmed = value.trim_matches(|character| is_js_whitespace(character));
    if !CSS_ALPHA_VALUE_PATTERN.is_match(trimmed) {
        return None;
    }
    let (number, is_percent) = trimmed
        .strip_suffix('%')
        .map_or((trimmed, false), |number| (number, true));
    let value = number.parse::<f64>().ok()?;
    let alpha = if is_percent { value / 100.0 } else { value };
    (alpha.is_finite() && (0.0..=1.0).contains(&alpha)).then_some(alpha)
}

fn spotlight_color_has_chroma(color: StaticCssColorWithAlpha) -> bool {
    color.red.max(color.green).max(color.blue) - color.red.min(color.green).min(color.blue)
        >= COLOR_CHROMA_THRESHOLD
}

fn jsx_spread_may_provide_spotlight_attribute(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    attribute_name: &str,
) -> bool {
    opening_element.attributes.iter().any(|attribute| {
        matches!(
            attribute,
            JSXAttributeItem::SpreadAttribute(spread)
                if can_expression_override_jsx_attribute(
                    &spread.argument,
                    attribute_name,
                    false,
                )
        )
    })
}
