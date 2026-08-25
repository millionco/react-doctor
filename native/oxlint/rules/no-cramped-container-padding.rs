use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{Expression, ObjectExpression, ObjectProperty, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MIN_BOUNDED_CONTAINER_PADDING_PX: f64 = 8.0;
const ROOT_FONT_SIZE_PX: f64 = 16.0;
const TAILWIND_SPACING_UNIT_PX: f64 = 4.0;
const BOUNDED_CONTAINER_TAG_NAMES: [&str; 11] = [
    "article", "aside", "div", "fieldset", "footer", "header", "li", "main", "nav", "p", "section",
];
static INLINE_ZERO_BORDER_PATTERN: Lazy<Regex> = lazy_regex!(r"^0(?:px|rem|em)?(?:\s|$)");
static TAILWIND_BORDER_GEOMETRY_PATTERN: Lazy<Regex> = lazy_regex!(
    r"^border(?:-[trblxy])?(?:(?:-(?:px|[0-9]+(?:\.[0-9]+)?|\[[0-9]+(?:\.[0-9]+)?px\]))|-(?:hidden|none|solid|dashed|dotted|double))?$"
);
static TAILWIND_SHADOW_GEOMETRY_PATTERN: Lazy<Regex> = lazy_regex!(
    r"^(?:ring(?:-(?:px|[0-9]+(?:\.[0-9]+)?|\[[0-9]+(?:\.[0-9]+)?px\]))?|shadow(?:-none|-(?:2xl|inner|lg|md|sm|xl|xs))?)$"
);

#[derive(Clone, Copy)]
struct EffectiveInlinePadding<'a> {
    covered_side_count: usize,
    padding_px: f64,
    property: &'a ObjectProperty<'a>,
}

#[derive(Clone, Copy)]
struct EffectiveTailwindPadding {
    is_important: bool,
    padding_px: Option<f64>,
    specificity: usize,
}

#[derive(Clone, Copy, Default)]
struct TailwindPaddingResolution {
    minimum_important_padding_px: Option<f64>,
    minimum_padding_px: Option<f64>,
}

#[derive(Debug, Default, Clone)]
pub struct NoCrampedContainerPadding;

declare_oxc_lint!(
    /// Disallow bounded text containers with cramped padding.
    NoCrampedContainerPadding,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow cramped padding inside bounded text containers.",
);

