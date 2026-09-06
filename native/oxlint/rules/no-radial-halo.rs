use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};
use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, ObjectExpression, ObjectProperty, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

const MESSAGE: &str = "This saturated radial halo adds a generic glow to a dark surface. Replace it with a more specific visual treatment or simplify the background.";

#[derive(Debug, Default, Clone)]
pub struct NoRadialHalo;
declare_oxc_lint!(
    /// Disallow saturated radial halos on dark surfaces.
    NoRadialHalo,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow saturated radial halos on dark surfaces."
);

struct RadialHaloEvidence<'a> {
    style: Option<&'a ObjectExpression<'a>>,
    tokens: Vec<TailwindClassNameToken<'a>>,
}

struct RadialHaloStop {
    color: Rgb,
    alpha: f64,
    positions: Vec<String>,
}

impl Rule for NoRadialHalo {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening) = node.kind() else {
            return;
        };
        let oxc_ast::ast::JSXElementName::Identifier(name) = &opening.name else {
            return;
        };
        if !matches!(
            name.name.as_str(),
            "article" | "aside" | "div" | "header" | "main" | "section"
        ) || is_data_visualization_context(opening, node, ctx)
        {
            return;
        }
        let Some(evidence) = radial_halo_evidence(opening, ctx) else {
            return;
        };
        let Some((property, image)) = radial_halo_background_image(&evidence) else {
            return;
        };
        if !radial_halo_is_saturated(image.as_str()) {
            return;
        }
        let own_dark = radial_halo_has_dark_background(&evidence);
        let root_dark = radial_halo_root_opening(node, ctx)
            .filter(|root| root.span != opening.span)
            .and_then(|root| radial_halo_evidence(root, ctx))
            .is_some_and(|root| radial_halo_has_dark_background(&root));
        if !own_dark && !root_dark {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(MESSAGE).with_label(property.map_or(opening.span, GetSpan::span)),
        );
    }
}

fn radial_halo_evidence<'a>(
    opening: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<RadialHaloEvidence<'a>> {
    if !is_proven_intrinsic_jsx_element(opening, ctx) {
        return None;
    }
    let class_attribute = get_authoritative_jsx_attribute(opening, "className", true);
    if class_attribute.is_none() && radial_halo_spread_may_provide(opening, "className") {
        return None;
    }
    let class_name = if class_attribute.is_some() {
        get_static_class_name(opening)?
    } else {
        ""
    };
    let style_attribute = get_authoritative_jsx_attribute(opening, "style", true);
    if style_attribute.is_none() && radial_halo_spread_may_provide(opening, "style") {
        return None;
    }
    let style = if let Some(attribute) = style_attribute {
        let style = get_inline_style_object_expression_with_aliases(attribute, ctx)?;
        if style.properties.iter().any(|property| !matches!(property, ObjectPropertyKind::ObjectProperty(property) if property.key.static_name().is_some())) { return None; }
        Some(style)
    } else {
        None
    };
    let tokens = if !class_name.is_empty() && has_capability_or_unspecified(ctx, "tailwind") {
        tailwind_class_name_tokens(class_name)
    } else {
        Vec::new()
    };
    Some(RadialHaloEvidence { style, tokens })
}

fn radial_halo_spread_may_provide(
    opening: &oxc_ast::ast::JSXOpeningElement<'_>,
    attribute_name: &str,
) -> bool {
    opening.attributes.iter().any(|attribute| {
        matches!(attribute, JSXAttributeItem::SpreadAttribute(spread) if can_expression_override_jsx_attribute(&spread.argument, attribute_name, false))
    })
}

fn radial_halo_effective_property<'a>(
    style: Option<&'a ObjectExpression<'a>>,
    names: &[&str],
) -> Option<&'a ObjectProperty<'a>> {
    style?
        .properties
        .iter()
        .rev()
        .find_map(|property| match property {
            ObjectPropertyKind::ObjectProperty(property)
                if property.key.static_name().is_some_and(|name| {
                    names.iter().any(|candidate| *candidate == name.as_ref())
                }) =>
            {
                Some(property.as_ref())
            }
            _ => None,
        })
}

