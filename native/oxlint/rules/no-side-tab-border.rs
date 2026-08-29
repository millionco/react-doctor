use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{
        JSXAttribute, JSXAttributeItem, JSXAttributeValue, JSXChild, JSXExpression,
        ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const NO_SIDE_TAB_BORDER_WIDTH_WITHOUT_RADIUS_PX: f64 = 3.0;
const NO_SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX: f64 = 1.0;
const NO_SIDE_TAB_TAILWIND_WIDTH_WITHOUT_RADIUS: f64 = 4.0;
const NO_SIDE_TAB_INSET_MIN_WIDTH_PX: f64 = 3.0;
const NO_SIDE_TAB_INSET_MAX_WIDTH_PX: f64 = 12.0;
const NO_SIDE_TAB_PSEUDO_MAX_EDGE_INSET_PX: f64 = 20.0;
const NO_SIDE_TAB_GLYPH_MAX_SIZE_PX: f64 = 40.0;
const NO_SIDE_TAB_SHORT_LABEL_MAX_CHARACTERS: usize = 32;

static NO_SIDE_TAB_SHADOW_LENGTH_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u)^-?(?:\d+(?:\.\d+)?|\.\d+)(px)?$");
static NO_SIDE_TAB_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|[-_:])(?:badge|callout|label|menu-item|nav-item|section-label|side-?tab|tab)(?:$|[-_:])"
);
static NO_SIDE_TAB_ART_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|[-_:])(?:avatar|brand-mark|glyph|icon|logo|logo-mark|mark)(?:$|[-_:])");
static NO_SIDE_TAB_INTERACTION_VARIANT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:hover|focus|active|checked|target|selection|aria-(?:current|selected)|data-(?:active|current|selected))"
);
static NO_SIDE_TAB_SELECTED_CLASS_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|[-_:])(?:active|current|selected)(?:$|[-_:])");
static NO_SIDE_TAB_SAFE_ELEMENT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|\.)(?:blockquote|code|hr|pre|table|tbody|td|tfoot|th|thead|tr)$");
static NO_SIDE_TAB_NAMED_BORDER_COLOR_PATTERN: Lazy<Regex> = lazy_regex!(
    r"^border(?:-([lrsetb]))?-((?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+|white|black|transparent)(?:/.+)?$"
);
static NO_SIDE_TAB_ARBITRARY_BORDER_COLOR_PATTERN: Lazy<Regex> =
    lazy_regex!(r"^border(?:-([lrsetb]))?-\[([^\]]+)\](?:/.+)?$");
static NO_SIDE_TAB_SIDE_BORDER_WIDTH_PATTERN: Lazy<Regex> =
    lazy_regex!(r"^border-([lrsetb])-(\d+)$");
static NO_SIDE_TAB_INLINE_BORDER_WIDTH_PATTERN: Lazy<Regex> = lazy_regex!(r"^(\d+)px\s+solid");
static NO_SIDE_TAB_INLINE_BORDER_COLOR_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)solid\s+(.+)$");

#[derive(Clone, Copy)]
struct NoSideTabInsetShadow {
    edge_label: &'static str,
    width_px: f64,
}

#[derive(Clone, Copy)]
struct NoSideTabTailwindInsetShadow {
    is_important: bool,
    shadow: NoSideTabInsetShadow,
}

struct NoSideTabPseudoStripe {
    edge_label: &'static str,
    pseudo_element_name: &'static str,
    width_px: f64,
}

#[derive(Clone, Copy)]
struct NoSideTabOffsetResolution {
    is_ambiguous: bool,
    value_px: Option<f64>,
}

#[derive(Debug, Default, Clone)]
pub struct NoSideTabBorder;

declare_oxc_lint!(
    /// Disallow thick chromatic stripes on one side of a surface.
    NoSideTabBorder,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow thick chromatic stripes on one side of a surface.",
);

impl Rule for NoSideTabBorder {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => {
                no_side_tab_check_inline_style(attribute, node, ctx)
            }
            AstKind::JSXOpeningElement(opening_element) => {
                no_side_tab_check_tailwind(opening_element, node, ctx)
            }
            _ => {}
        }
    }
}