impl Rule for NoCrampedContainerPadding {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if get_static_jsx_text(element)
            .trim_matches(is_js_whitespace)
            .is_empty()
            || resolve_jsx_element_type(&element.opening_element, ctx)
                .is_none_or(|(tag_name, _)| !BOUNDED_CONTAINER_TAG_NAMES.contains(&tag_name))
        {
            return;
        }
        let style_attribute =
            get_authoritative_jsx_attribute(&element.opening_element, "style", true);
        if style_attribute.is_none()
            && element.opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            })
        {
            return;
        }
        let style = if let Some(style_attribute) = style_attribute {
            let Some(style) = get_inline_style_object_expression(style_attribute) else {
                return;
            };
            if style.properties.iter().any(|property| {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return true;
                };
                property.key.static_name().is_none()
            }) {
                return;
            }
            Some(style)
        } else {
            None
        };
        let inline_padding = effective_inline_padding(style);
        let inline_background =
            effective_style_property_among(style, &["background", "backgroundColor"]);
        let inline_box_shadow = effective_style_property(style, "boxShadow");
        let inline_outline = effective_style_property(style, "outline");
        let has_visible_inline_surface = inline_background.is_some_and(is_visible_inline_boundary)
            || has_visible_inline_border(style, false)
            || inline_box_shadow.is_some_and(is_visible_inline_boundary)
            || inline_outline.is_some_and(is_visible_inline_boundary);

        if let Some(class_name) = get_static_class_name(&element.opening_element)
            && has_capability_or_unspecified(ctx, "tailwind")
        {
            let tokens = tailwind_class_name_tokens(class_name);
            let base_tokens = tokens
                .iter()
                .filter(|token| token.variants.is_empty())
                .collect::<Vec<_>>();
            let marked_utilities = base_tokens
                .iter()
                .map(|token| {
                    if token.is_important {
                        format!("!{}", token.utility)
                    } else {
                        token.utility.to_string()
                    }
                })
                .collect::<Vec<_>>();
            let marked_utility_refs = marked_utilities
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            let padding_resolution = tailwind_padding_resolution(&base_tokens);
            let background_resolution = resolve_effective_tailwind_class_name_token(
                &tokens,
                is_tailwind_background_color_utility,
                &[],
            );
            let border_resolution = resolve_effective_tailwind_class_name_token(
                &tokens,
                |utility| TAILWIND_BORDER_GEOMETRY_PATTERN.is_match(utility),
                &[],
            );
            let shadow_resolution = resolve_effective_tailwind_class_name_token(
                &tokens,
                |utility| TAILWIND_SHADOW_GEOMETRY_PATTERN.is_match(utility),
                &[],
            );
            let is_background_protected =
                background_resolution.is_important || background_resolution.is_ambiguous;
            let is_border_protected =
                border_resolution.is_important || border_resolution.is_ambiguous;
            let is_shadow_protected =
                shadow_resolution.is_important || shadow_resolution.is_ambiguous;
            let has_visible_background = if let Some(inline_background) = inline_background
                && !is_background_protected
            {
                is_visible_inline_boundary(inline_background)
            } else {
                has_visible_tailwind_background(&marked_utility_refs)
            };
            let has_visible_border = if is_border_protected {
                has_visible_tailwind_closed_border(&marked_utility_refs)
            } else {
                has_visible_inline_border(
                    style,
                    has_visible_tailwind_closed_border(&marked_utility_refs),
                )
            };
            let has_visible_ring = if let Some(inline_box_shadow) = inline_box_shadow
                && !is_shadow_protected
            {
                is_visible_inline_boundary(inline_box_shadow)
            } else {
                has_visible_tailwind_ring(&marked_utility_refs)
            };
            let effective_padding_px =
                if inline_padding.is_some_and(|padding| padding.covered_side_count == 4) {
                    let inline_padding = inline_padding.unwrap();
                    Some(
                        padding_resolution
                            .minimum_important_padding_px
                            .map_or(inline_padding.padding_px, |padding| {
                                inline_padding.padding_px.min(padding)
                            }),
                    )
                } else {
                    padding_resolution.minimum_padding_px
                };
            if (has_visible_background || has_visible_border || has_visible_ring)
                && effective_padding_px
                    .is_some_and(|padding| padding < MIN_BOUNDED_CONTAINER_PADDING_PX)
            {
                let padding = effective_padding_px.unwrap();
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "This visible container leaves only {padding}px around its text. Use at least {MIN_BOUNDED_CONTAINER_PADDING_PX}px of padding."
                    ))
                    .with_label(element.opening_element.span),
                );
                return;
            }
        }

        if let Some(inline_padding) = inline_padding
            && has_visible_inline_surface
            && inline_padding.padding_px < MIN_BOUNDED_CONTAINER_PADDING_PX
        {
            let padding = inline_padding.padding_px;
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This bounded surface gives its text {padding}px of padding. Increase it to at least {MIN_BOUNDED_CONTAINER_PADDING_PX}px."
                ))
                .with_label(inline_padding.property.span),
            );
        }
    }
}