fn radial_halo_strip_prefix_case_insensitive<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    let candidate = value.get(..prefix.len())?;
    candidate
        .eq_ignore_ascii_case(prefix)
        .then(|| &value[prefix.len()..])
}

fn radial_halo_is_image_utility(utility: &str) -> bool {
    let value = utility.to_ascii_lowercase();
    value == "bg-none"
        || value
            .strip_prefix("bg-[")
            .and_then(|value| value.strip_suffix(']'))
            .is_some_and(|value| {
                let value = value.strip_prefix("image:").unwrap_or(value);
                [
                    "radial-gradient(",
                    "repeating-radial-gradient(",
                    "linear-gradient(",
                    "repeating-linear-gradient(",
                    "conic-gradient(",
                    "repeating-conic-gradient(",
                    "url(",
                ]
                .iter()
                .any(|prefix| value.starts_with(prefix))
            })
        || value
            .strip_prefix("[background:")
            .or_else(|| value.strip_prefix("[background-image:"))
            .and_then(|value| value.strip_suffix(']'))
            .is_some()
}

fn radial_halo_image_value(utility: &str) -> Option<String> {
    if utility.eq_ignore_ascii_case("bg-none") {
        return None;
    }
    let value = if let Some(value) = radial_halo_strip_prefix_case_insensitive(utility, "bg-[")
        .and_then(|value| value.strip_suffix(']'))
    {
        radial_halo_strip_prefix_case_insensitive(value, "image:").unwrap_or(value)
    } else {
        let content = utility.strip_prefix('[')?.strip_suffix(']')?;
        let (property, value) = content.split_once(':')?;
        if !matches!(
            property.to_ascii_lowercase().as_str(),
            "background" | "background-image"
        ) {
            return None;
        }
        value
    };
    Some(normalize_tailwind_arbitrary_utility_value(value))
}

fn radial_halo_background_image<'a>(
    evidence: &RadialHaloEvidence<'a>,
) -> Option<(Option<&'a ObjectProperty<'a>>, String)> {
    let tailwind = resolve_effective_tailwind_class_name_token(
        &evidence.tokens,
        radial_halo_is_image_utility,
        &[],
    );
    if tailwind.is_ambiguous {
        return None;
    }
    let inline = radial_halo_effective_property(evidence.style, &["background", "backgroundImage"]);
    let value = if inline.is_some() && !tailwind.is_important {
        get_object_property_string_value(inline?)?.to_string()
    } else {
        radial_halo_image_value(tailwind.utility?)?
    };
    Some((inline, value))
}

fn radial_halo_is_color_utility(utility: &str) -> bool {
    let value = utility.to_ascii_lowercase();
    if value.starts_with("[background:") || value.starts_with("[background-color:") {
        return true;
    }
    if let Some(value) = value
        .strip_prefix("bg-[")
        .and_then(|value| value.strip_suffix(']'))
    {
        return ![
            "image:",
            "radial-gradient(",
            "repeating-radial-gradient(",
            "linear-gradient(",
            "repeating-linear-gradient(",
            "conic-gradient(",
            "repeating-conic-gradient(",
            "url(",
        ]
        .iter()
        .any(|prefix| value.starts_with(prefix));
    }
    value.starts_with("bg-")
        && ![
            "bg-auto",
            "bg-bottom",
            "bg-center",
            "bg-clip-",
            "bg-contain",
            "bg-cover",
            "bg-fixed",
            "bg-left",
            "bg-local",
            "bg-no-repeat",
            "bg-none",
            "bg-origin-",
            "bg-repeat",
            "bg-right",
            "bg-scroll",
            "bg-top",
        ]
        .iter()
        .any(|prefix| value.starts_with(prefix))
}

fn radial_halo_color_value(utility: &str) -> Option<String> {
    let value = if let Some(value) = radial_halo_strip_prefix_case_insensitive(utility, "bg-[")
        .and_then(|value| value.strip_suffix(']'))
    {
        radial_halo_strip_prefix_case_insensitive(value, "color:").unwrap_or(value)
    } else {
        let content = utility.strip_prefix('[')?.strip_suffix(']')?;
        let (property, value) = content.split_once(':')?;
        if !matches!(
            property.to_ascii_lowercase().as_str(),
            "background" | "background-color"
        ) {
            return None;
        }
        value
    };
    Some(normalize_tailwind_arbitrary_utility_value(value))
}