fn no_side_tab_check_inline_style<'a>(
    attribute: &'a JSXAttribute<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) {
    let Some(style_object) = get_inline_style_object_expression(attribute) else {
        return;
    };
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::JSXOpeningElement(opening_element) = parent.kind() else {
        return;
    };
    let class_name = get_static_class_name(opening_element);
    if class_name.is_some_and(no_side_tab_has_spinner_class) {
        return;
    }
    let class_tokens = class_name
        .map(tailwind_class_name_tokens)
        .unwrap_or_default();

    if let Some(shadow_property) = get_effective_static_style_property(style_object, "boxShadow")
        && let Some(shadow_value) = get_object_property_string_value(shadow_property)
        && let Some(shadow) = no_side_tab_parse_inset_shadow(shadow_value)
        && !(has_capability_or_unspecified(ctx, "tailwind")
            && class_tokens.iter().any(|token| {
                token.variants.is_empty()
                    && token.is_important
                    && no_side_tab_is_shadow_geometry_utility(token.utility)
            }))
        && !no_side_tab_is_interactive_or_selected(opening_element, ctx)
    {
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users see an off, dated inset stripe on one side ({}: {}px), so use a subtler surface treatment or drop it.",
                shadow.edge_label, shadow.width_px
            ))
            .with_label(shadow_property.span),
        );
    }

    let has_border_radius = get_effective_static_style_property(style_object, "borderRadius")
        .is_some_and(|property| {
            get_static_style_property_number_value(property).is_some_and(|value| value > 0.0)
                || get_object_property_string_value(property)
                    .and_then(no_side_tab_parse_javascript_float_prefix)
                    .is_some_and(|value| value > 0.0)
        });
    let animation_value = get_effective_static_style_property(style_object, "animation")
        .and_then(get_object_property_string_value)
        .unwrap_or("");
    let animation_name_value = get_effective_static_style_property(style_object, "animationName")
        .and_then(get_object_property_string_value)
        .unwrap_or("");
    if has_border_radius
        && format!("{animation_value} {animation_name_value}")
            .to_ascii_lowercase()
            .contains("spin")
    {
        return;
    }
    let threshold = if has_border_radius {
        NO_SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX
    } else {
        NO_SIDE_TAB_BORDER_WIDTH_WITHOUT_RADIUS_PX
    };

    for (property_name, side_label, side_letter) in [
        ("borderLeft", "left", "l"),
        ("borderRight", "right", "r"),
        ("borderTop", "top", "t"),
        ("borderBottom", "bottom", "b"),
        ("borderInlineStart", "left", "s"),
        ("borderInlineEnd", "right", "e"),
    ] {
        if matches!(side_label, "top" | "bottom") && !has_border_radius {
            continue;
        }
        let Some(property) = get_effective_static_style_property(style_object, property_name)
        else {
            continue;
        };
        let Some(value) = get_object_property_string_value(property) else {
            continue;
        };
        let Some((width, border_color)) = no_side_tab_parse_border_shorthand(value) else {
            continue;
        };
        if border_color.is_some_and(no_side_tab_is_neutral_color) {
            continue;
        }
        let width_resolution = no_side_tab_side_width_resolution(&class_tokens, side_letter);
        if width_resolution.is_important || width_resolution.is_ambiguous || width < threshold {
            continue;
        }
        let formatted_width = format_javascript_number(width);
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users see an off, dated thick border on one side ({side_label}: {formatted_width}px), so use a softer accent or drop it."
            ))
            .with_label(property.span),
        );
    }

    for (property_name, color_name, side_letter, is_horizontal) in [
        ("borderLeftWidth", "borderLeftColor", "l", false),
        ("borderRightWidth", "borderRightColor", "r", false),
        ("borderTopWidth", "borderTopColor", "t", true),
        ("borderBottomWidth", "borderBottomColor", "b", true),
        (
            "borderInlineStartWidth",
            "borderInlineStartColor",
            "s",
            false,
        ),
        ("borderInlineEndWidth", "borderInlineEndColor", "e", false),
    ] {
        if is_horizontal && !has_border_radius {
            continue;
        }
        let Some(property) = get_effective_static_style_property(style_object, property_name)
        else {
            continue;
        };
        let width = get_static_style_property_number_value(property).or_else(|| {
            get_object_property_string_value(property)
                .and_then(no_side_tab_parse_javascript_float_prefix)
        });
        let color = get_effective_static_style_property(style_object, color_name)
            .and_then(get_object_property_string_value);
        let width_resolution = no_side_tab_side_width_resolution(&class_tokens, side_letter);
        if width.is_none_or(|width| width < threshold)
            || color.is_none_or(no_side_tab_is_neutral_color)
            || width_resolution.is_important
            || width_resolution.is_ambiguous
        {
            continue;
        }
        let formatted_width = format_javascript_number(width.expect("checked above"));
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users see an off, dated thick border on one side ({formatted_width}px), so use a softer accent or drop it."
            ))
            .with_label(property.span),
        );
    }
}