fn effective_inline_padding<'a>(
    style: Option<&'a ObjectExpression<'a>>,
) -> Option<EffectiveInlinePadding<'a>> {
    let mut padding_by_side: [Option<(f64, &'a ObjectProperty<'a>)>; 4] = [None; 4];
    for property in style?.properties.iter() {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            padding_by_side = [None; 4];
            continue;
        };
        let Some(property_name) = property.key.static_name() else {
            padding_by_side = [None; 4];
            continue;
        };
        let sides: &[usize] = match property_name.as_ref() {
            "padding" => &[0, 1, 2, 3],
            "paddingBlock" => &[0, 2],
            "paddingInline" => &[1, 3],
            "paddingTop" => &[0],
            "paddingRight" => &[1],
            "paddingBottom" => &[2],
            "paddingLeft" => &[3],
            _ => continue,
        };
        let padding_px = static_padding_px(property);
        for side in sides {
            padding_by_side[*side] = padding_px.map(|padding| (padding, property.as_ref()));
        }
    }
    let (padding_px, property) = padding_by_side
        .iter()
        .flatten()
        .min_by(|left, right| left.0.total_cmp(&right.0))?;
    Some(EffectiveInlinePadding {
        covered_side_count: padding_by_side.iter().flatten().count(),
        padding_px: *padding_px,
        property,
    })
}