fn radial_halo_has_dark_background(evidence: &RadialHaloEvidence<'_>) -> bool {
    let tailwind = resolve_effective_tailwind_class_name_token(
        &evidence.tokens,
        radial_halo_is_color_utility,
        &[],
    );
    if tailwind.is_ambiguous {
        return false;
    }
    let inline = radial_halo_effective_property(evidence.style, &["background", "backgroundColor"]);
    let value = if let Some(inline) = inline.filter(|_| !tailwind.is_important) {
        get_object_property_string_value(inline).map(str::to_string)
    } else {
        tailwind.utility.and_then(radial_halo_color_value)
    };
    let Some((color, alpha)) = value.as_deref().and_then(radial_halo_color) else {
        return false;
    };
    alpha >= 0.95 && color.red <= 35.0 && color.green <= 35.0 && color.blue <= 35.0
}

fn radial_halo_root_opening<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::JSXOpeningElement<'a>> {
    let mut root = None;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXElement(element) => root = Some(element.opening_element.as_ref()),
            AstKind::JSXFragment(_) => root = None,
            AstKind::JSXExpressionContainer(_) => return None,
            _ => {}
        }
    }
    root
}

fn radial_halo_color(value: &str) -> Option<(Rgb, f64)> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized == "transparent" {
        return Some((
            Rgb {
                red: 0.0,
                green: 0.0,
                blue: 0.0,
            },
            0.0,
        ));
    }
    let color = parse_color_to_rgb(&normalized)?;
    let alpha = if normalized.starts_with('#') && normalized.len() == 5 {
        u8::from_str_radix(&normalized[4..], 16).ok()? as f64 / 15.0
    } else if normalized.starts_with('#') && normalized.len() == 9 {
        u8::from_str_radix(&normalized[7..], 16).ok()? as f64 / 255.0
    } else if normalized.starts_with("rgb(")
        || normalized.starts_with("rgba(")
        || normalized.starts_with("hsl(")
        || normalized.starts_with("hsla(")
    {
        radial_halo_function_alpha(&normalized)?
    } else {
        1.0
    };
    (0.0..=1.0).contains(&alpha).then_some((color, alpha))
}

fn radial_halo_function_alpha(value: &str) -> Option<f64> {
    let contents = get_css_function_contents(value)?;
    let slash = split_css_top_level(contents, '/')?;
    if slash.len() > 2 {
        return None;
    }
    if slash.len() == 2 {
        return radial_halo_alpha(slash[1]);
    }
    let comma = split_css_top_level(contents, ',')?;
    if comma.len() == 4 {
        radial_halo_alpha(comma[3])
    } else {
        Some(1.0)
    }
}

fn radial_halo_alpha(value: &str) -> Option<f64> {
    let value = value.trim();
    let (number, percent) = value
        .strip_suffix('%')
        .map_or((value, false), |value| (value, true));
    if number.is_empty()
        || number.chars().any(|character| {
            !character.is_ascii_digit() && !matches!(character, '.' | '+' | '-' | 'e' | 'E')
        })
    {
        return None;
    }
    let alpha = number.parse::<f64>().ok()? / if percent { 100.0 } else { 1.0 };
    (alpha.is_finite() && (0.0..=1.0).contains(&alpha)).then_some(alpha)
}

fn radial_halo_stop(value: &str) -> Option<RadialHaloStop> {
    let trimmed = value.trim();
    let color_end = if ["rgb(", "rgba(", "hsl(", "hsla("]
        .iter()
        .any(|prefix| trimmed.to_ascii_lowercase().starts_with(prefix))
    {
        let mut depth = 0_i32;
        let mut end = None;
        for (index, character) in trimmed.char_indices() {
            if character == '(' {
                depth += 1;
            } else if character == ')' {
                depth -= 1;
                if depth == 0 {
                    end = Some(index + 1);
                    break;
                }
            }
        }
        end?
    } else {
        trimmed.find(char::is_whitespace).unwrap_or(trimmed.len())
    };
    let static_color = &trimmed[..color_end];
    if !static_color.eq_ignore_ascii_case("transparent")
        && !static_color.strip_prefix('#').is_some_and(|hex| {
            (3..=8).contains(&hex.len())
                && hex.chars().all(|character| character.is_ascii_hexdigit())
        })
        && !["rgb(", "rgba(", "hsl(", "hsla("]
            .iter()
            .any(|prefix| static_color.to_ascii_lowercase().starts_with(prefix))
    {
        return None;
    }
    let (color, alpha) = radial_halo_color(static_color)?;
    let positions = trimmed[color_end..]
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    if positions.len() > 2
        || positions
            .iter()
            .any(|position| !radial_halo_position(position))
    {
        return None;
    }
    Some(RadialHaloStop {
        color,
        alpha,
        positions,
    })
}