fn no_side_tab_check_tailwind<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) {
    if !has_capability_or_unspecified(ctx, "tailwind") {
        return;
    }
    let Some(class_name) = get_static_class_name(opening_element) else {
        return;
    };
    if no_side_tab_has_spinner_class(class_name) {
        return;
    }
    let tokens = tailwind_class_name_tokens(class_name);
    let element = match ctx.nodes().parent_node(node.id()).kind() {
        AstKind::JSXElement(element) => Some(element),
        _ => None,
    };
    if let Some(inset_shadow) = no_side_tab_get_tailwind_inset_shadow(&tokens)
        && !no_side_tab_is_interactive_or_selected(opening_element, ctx)
    {
        let inline_shadow_override = get_authoritative_jsx_attribute(opening_element, "style", true)
            .is_some_and(|style_attribute| {
                let Some(style_object) = get_inline_style_object_expression(style_attribute) else {
                    return true;
                };
                style_object.properties.iter().any(|property| {
                    !matches!(property, ObjectPropertyKind::ObjectProperty(property) if property.key.static_name().is_some())
                }) || get_effective_static_style_property(style_object, "boxShadow").is_some()
            });
        if inset_shadow.is_important || !inline_shadow_override {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users see an off, dated inset stripe on one side ({}: {}px), so use a subtler surface treatment or drop it.",
                    inset_shadow.shadow.edge_label, inset_shadow.shadow.width_px
                ))
                .with_label(opening_element.span),
            );
        }
    }

    let element_type = resolve_jsx_element_type_name(opening_element, ctx);
    if let Some(pseudo_stripe) = no_side_tab_get_pseudo_stripe(&tokens)
        && !NO_SIDE_TAB_SAFE_ELEMENT_PATTERN.is_match(&element_type)
        && !no_side_tab_has_actual_selected_state(opening_element)
        && !tokens.iter().any(|token| {
            token.variants.is_empty() && NO_SIDE_TAB_SELECTED_CLASS_PATTERN.is_match(token.utility)
        })
        && no_side_tab_has_label_context(element, class_name)
        && no_side_tab_has_positioning_context(&tokens)
        && !no_side_tab_is_glyph_or_logo_context(opening_element, element, &tokens, ctx)
        && !(matches!(pseudo_stripe.edge_label, "top" | "bottom")
            && no_side_tab_is_horizontal_underline_host(opening_element, ctx))
    {
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users see an off, dated {}px {} stripe on the {} edge, so use a subtler surface treatment or drop it.",
                pseudo_stripe.width_px,
                pseudo_stripe.pseudo_element_name,
                pseudo_stripe.edge_label
            ))
            .with_label(opening_element.span),
        );
    }

    let has_base_rounding = tokens
        .iter()
        .any(|token| token.variants.is_empty() && no_side_tab_is_rounding_utility(token.utility));
    let effective_rounding =
        get_effective_tailwind_class_name_token(&tokens, no_side_tab_is_rounding_utility);
    if has_base_rounding && effective_rounding.is_none() {
        return;
    }
    let has_rounded = effective_rounding.is_some_and(|utility| !utility.ends_with("none"));
    let threshold = if has_rounded {
        NO_SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX
    } else {
        NO_SIDE_TAB_TAILWIND_WIDTH_WITHOUT_RADIUS
    };
    let mut qualifying_sides = Vec::new();
    for side_letter in ["l", "r", "s", "e", "t", "b"] {
        let has_base_width = tokens.iter().any(|token| {
            token.variants.is_empty()
                && no_side_tab_parse_side_border_width(token.utility)
                    .is_some_and(|(side, _)| side == side_letter)
        });
        let effective_width = get_effective_tailwind_class_name_token(&tokens, |utility| {
            no_side_tab_parse_side_border_width(utility)
                .is_some_and(|(side, _)| side == side_letter)
        });
        if has_base_width && effective_width.is_none() {
            return;
        }
        let Some((matched_side, width)) =
            effective_width.and_then(no_side_tab_parse_side_border_width)
        else {
            continue;
        };
        if width >= threshold && (has_rounded || !matches!(matched_side, "t" | "b")) {
            qualifying_sides.push((matched_side, width, effective_width.expect("matched")));
        }
    }
    if qualifying_sides.len() != 1 {
        return;
    }
    let (side_letter, _, width_utility) = qualifying_sides[0];
    let width_resolution = no_side_tab_side_width_resolution(&tokens, side_letter);
    if let Some(style_attribute) = get_authoritative_jsx_attribute(opening_element, "style", true) {
        let Some(style_object) = get_inline_style_object_expression(style_attribute) else {
            return;
        };
        if !width_resolution.is_important
            && no_side_tab_has_inline_side_width(style_object, side_letter)
        {
            return;
        }
    }

    let base_color_source = tokens
        .iter()
        .filter(|token| {
            token.variants.is_empty()
                && no_side_tab_is_border_color_utility_for_side(token.utility, "")
        })
        .map(|token| token.raw_token)
        .collect::<Vec<_>>()
        .join(" ");
    let side_color_source = tokens
        .iter()
        .filter(|token| {
            token.variants.is_empty()
                && no_side_tab_is_border_color_utility_for_side(token.utility, side_letter)
        })
        .map(|token| token.raw_token)
        .collect::<Vec<_>>()
        .join(" ");
    let base_color_tokens = tailwind_class_name_tokens(&base_color_source);
    let side_color_tokens = tailwind_class_name_tokens(&side_color_source);
    let effective_base_color =
        get_effective_tailwind_class_name_token(&base_color_tokens, |_| true);
    let effective_side_color =
        get_effective_tailwind_class_name_token(&side_color_tokens, |_| true);
    let has_important_base_color = base_color_tokens.iter().any(|token| token.is_important);
    let has_important_side_color = side_color_tokens.iter().any(|token| token.is_important);
    let deciding_color =
        if has_important_side_color || !side_color_tokens.is_empty() && !has_important_base_color {
            let Some(color) = effective_side_color else {
                return;
            };
            Some((color, side_letter))
        } else if !base_color_tokens.is_empty() {
            let Some(color) = effective_base_color else {
                return;
            };
            Some((color, ""))
        } else {
            None
        };
    if deciding_color.is_some_and(|(color, side)| {
        no_side_tab_border_color_neutrality(color, side) != Some(false)
    }) {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "Your users see an off, dated thick border on one side ({width_utility}), so use a softer accent or drop it."
        ))
        .with_label(opening_element.span),
    );
}

fn no_side_tab_parse_inset_shadow(value: &str) -> Option<NoSideTabInsetShadow> {
    let tokens = no_side_tab_split_shadow_tokens(value)?;
    if tokens
        .iter()
        .filter(|token| token.eq_ignore_ascii_case("inset"))
        .count()
        != 1
    {
        return None;
    }
    let mut lengths = Vec::new();
    let mut colors = Vec::new();
    for token in tokens {
        if token.eq_ignore_ascii_case("inset") {
            continue;
        }
        if let Some(length) = no_side_tab_parse_shadow_length(token) {
            lengths.push(length);
        } else {
            colors.push(token);
        }
    }
    if !(2..=4).contains(&lengths.len()) || colors.len() != 1 {
        return None;
    }
    let (horizontal, horizontal_has_px) = lengths[0];
    let (vertical, vertical_has_px) = lengths[1];
    if lengths.get(2).is_some_and(|(value, _)| *value != 0.0)
        || lengths.get(3).is_some_and(|(value, _)| *value != 0.0)
        || horizontal != 0.0 && !horizontal_has_px
        || vertical != 0.0 && !vertical_has_px
        || !no_side_tab_has_resolvable_chroma(colors[0])
    {
        return None;
    }
    let horizontal_width = horizontal.abs();
    let vertical_width = vertical.abs();
    let horizontal_edge = (NO_SIDE_TAB_INSET_MIN_WIDTH_PX..=NO_SIDE_TAB_INSET_MAX_WIDTH_PX)
        .contains(&horizontal_width)
        && vertical_width == 0.0;
    let vertical_edge = (NO_SIDE_TAB_INSET_MIN_WIDTH_PX..=NO_SIDE_TAB_INSET_MAX_WIDTH_PX)
        .contains(&vertical_width)
        && horizontal_width == 0.0;
    if horizontal_edge == vertical_edge {
        return None;
    }
    Some(if horizontal_edge {
        NoSideTabInsetShadow {
            edge_label: if horizontal > 0.0 { "left" } else { "right" },
            width_px: horizontal_width,
        }
    } else {
        NoSideTabInsetShadow {
            edge_label: if vertical > 0.0 { "top" } else { "bottom" },
            width_px: vertical_width,
        }
    })
}

