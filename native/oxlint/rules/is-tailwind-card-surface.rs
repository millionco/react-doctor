const CARD_ROOT_FONT_SIZE_PX: f64 = 16.0;
const CARD_TAILWIND_SPACING_UNIT_PX: f64 = 4.0;
const CARD_PADDING_SHORTHAND_SPECIFICITY: usize = 0;
const CARD_PADDING_AXIS_SPECIFICITY: usize = 1;
const CARD_PADDING_SIDE_SPECIFICITY: usize = 2;

static CARD_BORDER_WIDTH_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> = lazy_regex::lazy_regex!(
    r"^border(?:-([trblxy]))?(?:-(px|[0-9]+(?:\.[0-9]+)?|\[[0-9]+(?:\.[0-9]+)?px\]))?$"
);
static CARD_BORDER_STYLE_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> =
    lazy_regex::lazy_regex!(r"^border(?:-([trblxy]))?-(hidden|none|solid|dashed|dotted|double)$");
static CARD_BORDER_COLOR_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> =
    lazy_regex::lazy_regex!(r"^border(?:-([trblxy]))?-(.+)$");
static CARD_PADDING_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> = lazy_regex::lazy_regex!(
    r"^p[trblesxy]?-(px|[0-9.]+|\[[0-9.]+(?:px|rem)\])$"
);
static CARD_RING_WIDTH_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> =
    lazy_regex::lazy_regex!(r"^ring(?:-(px|[0-9.]+|\[[0-9.]+px\]))?$");

#[derive(Clone, Copy)]
enum CardBooleanState {
    Undeclared(bool),
    Declared {
        is_important: bool,
        specificity: usize,
        value: Option<bool>,
    },
}

#[derive(Clone, Copy)]
struct CardPaddingState {
    is_important: bool,
    specificity: usize,
    value: Option<f64>,
}

fn is_tailwind_card_surface(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    let Some(class_name) = get_static_class_name(opening_element) else {
        return false;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    let effective_rounding =
        get_effective_tailwind_class_name_token(&tokens, is_card_rounding_utility);
    let has_rounding = effective_rounding.is_some_and(|utility| utility != "rounded-none");
    let has_interior = card_padding_values(&tokens)
        .into_iter()
        .any(|padding| padding > 0.0)
        || card_has_visible_background(&tokens);
    has_rounding && card_has_visible_boundary(&tokens) && has_interior
}

fn is_card_rounding_utility(utility: &str) -> bool {
    if utility == "rounded-none"
        || matches!(
            utility,
            "rounded"
                | "rounded-full"
                | "rounded-lg"
                | "rounded-md"
                | "rounded-sm"
                | "rounded-xl"
                | "rounded-xs"
        )
    {
        return true;
    }
    if let Some(size) = utility
        .strip_prefix("rounded-")
        .and_then(|value| value.strip_suffix("xl"))
        && size.len() == 1
        && matches!(size.as_bytes()[0], b'2'..=b'9')
    {
        return true;
    }
    utility
        .strip_prefix("rounded-[")
        .and_then(|value| value.strip_suffix(']'))
        .is_some_and(|value| !value.is_empty() && !value.contains(']'))
}

fn card_padding_values(tokens: &[TailwindClassNameToken<'_>]) -> Vec<f64> {
    let mut padding_by_side: [Option<CardPaddingState>; 6] = [None; 6];
    for token in tokens.iter().filter(|token| token.variants.is_empty()) {
        let utility = token.utility;
        let Some(prefix_end) = utility.find('-') else {
            continue;
        };
        let prefix = &utility[..prefix_end];
        let Some(padding_value) = card_padding_value_px(utility) else {
            continue;
        };
        let specificity = match prefix {
            "p" => CARD_PADDING_SHORTHAND_SPECIFICITY,
            "px" | "py" => CARD_PADDING_AXIS_SPECIFICITY,
            _ => CARD_PADDING_SIDE_SPECIFICITY,
        };
        for side in card_padding_sides(prefix) {
            let current = padding_by_side[*side];
            if current.is_some_and(|state| state.is_important && !token.is_important)
                || current.is_some_and(|state| {
                    state.is_important == token.is_important && state.specificity > specificity
                })
            {
                continue;
            }
            if let Some(state) = current
                && state.is_important == token.is_important
                && state.specificity == specificity
            {
                padding_by_side[*side] = Some(CardPaddingState {
                    value: (state.value == Some(padding_value)).then_some(padding_value),
                    ..state
                });
                continue;
            }
            padding_by_side[*side] = Some(CardPaddingState {
                is_important: token.is_important,
                specificity,
                value: Some(padding_value),
            });
        }
    }
    padding_by_side
        .into_iter()
        .flatten()
        .filter_map(|padding| padding.value)
        .collect()
}

fn card_padding_value_px(utility: &str) -> Option<f64> {
    let captures = CARD_PADDING_PATTERN.captures(utility)?;
    let value = captures.get(1)?.as_str();
    if value == "px" {
        return Some(1.0);
    }
    if let Some(value) = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix("rem]"))
    {
        return Some(parse_card_decimal(value) * CARD_ROOT_FONT_SIZE_PX);
    }
    if let Some(value) = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix("px]"))
    {
        return Some(parse_card_decimal(value));
    }
    Some(parse_card_decimal(value) * CARD_TAILWIND_SPACING_UNIT_PX)
}