fn static_padding_px(property: &ObjectProperty<'_>) -> Option<f64> {
    if let Some(value) = get_static_style_property_number_value(property) {
        return Some(value);
    }
    let Expression::StringLiteral(value) = &property.value else {
        return None;
    };
    let value = value.value.trim_matches(is_js_whitespace);
    let (number, multiplier) = value
        .strip_suffix("rem")
        .map(|number| (number, ROOT_FONT_SIZE_PX))
        .or_else(|| value.strip_suffix("px").map(|number| (number, 1.0)))?;
    if number.is_empty()
        || !number
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
    {
        return None;
    }
    parse_javascript_decimal_prefix_value(number).map(|number| number * multiplier)
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

fn is_visible_inline_boundary(property: &ObjectProperty<'_>) -> bool {
    let Some(property_name) = property.key.static_name() else {
        return false;
    };
    if !matches!(
        property_name.as_ref(),
        "background"
            | "backgroundColor"
            | "border"
            | "borderColor"
            | "borderStyle"
            | "borderWidth"
            | "boxShadow"
            | "outline"
    ) {
        return false;
    }
    if let Some(value) = get_static_style_property_number_value(property) {
        return value > 0.0;
    }
    let Expression::StringLiteral(value) = &property.value else {
        return false;
    };
    let value = value
        .value
        .trim_matches(is_js_whitespace)
        .to_ascii_lowercase();
    if value.is_empty() {
        return false;
    }
    if property_name == "border" && INLINE_ZERO_BORDER_PATTERN.is_match(&value) {
        return false;
    }
    if property_name == "boxShadow" {
        let parts = value
            .split(is_js_whitespace)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        if let Some((color, geometry)) = parts.split_last()
            && (*color == "transparent" || color.ends_with("/0"))
            && geometry.iter().all(|part| is_zero_css_length(part))
        {
            return false;
        }
    }
    !matches!(
        value.as_str(),
        "0" | "0px" | "0rem" | "0em" | "none" | "transparent"
    )
}

fn is_zero_css_length(value: &str) -> bool {
    matches!(value, "0" | "0px" | "0rem" | "0em")
}

fn has_visible_inline_border(
    style: Option<&ObjectExpression<'_>>,
    has_visible_tailwind_border: bool,
) -> bool {
    let mut has_visible_width = has_visible_tailwind_border;
    let mut has_visible_style = has_visible_tailwind_border;
    let mut has_visible_color = has_visible_tailwind_border;
    for property in style.into_iter().flat_map(|style| &style.properties) {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let Some(property_name) = property.key.static_name() else {
            continue;
        };
        if !matches!(
            property_name.as_ref(),
            "border" | "borderColor" | "borderStyle" | "borderWidth"
        ) {
            continue;
        }
        let is_visible = is_visible_inline_boundary(property);
        match property_name.as_ref() {
            "border" => {
                has_visible_width = is_visible;
                has_visible_style = is_visible;
                has_visible_color = is_visible;
            }
            "borderWidth" => has_visible_width = is_visible,
            "borderStyle" => has_visible_style = is_visible,
            "borderColor" => has_visible_color = is_visible,
            _ => {}
        }
    }
    has_visible_width && has_visible_style && has_visible_color
}

fn tailwind_padding_resolution(
    tokens: &[&TailwindClassNameToken<'_>],
) -> TailwindPaddingResolution {
    let mut padding_by_side: [Option<EffectiveTailwindPadding>; 6] = [None; 6];
    for token in tokens {
        let Some((prefix, padding_px)) = parse_tailwind_padding(token.utility) else {
            continue;
        };
        let (sides, specificity): (&[usize], usize) = match prefix {
            "p" => (&[0, 1, 2, 3], 0),
            "px" => (&[1, 3], 1),
            "py" => (&[0, 2], 1),
            "pt" => (&[0], 2),
            "pr" => (&[1], 2),
            "pb" => (&[2], 2),
            "pl" => (&[3], 2),
            "ps" => (&[4], 2),
            "pe" => (&[5], 2),
            _ => continue,
        };
        for side in sides {
            let current = padding_by_side[*side];
            if current.is_some_and(|current| {
                current.is_important && !token.is_important
                    || current.is_important == token.is_important
                        && current.specificity > specificity
            }) {
                continue;
            }
            if let Some(current) = current
                && current.is_important == token.is_important
                && current.specificity == specificity
            {
                if current.padding_px != Some(padding_px) {
                    padding_by_side[*side] = Some(EffectiveTailwindPadding {
                        padding_px: None,
                        ..current
                    });
                }
                continue;
            }
            padding_by_side[*side] = Some(EffectiveTailwindPadding {
                is_important: token.is_important,
                padding_px: Some(padding_px),
                specificity,
            });
        }
    }
    let mut resolution = TailwindPaddingResolution::default();
    for padding in padding_by_side.iter().flatten() {
        let Some(padding_px) = padding.padding_px else {
            return TailwindPaddingResolution::default();
        };
        resolution.minimum_padding_px = Some(
            resolution
                .minimum_padding_px
                .map_or(padding_px, |minimum| minimum.min(padding_px)),
        );
        if padding.is_important {
            resolution.minimum_important_padding_px = Some(
                resolution
                    .minimum_important_padding_px
                    .map_or(padding_px, |minimum| minimum.min(padding_px)),
            );
        }
    }
    resolution
}

fn parse_tailwind_padding(utility: &str) -> Option<(&str, f64)> {
    let (prefix, value) = utility.split_once('-')?;
    if !matches!(
        prefix,
        "p" | "px" | "py" | "pt" | "pr" | "pb" | "pl" | "ps" | "pe"
    ) {
        return None;
    }
    if value == "px" {
        return Some((prefix, 1.0));
    }
    if !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
    {
        return parse_javascript_decimal_prefix_value(value)
            .map(|value| (prefix, value * TAILWIND_SPACING_UNIT_PX));
    }
    let arbitrary = value.strip_prefix('[')?;
    let (number, multiplier) = arbitrary
        .strip_suffix("rem]")
        .map(|number| (number, ROOT_FONT_SIZE_PX))
        .or_else(|| arbitrary.strip_suffix("px]").map(|number| (number, 1.0)))?;
    if number.is_empty()
        || !number
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
    {
        return None;
    }
    parse_javascript_decimal_prefix_value(number).map(|value| (prefix, value * multiplier))
}

fn is_tailwind_background_color_utility(utility: &str) -> bool {
    let Some(value) = utility.strip_prefix("bg-") else {
        return false;
    };
    !value.starts_with("opacity-")
        && !matches!(
            value,
            "auto"
                | "center"
                | "contain"
                | "cover"
                | "fixed"
                | "left"
                | "local"
                | "none"
                | "right"
                | "scroll"
                | "top"
        )
        && !value.starts_with("clip-")
        && !value.starts_with("origin-")
        && !value.starts_with("repeat")
        && !["[length:", "[position:", "[size:"]
            .iter()
            .any(|prefix| value.starts_with(prefix))
        && !value.is_empty()
}