fn no_side_tab_split_shadow_tokens(value: &str) -> Option<Vec<&str>> {
    let mut tokens = Vec::new();
    let mut token_start = None;
    let mut parenthesis_depth = 0_u32;
    for (index, character) in value.char_indices() {
        if character == '(' {
            parenthesis_depth += 1;
        } else if character == ')' {
            if parenthesis_depth == 0 {
                return None;
            }
            parenthesis_depth -= 1;
        } else if character == ',' && parenthesis_depth == 0 {
            return None;
        }
        if character.is_whitespace() && parenthesis_depth == 0 {
            if let Some(start) = token_start.take() {
                tokens.push(&value[start..index]);
            }
        } else if token_start.is_none() {
            token_start = Some(index);
        }
    }
    if parenthesis_depth != 0 {
        return None;
    }
    if let Some(start) = token_start {
        tokens.push(&value[start..]);
    }
    Some(tokens)
}

fn no_side_tab_parse_shadow_length(token: &str) -> Option<(f64, bool)> {
    let captures = NO_SIDE_TAB_SHADOW_LENGTH_PATTERN.captures(token)?;
    let has_pixel_unit = captures.get(1).is_some();
    Some((
        if has_pixel_unit {
            token[..token.len() - 2].parse().ok()?
        } else {
            token.parse().ok()?
        },
        has_pixel_unit,
    ))
}

fn no_side_tab_is_fully_transparent_color(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized == "transparent" {
        return true;
    }
    if let Some(hex) = normalized.strip_prefix('#') {
        if hex.len() == 4 && hex.ends_with('0') || hex.len() == 8 && hex.ends_with("00") {
            return true;
        }
    }
    let Some(open_index) = normalized.find('(') else {
        return false;
    };
    if !matches!(&normalized[..open_index], "rgb" | "rgba" | "hsl" | "hsla")
        || !normalized.ends_with(')')
    {
        return false;
    }
    let arguments = &normalized[open_index + 1..normalized.len() - 1];
    if let Some((_, alpha)) = arguments.rsplit_once('/') {
        return no_side_tab_is_zero_alpha(alpha.trim());
    }
    let components = arguments.split(',').collect::<Vec<_>>();
    components.len() == 4
        && components
            .last()
            .is_some_and(|alpha| no_side_tab_is_zero_alpha(alpha.trim()))
}

fn no_side_tab_is_zero_alpha(value: &str) -> bool {
    value
        .strip_suffix('%')
        .unwrap_or(value)
        .parse::<f64>()
        .is_ok_and(|value| value == 0.0)
}

fn no_side_tab_has_resolvable_chroma(value: &str) -> bool {
    if no_side_tab_is_fully_transparent_color(value) {
        return false;
    }
    parse_color_to_rgb(value).map_or_else(
        || {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "aqua"
                    | "blue"
                    | "coral"
                    | "crimson"
                    | "fuchsia"
                    | "gold"
                    | "green"
                    | "lime"
                    | "maroon"
                    | "navy"
                    | "olive"
                    | "orange"
                    | "pink"
                    | "purple"
                    | "rebeccapurple"
                    | "red"
                    | "teal"
                    | "yellow"
            )
        },
        has_color_chroma,
    )
}

fn no_side_tab_is_shadow_geometry_utility(utility: &str) -> bool {
    matches!(
        utility,
        "shadow"
            | "shadow-2xl"
            | "shadow-inner"
            | "shadow-lg"
            | "shadow-md"
            | "shadow-none"
            | "shadow-sm"
            | "shadow-xl"
            | "shadow-xs"
    ) || utility
        .strip_prefix("shadow-[")
        .is_some_and(|value| value.ends_with(']') && value.len() > 1)
}

fn no_side_tab_get_tailwind_inset_shadow<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
) -> Option<NoSideTabTailwindInsetShadow> {
    let resolution = resolve_effective_tailwind_class_name_token(
        tokens,
        no_side_tab_is_shadow_geometry_utility,
        &[],
    );
    if resolution.is_ambiguous {
        return None;
    }
    let arbitrary_shadow = resolution
        .utility?
        .strip_prefix("shadow-[")?
        .strip_suffix(']')?;
    let normalized = arbitrary_shadow.replace('_', " ");
    Some(NoSideTabTailwindInsetShadow {
        is_important: resolution.is_important,
        shadow: no_side_tab_parse_inset_shadow(&normalized)?,
    })
}