fn parse_card_decimal(value: &str) -> f64 {
    let mut end = 0;
    let mut has_digit = false;
    let mut has_decimal_point = false;
    for (index, byte) in value.bytes().enumerate() {
        if byte.is_ascii_digit() {
            has_digit = true;
        } else if byte == b'.' && !has_decimal_point {
            has_decimal_point = true;
        } else {
            break;
        }
        end = index + 1;
    }
    if !has_digit {
        return f64::NAN;
    }
    value[..end].parse().unwrap_or(f64::NAN)
}

fn card_padding_sides(prefix: &str) -> &'static [usize] {
    match prefix {
        "p" => &[0, 1, 2, 3],
        "px" => &[1, 3],
        "py" => &[0, 2],
        "pt" => &[0],
        "pr" => &[1],
        "pb" => &[2],
        "pl" => &[3],
        "ps" => &[4],
        "pe" => &[5],
        _ => &[],
    }
}

fn card_has_visible_boundary(tokens: &[TailwindClassNameToken<'_>]) -> bool {
    card_has_visible_border(tokens)
        || card_has_visible_ring(tokens)
        || card_has_visible_shadow(tokens)
}

fn card_has_visible_background(tokens: &[TailwindClassNameToken<'_>]) -> bool {
    let mut color_state = card_boolean_state(false);
    let mut opacity_state = card_boolean_state(true);
    for token in tokens.iter().filter(|token| token.variants.is_empty()) {
        let utility = token.utility;
        if utility.starts_with("bg-opacity-") {
            opacity_state = update_card_boolean_state(
                opacity_state,
                utility != "bg-opacity-0",
                token.is_important,
                0,
            );
            continue;
        }
        if utility != "bg-transparent"
            && (!utility.starts_with("bg-") || card_is_non_surface_background(utility))
        {
            continue;
        }
        let is_transparent = matches!(utility, "bg-transparent" | "bg-[transparent]")
            || utility
                .strip_prefix("bg-")
                .and_then(|value| value.strip_suffix("/0"))
                .is_some_and(|value| !value.is_empty());
        color_state =
            update_card_boolean_state(color_state, !is_transparent, token.is_important, 0);
    }
    card_boolean_value(color_state) == Some(true)
        && card_boolean_value(opacity_state) == Some(true)
}

fn card_is_non_surface_background(utility: &str) -> bool {
    let Some(value) = utility.strip_prefix("bg-") else {
        return false;
    };
    [
        "auto",
        "center",
        "clip-",
        "contain",
        "cover",
        "fixed",
        "left",
        "local",
        "none",
        "origin-",
        "repeat",
        "right",
        "scroll",
        "top",
        "transparent",
        "[length:",
        "[position:",
        "[size:",
    ]
    .iter()
    .any(|prefix| value.starts_with(prefix))
}

fn card_has_visible_border(tokens: &[TailwindClassNameToken<'_>]) -> bool {
    let mut width_by_edge = [card_boolean_state(false); 4];
    let mut style_by_edge = [card_boolean_state(true); 4];
    let mut color_by_edge = [card_boolean_state(true); 4];
    let mut opacity_by_edge = [card_boolean_state(true); 4];
    for token in tokens.iter().filter(|token| token.variants.is_empty()) {
        let utility = token.utility;
        if let Some(captures) = CARD_BORDER_WIDTH_PATTERN.captures(utility) {
            let direction = captures.get(1).map(|capture| capture.as_str());
            let length = captures.get(2).map(|capture| capture.as_str());
            let has_width = length.is_none_or(|length| {
                length == "px" || card_border_length(length).is_some_and(|length| length > 0.0)
            });
            update_card_border_edges(
                &mut width_by_edge,
                direction,
                has_width,
                token.is_important,
            );
            continue;
        }
        if let Some(captures) = CARD_BORDER_STYLE_PATTERN.captures(utility) {
            let direction = captures.get(1).map(|capture| capture.as_str());
            let style = captures.get(2).map_or("", |capture| capture.as_str());
            update_card_border_edges(
                &mut style_by_edge,
                direction,
                !matches!(style, "hidden" | "none"),
                token.is_important,
            );
            continue;
        }
        let Some(captures) = CARD_BORDER_COLOR_PATTERN.captures(utility) else {
            continue;
        };
        let direction = captures.get(1).map(|capture| capture.as_str());
        let color = captures.get(2).map_or("", |capture| capture.as_str());
        if color.starts_with("opacity-") {
            update_card_border_edges(
                &mut opacity_by_edge,
                direction,
                color != "opacity-0",
                token.is_important,
            );
            continue;
        }
        if color.starts_with("spacing-") || matches!(color, "collapse" | "separate") {
            continue;
        }
        update_card_border_edges(
            &mut color_by_edge,
            direction,
            color != "transparent" && !color.ends_with("/0"),
            token.is_important,
        );
    }
    (0..4).any(|edge| {
        card_boolean_value(width_by_edge[edge]) == Some(true)
            && card_boolean_value(style_by_edge[edge]) == Some(true)
            && card_boolean_value(color_by_edge[edge]) == Some(true)
            && card_boolean_value(opacity_by_edge[edge]) == Some(true)
    })
}

fn update_card_border_edges(
    states: &mut [CardBooleanState; 4],
    direction: Option<&str>,
    value: bool,
    is_important: bool,
) {
    let specificity = match direction {
        None => 0,
        Some("x" | "y") => 1,
        Some(_) => 2,
    };
    for edge in tailwind_border_edges(direction) {
        states[*edge] =
            update_card_boolean_state(states[*edge], value, is_important, specificity);
    }
}

fn card_border_length(value: &str) -> Option<f64> {
    value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix("px]"))
        .unwrap_or(value)
        .parse::<f64>()
        .ok()
}

fn card_has_visible_ring(tokens: &[TailwindClassNameToken<'_>]) -> bool {
    let mut width_state = card_boolean_state(false);
    let mut color_state = card_boolean_state(true);
    let mut opacity_state = card_boolean_state(true);
    for token in tokens.iter().filter(|token| token.variants.is_empty()) {
        let utility = token.utility;
        if let Some(captures) = CARD_RING_WIDTH_PATTERN.captures(utility) {
            let width = captures.get(1).map(|capture| capture.as_str());
            let has_width = width.is_none_or(|width| {
                width == "px" || card_ring_width(width).is_some_and(|width| width > 0.0)
            });
            width_state =
                update_card_boolean_state(width_state, has_width, token.is_important, 0);
            continue;
        }
        if utility == "ring-opacity-0" {
            opacity_state =
                update_card_boolean_state(opacity_state, false, token.is_important, 0);
            continue;
        }
        if utility.starts_with("ring-opacity-") {
            opacity_state =
                update_card_boolean_state(opacity_state, true, token.is_important, 0);
            continue;
        }
        if utility == "ring-transparent"
            || utility.starts_with("ring-") && utility.ends_with("/0")
        {
            color_state =
                update_card_boolean_state(color_state, false, token.is_important, 0);
            continue;
        }
        if utility.starts_with("ring-")
            && !utility.starts_with("ring-opacity-")
            && !utility.starts_with("ring-offset-")
            && utility != "ring-inset"
        {
            color_state =
                update_card_boolean_state(color_state, true, token.is_important, 0);
        }
    }
    card_boolean_value(width_state) == Some(true)
        && card_boolean_value(color_state) == Some(true)
        && card_boolean_value(opacity_state) == Some(true)
}

fn card_ring_width(value: &str) -> Option<f64> {
    let value = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix("px]"))
        .unwrap_or(value);
    let parsed = parse_card_decimal(value);
    parsed.is_finite().then_some(parsed)
}

fn card_has_visible_shadow(tokens: &[TailwindClassNameToken<'_>]) -> bool {
    let mut geometry_state = card_boolean_state(false);
    let mut color_state = card_boolean_state(true);
    for token in tokens.iter().filter(|token| token.variants.is_empty()) {
        let utility = token.utility;
        if utility == "shadow-none" {
            geometry_state =
                update_card_boolean_state(geometry_state, false, token.is_important, 0);
        } else if is_card_shadow_geometry(utility) {
            geometry_state =
                update_card_boolean_state(geometry_state, true, token.is_important, 0);
        } else if utility == "shadow-transparent"
            || utility.starts_with("shadow-") && utility.ends_with("/0")
        {
            color_state =
                update_card_boolean_state(color_state, false, token.is_important, 0);
        } else if utility.starts_with("shadow-") {
            color_state =
                update_card_boolean_state(color_state, true, token.is_important, 0);
        }
    }
    card_boolean_value(geometry_state) == Some(true)
        && card_boolean_value(color_state) == Some(true)
}

fn is_card_shadow_geometry(utility: &str) -> bool {
    if utility == "shadow"
        || [
            "shadow-2xl",
            "shadow-inner",
            "shadow-lg",
            "shadow-md",
            "shadow-sm",
            "shadow-xl",
            "shadow-xs",
        ]
        .contains(&utility)
    {
        return true;
    }
    utility
        .strip_prefix("shadow-[")
        .and_then(|value| value.strip_suffix(']'))
        .is_some_and(|value| {
            !value.is_empty()
                && !value.contains(']')
                && ["em", "px", "rem"]
                    .iter()
                    .any(|unit| value.contains(unit))
        })
}

fn card_boolean_state(value: bool) -> CardBooleanState {
    CardBooleanState::Undeclared(value)
}

fn card_boolean_value(state: CardBooleanState) -> Option<bool> {
    match state {
        CardBooleanState::Undeclared(value) => Some(value),
        CardBooleanState::Declared { value, .. } => value,
    }
}

fn update_card_boolean_state(
    current: CardBooleanState,
    value: bool,
    is_important: bool,
    specificity: usize,
) -> CardBooleanState {
    let CardBooleanState::Declared {
        is_important: current_is_important,
        specificity: current_specificity,
        value: current_value,
    } = current
    else {
        return CardBooleanState::Declared {
            is_important,
            specificity,
            value: Some(value),
        };
    };
    if current_is_important != is_important {
        return if current_is_important {
            current
        } else {
            CardBooleanState::Declared {
                is_important,
                specificity,
                value: Some(value),
            }
        };
    }
    if current_specificity != specificity {
        return if current_specificity > specificity {
            current
        } else {
            CardBooleanState::Declared {
                is_important,
                specificity,
                value: Some(value),
            }
        };
    }
    CardBooleanState::Declared {
        is_important,
        specificity,
        value: (current_value == Some(value)).then_some(value),
    }
}