fn radial_halo_position(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    if normalized == "0" {
        return true;
    }
    let Some(number) = normalized
        .strip_suffix('%')
        .or_else(|| normalized.strip_suffix("px"))
        .or_else(|| normalized.strip_suffix("rem"))
    else {
        return false;
    };
    radial_halo_is_decimal(number)
}

fn radial_halo_is_decimal(value: &str) -> bool {
    let unsigned = value
        .strip_prefix('+')
        .or_else(|| value.strip_prefix('-'))
        .unwrap_or(value);
    let mut parts = unsigned.split('.');
    let whole = parts.next().unwrap_or_default();
    let fraction = parts.next();
    parts.next().is_none()
        && (!whole.is_empty() || fraction.is_some_and(|fraction| !fraction.is_empty()))
        && whole.chars().all(|character| character.is_ascii_digit())
        && fraction
            .is_none_or(|fraction| fraction.chars().all(|character| character.is_ascii_digit()))
}

fn radial_halo_has_prelude_marker(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    [
        "at",
        "circle",
        "closest-corner",
        "closest-side",
        "ellipse",
        "farthest-corner",
        "farthest-side",
    ]
    .iter()
    .any(|marker| {
        value.match_indices(*marker).any(|(index, marker)| {
            let before = value[..index].chars().next_back();
            let after = value[index + marker.len()..].chars().next();
            before.is_none_or(|character| !character.is_ascii_alphanumeric() && character != '_')
                && after
                    .is_none_or(|character| !character.is_ascii_alphanumeric() && character != '_')
        })
    })
}

fn radial_halo_is_saturated(value: &str) -> bool {
    let normalized = value.trim();
    if !normalized
        .get(.."radial-gradient(".len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("radial-gradient("))
    {
        return false;
    }
    let Some(contents) = get_css_function_contents(normalized) else {
        return false;
    };
    let Some(parts) = split_css_top_level(contents, ',') else {
        return false;
    };
    if parts.len() < 2 {
        return false;
    }
    let first = radial_halo_stop(parts[0]);
    let stops = if first.is_some() {
        parts
            .iter()
            .map(|part| radial_halo_stop(part))
            .collect::<Option<Vec<_>>>()
    } else if radial_halo_has_prelude_marker(parts[0]) {
        parts[1..]
            .iter()
            .map(|part| radial_halo_stop(part))
            .collect::<Option<Vec<_>>>()
    } else {
        None
    };
    let Some(stops) = stops.filter(|stops| stops.len() >= 2) else {
        return false;
    };
    let positions = stops
        .iter()
        .flat_map(|stop| &stop.positions)
        .collect::<Vec<_>>();
    if !positions.is_empty() {
        let mut maximum = 0.0_f64;
        let mut pixels_only = true;
        for position in positions {
            let numeric = position
                .trim_end_matches(|character: char| {
                    character.is_ascii_alphabetic() || character == '%'
                })
                .parse::<f64>();
            let Ok(numeric) = numeric else {
                pixels_only = false;
                break;
            };
            if numeric != 0.0 && !position.to_ascii_lowercase().ends_with("px") {
                pixels_only = false;
                break;
            }
            maximum = maximum.max(numeric.abs());
        }
        if pixels_only && maximum <= 24.0 {
            return false;
        }
    }
    let Some(final_stop) = stops.last() else {
        return false;
    };
    if final_stop.alpha > 0.05 {
        return false;
    }
    stops[..stops.len() - 1]
        .iter()
        .find(|stop| stop.alpha > 0.05)
        .is_some_and(|stop| stop.alpha >= 0.7 && has_color_chroma(stop.color))
}