fn no_side_tab_get_pseudo_stripe<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
) -> Option<NoSideTabPseudoStripe> {
    for pseudo_name in ["before", "after"] {
        let mut utility_strings = Vec::new();
        let mut has_invalid_pseudo_scope = false;
        for token in tokens {
            if !token.variants.contains(&pseudo_name) {
                continue;
            }
            if token.variants.as_slice() != [pseudo_name]
                || token
                    .variants
                    .iter()
                    .any(|variant| NO_SIDE_TAB_INTERACTION_VARIANT_PATTERN.is_match(variant))
            {
                has_invalid_pseudo_scope = true;
                break;
            }
            utility_strings.push(if token.is_important {
                format!("!{}", token.utility)
            } else {
                token.utility.to_string()
            });
        }
        if has_invalid_pseudo_scope || utility_strings.is_empty() {
            continue;
        }
        let utilities_source = utility_strings.join(" ");
        let utilities = tailwind_class_name_tokens(&utilities_source);
        let position = resolve_effective_tailwind_class_name_token(
            &utilities,
            |utility| {
                matches!(
                    utility,
                    "absolute" | "fixed" | "relative" | "static" | "sticky"
                )
            },
            &[],
        );
        let background = resolve_effective_tailwind_class_name_token(
            &utilities,
            no_side_tab_is_background_color_utility,
            &[],
        );
        let display = resolve_effective_tailwind_class_name_token(
            &utilities,
            |utility| {
                matches!(
                    utility,
                    "block"
                        | "contents"
                        | "flex"
                        | "grid"
                        | "hidden"
                        | "inline"
                        | "inline-block"
                        | "inline-flex"
                        | "inline-grid"
                )
            },
            &[],
        );
        let visibility = resolve_effective_tailwind_class_name_token(
            &utilities,
            |utility| matches!(utility, "visible" | "invisible" | "collapse"),
            &[],
        );
        let opacity = resolve_effective_tailwind_class_name_token(
            &utilities,
            |utility| utility.starts_with("opacity-"),
            &[],
        );
        let background_opacity = resolve_effective_tailwind_class_name_token(
            &utilities,
            |utility| utility.starts_with("bg-opacity-"),
            &[],
        );
        let content = resolve_effective_tailwind_class_name_token(
            &utilities,
            |utility| utility.starts_with("content-") || utility.starts_with("[content:"),
            &[],
        );
        if position.is_ambiguous
            || background.is_ambiguous
            || display.is_ambiguous
            || visibility.is_ambiguous
            || opacity.is_ambiguous
            || background_opacity.is_ambiguous
            || content.is_ambiguous
            || position.utility != Some("absolute")
            || background
                .utility
                .is_none_or(|utility| !no_side_tab_has_chromatic_background(utility))
            || matches!(display.utility, Some("hidden" | "contents"))
            || matches!(visibility.utility, Some("invisible" | "collapse"))
            || content.utility == Some("content-none")
            || opacity
                .utility
                .and_then(|utility| utility.strip_prefix("opacity-"))
                .is_some_and(|value| no_side_tab_is_zero_alpha(value.trim_matches(['[', ']'])))
            || background_opacity
                .utility
                .and_then(|utility| utility.strip_prefix("bg-opacity-"))
                .is_some_and(|value| no_side_tab_is_zero_alpha(value.trim_matches(['[', ']'])))
        {
            continue;
        }
        let width = no_side_tab_dimension_resolution(&utilities, "w");
        let height = no_side_tab_dimension_resolution(&utilities, "h");
        if width.is_ambiguous || height.is_ambiguous {
            continue;
        }
        let width_px = no_side_tab_dimension_px(width.utility, "w");
        let height_px = no_side_tab_dimension_px(height.utility, "h");
        let is_vertical = width_px.is_some_and(|value| {
            (NO_SIDE_TAB_INSET_MIN_WIDTH_PX..=NO_SIDE_TAB_INSET_MAX_WIDTH_PX).contains(&value)
        }) && no_side_tab_is_nearly_full_axis(&utilities, "h", "top", "bottom");
        let is_horizontal = height_px.is_some_and(|value| {
            (NO_SIDE_TAB_INSET_MIN_WIDTH_PX..=NO_SIDE_TAB_INSET_MAX_WIDTH_PX).contains(&value)
        }) && no_side_tab_is_nearly_full_axis(&utilities, "w", "left", "right");
        if is_vertical == is_horizontal {
            continue;
        }
        let edge_label = if is_vertical {
            no_side_tab_anchored_edge(&utilities, "left", "right")
        } else {
            no_side_tab_anchored_edge(&utilities, "top", "bottom")
        }?;
        return Some(NoSideTabPseudoStripe {
            edge_label,
            pseudo_element_name: pseudo_name,
            width_px: if is_vertical { width_px? } else { height_px? },
        });
    }
    None
}

fn no_side_tab_is_background_color_utility(utility: &str) -> bool {
    if matches!(
        utility,
        "bg-transparent" | "bg-black" | "bg-white" | "bg-current" | "bg-inherit"
    ) {
        return true;
    }
    let Some(value) = utility.strip_prefix("bg-") else {
        return false;
    };
    if value.starts_with('[') {
        return value.ends_with(']') || value.contains("]/");
    }
    no_side_tab_named_color(value).is_some()
}

fn no_side_tab_has_chromatic_background(utility: &str) -> bool {
    let Some(value) = utility.strip_prefix("bg-") else {
        return false;
    };
    if let Some(arbitrary) = value.strip_prefix('[') {
        let Some(end) = arbitrary.find(']') else {
            return false;
        };
        let color = arbitrary[..end]
            .strip_prefix("color:")
            .unwrap_or(&arbitrary[..end]);
        let opacity = arbitrary[end + 1..]
            .strip_prefix('/')
            .map(|value| value.trim_matches(['[', ']']));
        return opacity.is_none_or(|opacity| !no_side_tab_is_zero_alpha(opacity))
            && !no_side_tab_is_fully_transparent_color(color)
            && no_side_tab_has_resolvable_chroma(color);
    }
    let (color, opacity) = value
        .split_once('/')
        .map_or((value, None), |(color, opacity)| (color, Some(opacity)));
    no_side_tab_named_color(color).is_some_and(|is_chromatic| is_chromatic)
        && opacity.is_none_or(|opacity| !no_side_tab_is_zero_alpha(opacity))
}

fn no_side_tab_named_color(value: &str) -> Option<bool> {
    let family = value.split_once('-')?.0;
    if !value
        .rsplit_once('-')
        .is_some_and(|(_, shade)| shade.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return None;
    }
    if matches!(family, "slate" | "gray" | "zinc" | "neutral" | "stone") {
        Some(false)
    } else if matches!(
        family,
        "red"
            | "orange"
            | "amber"
            | "yellow"
            | "lime"
            | "green"
            | "emerald"
            | "teal"
            | "cyan"
            | "sky"
            | "blue"
            | "indigo"
            | "violet"
            | "purple"
            | "fuchsia"
            | "pink"
            | "rose"
    ) {
        Some(true)
    } else {
        None
    }
}

fn no_side_tab_dimension_resolution<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    prefix: &str,
) -> EffectiveTailwindClassNameTokenResolution<'a> {
    resolve_effective_tailwind_class_name_token(
        tokens,
        |utility| utility.starts_with(&format!("{prefix}-")) || utility.starts_with("size-"),
        &[],
    )
}

fn no_side_tab_dimension_px(utility: Option<&str>, prefix: &str) -> Option<f64> {
    let utility = utility?;
    parse_static_tailwind_length_px(
        utility,
        if utility.starts_with("size-") {
            "size"
        } else {
            prefix
        },
    )
}

fn no_side_tab_is_nearly_full_axis<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    dimension_prefix: &str,
    start_side: &'static str,
    end_side: &'static str,
) -> bool {
    let dimension = no_side_tab_dimension_resolution(tokens, dimension_prefix);
    if dimension.is_ambiguous {
        return false;
    }
    let start = no_side_tab_offset_resolution(tokens, start_side);
    let end = no_side_tab_offset_resolution(tokens, end_side);
    if dimension.utility.is_some() {
        let is_full = dimension.utility == Some("size-full")
            || dimension
                .utility
                .is_some_and(|utility| utility == format!("{dimension_prefix}-full"));
        return is_full
            && !start.is_ambiguous
            && !end.is_ambiguous
            && start.value_px.is_none_or(|value| value == 0.0)
            && end.value_px.is_none_or(|value| value == 0.0);
    }
    !start.is_ambiguous
        && !end.is_ambiguous
        && start
            .value_px
            .is_some_and(|value| (0.0..=NO_SIDE_TAB_PSEUDO_MAX_EDGE_INSET_PX).contains(&value))
        && end
            .value_px
            .is_some_and(|value| (0.0..=NO_SIDE_TAB_PSEUDO_MAX_EDGE_INSET_PX).contains(&value))
}

fn no_side_tab_anchored_edge<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    start_side: &'static str,
    end_side: &'static str,
) -> Option<&'static str> {
    let start = no_side_tab_offset_resolution(tokens, start_side);
    let end = no_side_tab_offset_resolution(tokens, end_side);
    if start.is_ambiguous || end.is_ambiguous {
        return None;
    }
    let start_anchored = start.value_px == Some(0.0);
    let end_anchored = end.value_px == Some(0.0);
    (start_anchored != end_anchored).then_some(if start_anchored { start_side } else { end_side })
}

fn no_side_tab_offset_resolution<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    side: &str,
) -> NoSideTabOffsetResolution {
    let mut relevant = tokens
        .iter()
        .filter_map(|token| {
            no_side_tab_offset_value(token.utility, side).map(|value| (value, token.is_important))
        })
        .collect::<Vec<_>>();
    let has_important = relevant.iter().any(|(_, important)| *important);
    relevant.retain(|(_, important)| !has_important || *important);
    if relevant.is_empty() {
        return NoSideTabOffsetResolution {
            is_ambiguous: false,
            value_px: None,
        };
    }
    let first = relevant[0].0;
    if first.is_none() || relevant.iter().any(|(value, _)| *value != first) {
        return NoSideTabOffsetResolution {
            is_ambiguous: true,
            value_px: None,
        };
    }
    NoSideTabOffsetResolution {
        is_ambiguous: false,
        value_px: first,
    }
}

fn no_side_tab_offset_value(utility: &str, side: &str) -> Option<Option<f64>> {
    let (sign, utility) = utility
        .strip_prefix('-')
        .map_or((1.0, utility), |utility| (-1.0, utility));
    let axis = if matches!(side, "left" | "right") {
        "inset-x"
    } else {
        "inset-y"
    };
    let prefix = if utility.starts_with(&format!("{side}-")) {
        side
    } else if utility.starts_with(&format!("{axis}-")) {
        axis
    } else if utility.starts_with("inset-")
        && !utility.starts_with("inset-x-")
        && !utility.starts_with("inset-y-")
    {
        "inset"
    } else {
        return None;
    };
    if utility == format!("{prefix}-auto") {
        return Some(None);
    }
    Some(parse_static_tailwind_length_px(utility, prefix).map(|value| value * sign))
}

fn no_side_tab_side_width_resolution<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    side: &str,
) -> EffectiveTailwindClassNameTokenResolution<'a> {
    resolve_effective_tailwind_class_name_token(
        tokens,
        |utility| {
            no_side_tab_parse_side_border_width(utility)
                .is_some_and(|(candidate_side, _)| candidate_side == side)
        },
        &[],
    )
}

fn no_side_tab_parse_side_border_width(utility: &str) -> Option<(&str, f64)> {
    let captures = NO_SIDE_TAB_SIDE_BORDER_WIDTH_PATTERN.captures(utility)?;
    Some((
        captures.get(1)?.as_str(),
        captures.get(2)?.as_str().parse().ok()?,
    ))
}

fn no_side_tab_is_rounding_utility(utility: &str) -> bool {
    utility == "rounded" || utility.starts_with("rounded-")
}

fn no_side_tab_has_inline_side_width(
    style_object: &oxc_ast::ast::ObjectExpression<'_>,
    side: &str,
) -> bool {
    let names: &[&str] = match side {
        "l" => &["borderLeft", "borderLeftWidth"],
        "r" => &["borderRight", "borderRightWidth"],
        "t" => &["borderTop", "borderTopWidth"],
        "b" => &["borderBottom", "borderBottomWidth"],
        "s" => &["borderInlineStart", "borderInlineStartWidth"],
        "e" => &["borderInlineEnd", "borderInlineEndWidth"],
        _ => &[],
    };
    names
        .iter()
        .any(|name| get_effective_static_style_property(style_object, name).is_some())
}

fn no_side_tab_is_border_color_utility_for_side(utility: &str, side: &str) -> bool {
    NO_SIDE_TAB_NAMED_BORDER_COLOR_PATTERN
        .captures(utility)
        .or_else(|| NO_SIDE_TAB_ARBITRARY_BORDER_COLOR_PATTERN.captures(utility))
        .is_some_and(|captures| captures.get(1).map_or("", |capture| capture.as_str()) == side)
}

fn no_side_tab_border_color_neutrality(utility: &str, side: &str) -> Option<bool> {
    if let Some(captures) = NO_SIDE_TAB_NAMED_BORDER_COLOR_PATTERN.captures(utility)
        && captures.get(1).map_or("", |capture| capture.as_str()) == side
    {
        let color = captures.get(2)?.as_str();
        return Some(
            matches!(color, "white" | "black" | "transparent")
                || matches!(
                    color.split_once('-').map(|(family, _)| family),
                    Some("gray" | "slate" | "zinc" | "neutral" | "stone")
                ),
        );
    }
    let captures = NO_SIDE_TAB_ARBITRARY_BORDER_COLOR_PATTERN.captures(utility)?;
    if captures.get(1).map_or("", |capture| capture.as_str()) != side {
        return None;
    }
    parse_color_to_rgb(captures.get(2)?.as_str()).map(|color| !has_color_chroma(color))
}

fn no_side_tab_parse_border_shorthand(value: &str) -> Option<(f64, Option<&str>)> {
    let width = NO_SIDE_TAB_INLINE_BORDER_WIDTH_PATTERN
        .captures(value)?
        .get(1)?
        .as_str()
        .parse()
        .ok()?;
    let color = NO_SIDE_TAB_INLINE_BORDER_COLOR_PATTERN
        .captures(value)
        .and_then(|captures| captures.get(1))
        .map(|capture| capture.as_str().trim());
    Some((width, color))
}

fn no_side_tab_is_neutral_color(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    if matches!(
        value.as_str(),
        "gray" | "grey" | "silver" | "white" | "black" | "transparent" | "currentcolor"
    ) {
        return true;
    }
    parse_color_to_rgb(&value).is_some_and(|color| !has_color_chroma(color))
}

fn no_side_tab_has_spinner_class(class_name: &str) -> bool {
    let tokens = tailwind_class_name_tokens(class_name);
    tokens.iter().any(|token| token.utility == "spinner")
        || tokens.iter().any(|token| token.utility == "animate-spin")
            && tokens.iter().any(|token| token.utility == "rounded-full")
}

fn no_side_tab_is_interactive_or_selected<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let element_type = resolve_jsx_element_type_name(opening_element, ctx);
    if no_side_tab_is_interactive_element(&element_type, opening_element) {
        return true;
    }
    for attribute_name in ["aria-selected", "aria-current"] {
        if no_side_tab_jsx_attribute_ignore_case(opening_element, attribute_name)
            .is_some_and(|attribute| !no_side_tab_is_statically_false_attribute(attribute))
        {
            return true;
        }
    }
    no_side_tab_jsx_attribute_ignore_case(opening_element, "role")
        .and_then(no_side_tab_plain_jsx_string_value)
        .and_then(|value| value.split_whitespace().next())
        .is_some_and(no_side_tab_is_interactive_role)
}

fn no_side_tab_is_interactive_element(
    name: &str,
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    match name {
        "audio" | "button" | "canvas" | "datalist" | "embed" | "menuitem" | "option" | "select"
        | "summary" | "td" | "th" | "tr" | "textarea" | "video" => true,
        "input" => no_side_tab_jsx_attribute_ignore_case(opening_element, "type")
            .and_then(no_side_tab_plain_jsx_string_value)
            .is_none_or(|value| !value.eq_ignore_ascii_case("hidden")),
        "a" | "area" => no_side_tab_jsx_attribute_ignore_case(opening_element, "href").is_some(),
        "img" => no_side_tab_jsx_attribute_ignore_case(opening_element, "usemap").is_some(),
        _ => false,
    }
}

fn no_side_tab_is_interactive_role(role: &str) -> bool {
    matches!(
        role.to_ascii_lowercase().as_str(),
        "button"
            | "checkbox"
            | "columnheader"
            | "combobox"
            | "grid"
            | "gridcell"
            | "link"
            | "listbox"
            | "menu"
            | "menubar"
            | "menuitem"
            | "menuitemcheckbox"
            | "menuitemradio"
            | "option"
            | "radio"
            | "radiogroup"
            | "row"
            | "rowheader"
            | "scrollbar"
            | "searchbox"
            | "separator"
            | "slider"
            | "spinbutton"
            | "switch"
            | "tab"
            | "tablist"
            | "textbox"
            | "toolbar"
            | "tree"
            | "treegrid"
            | "treeitem"
    )
}

fn no_side_tab_jsx_attribute_ignore_case<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    name: &str,
) -> Option<&'b JSXAttribute<'a>> {
    opening_element.attributes.iter().find_map(|attribute| {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            return None;
        };
        match &attribute.name {
            oxc_ast::ast::JSXAttributeName::Identifier(identifier)
                if identifier.name.eq_ignore_ascii_case(name) =>
            {
                Some(attribute.as_ref())
            }
            _ => None,
        }
    })
}

fn no_side_tab_plain_jsx_string_value<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn no_side_tab_is_statically_false_attribute(attribute: &JSXAttribute<'_>) -> bool {
    match attribute.value.as_ref() {
        Some(JSXAttributeValue::StringLiteral(literal)) => literal.value == "false",
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            matches!(
                &container.expression,
                JSXExpression::BooleanLiteral(literal) if !literal.value
            ) || matches!(
                &container.expression,
                JSXExpression::StringLiteral(literal) if literal.value == "false"
            )
        }
        _ => false,
    }
}

fn no_side_tab_has_actual_selected_state(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    for attribute_name in ["aria-selected", "aria-current", "data-selected"] {
        if no_side_tab_jsx_attribute_ignore_case(opening_element, attribute_name)
            .is_some_and(|attribute| !no_side_tab_is_statically_false_attribute(attribute))
        {
            return true;
        }
    }
    let Some(data_state) = no_side_tab_jsx_attribute_ignore_case(opening_element, "data-state")
    else {
        return false;
    };
    no_side_tab_plain_jsx_string_value(data_state).is_none_or(|value| {
        matches!(
            value.to_ascii_lowercase().as_str(),
            "active" | "current" | "selected"
        )
    })
}

fn no_side_tab_has_label_context(
    element: Option<&oxc_ast::ast::JSXElement<'_>>,
    class_name: &str,
) -> bool {
    if tailwind_class_name_tokens(class_name)
        .iter()
        .any(|token| NO_SIDE_TAB_CONTEXT_PATTERN.is_match(token.raw_token))
    {
        return true;
    }
    let Some(element) = element else {
        return false;
    };
    if element
        .children
        .iter()
        .any(no_side_tab_is_dynamic_jsx_content)
    {
        return false;
    }
    let label = get_static_jsx_text(element)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    !label.is_empty()
        && label.encode_utf16().count() <= NO_SIDE_TAB_SHORT_LABEL_MAX_CHARACTERS
        && label.chars().any(char::is_alphanumeric)
}

fn no_side_tab_is_dynamic_jsx_content(child: &JSXChild<'_>) -> bool {
    match child {
        JSXChild::ExpressionContainer(container) => match &container.expression {
            JSXExpression::NullLiteral(_)
            | JSXExpression::BooleanLiteral(_)
            | JSXExpression::NumericLiteral(_)
            | JSXExpression::StringLiteral(_)
            | JSXExpression::BigIntLiteral(_)
            | JSXExpression::RegExpLiteral(_)
            | JSXExpression::EmptyExpression(_) => false,
            JSXExpression::TemplateLiteral(template) => !template.expressions.is_empty(),
            _ => true,
        },
        JSXChild::Element(element) => element
            .children
            .iter()
            .any(no_side_tab_is_dynamic_jsx_content),
        JSXChild::Fragment(fragment) => fragment
            .children
            .iter()
            .any(no_side_tab_is_dynamic_jsx_content),
        _ => false,
    }
}

fn no_side_tab_has_positioning_context(tokens: &[TailwindClassNameToken<'_>]) -> bool {
    let resolution = resolve_effective_tailwind_class_name_token(
        tokens,
        |utility| {
            matches!(
                utility,
                "absolute" | "fixed" | "relative" | "static" | "sticky"
            )
        },
        &[],
    );
    !resolution.is_ambiguous
        && matches!(
            resolution.utility,
            Some("absolute" | "fixed" | "relative" | "sticky")
        )
}

fn no_side_tab_is_glyph_or_logo_context<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    element: Option<&oxc_ast::ast::JSXElement<'a>>,
    tokens: &[TailwindClassNameToken<'a>],
    ctx: &LintContext<'a>,
) -> bool {
    let element_type = resolve_jsx_element_type_name(opening_element, ctx);
    let normalized_element_type = element_type.to_ascii_lowercase();
    if matches!(
        normalized_element_type.as_str(),
        "canvas" | "img" | "path" | "picture" | "svg" | "use"
    ) || ["avatar", "glyph", "icon", "logo", "mark"]
        .iter()
        .any(|suffix| normalized_element_type.ends_with(suffix))
    {
        return true;
    }
    if tokens
        .iter()
        .any(|token| token.variants.is_empty() && NO_SIDE_TAB_ART_PATTERN.is_match(token.utility))
    {
        return true;
    }
    let width = no_side_tab_dimension_resolution(tokens, "w");
    let height = no_side_tab_dimension_resolution(tokens, "h");
    !width.is_ambiguous
        && !height.is_ambiguous
        && no_side_tab_dimension_px(width.utility, "w")
            .is_some_and(|value| value <= NO_SIDE_TAB_GLYPH_MAX_SIZE_PX)
        && no_side_tab_dimension_px(height.utility, "h")
            .is_some_and(|value| value <= NO_SIDE_TAB_GLYPH_MAX_SIZE_PX)
        && element.is_none_or(|element| {
            get_static_jsx_text(element)
                .split_whitespace()
                .collect::<String>()
                .is_empty()
        })
}

fn no_side_tab_is_horizontal_underline_host<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let element_type = resolve_jsx_element_type_name(opening_element, ctx);
    let normalized_element_type = element_type.to_ascii_lowercase();
    matches!(normalized_element_type.as_str(), "a" | "area" | "button")
        || normalized_element_type.ends_with("button")
        || normalized_element_type.ends_with("link")
}

fn no_side_tab_parse_javascript_float_prefix(value: &str) -> Option<f64> {
    let value = value.trim_start_matches(is_js_whitespace);
    let bytes = value.as_bytes();
    let mut end = usize::from(matches!(bytes.first(), Some(b'+') | Some(b'-')));
    if value[end..].starts_with("Infinity") {
        return Some(if bytes.first() == Some(&b'-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        });
    }
    let integer_digit_count = bytes[end..]
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    end += integer_digit_count;
    let mut fractional_digit_count = 0;
    if bytes.get(end) == Some(&b'.') {
        end += 1;
        fractional_digit_count = bytes[end..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count();
        end += fractional_digit_count;
    }
    if integer_digit_count == 0 && fractional_digit_count == 0 {
        return None;
    }
    if matches!(bytes.get(end), Some(b'e') | Some(b'E')) {
        let exponent_start = end;
        end += 1;
        end += usize::from(matches!(bytes.get(end), Some(b'+') | Some(b'-')));
        let exponent_digit_count = bytes[end..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count();
        if exponent_digit_count == 0 {
            end = exponent_start;
        } else {
            end += exponent_digit_count;
        }
    }
    value[..end].parse().ok()
}
