static BORDER_WIDTH_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> = lazy_regex::lazy_regex!(
    r"^border(?:-([trblxy]))?(?:-(px|[0-9]+(?:\.[0-9]+)?|\[[0-9]+(?:\.[0-9]+)?px\]))?$"
);
static BORDER_STYLE_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> =
    lazy_regex::lazy_regex!(r"^border(?:-([trblxy]))?-(hidden|none|solid|dashed|dotted|double)$");
static BORDER_COLOR_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> =
    lazy_regex::lazy_regex!(r"^border(?:-([trblxy]))?-(.+)$");

fn has_visible_tailwind_border(tokens: &[&str]) -> bool {
    let mut width_by_edge = make_tailwind_border_edge_states(false);
    let mut style_by_edge = make_tailwind_border_edge_states(true);
    let mut color_by_edge = make_tailwind_border_edge_states(true);
    let mut opacity_by_edge = make_tailwind_border_edge_states(true);
    for token in tokens {
        if let Some(captures) = BORDER_WIDTH_PATTERN.captures(token) {
            let direction = captures.get(1).map(|capture| capture.as_str());
            let length = captures.get(2).map(|capture| capture.as_str());
            let has_width = length.is_none_or(|length| {
                length == "px"
                    || parse_tailwind_border_length(length).is_some_and(|length| length > 0.0)
            });
            update_tailwind_border_edges(&mut width_by_edge, direction, has_width);
            continue;
        }
        if let Some(captures) = BORDER_STYLE_PATTERN.captures(token) {
            let direction = captures.get(1).map(|capture| capture.as_str());
            let style = captures.get(2).map_or("", |capture| capture.as_str());
            update_tailwind_border_edges(
                &mut style_by_edge,
                direction,
                !matches!(style, "hidden" | "none"),
            );
            continue;
        }
        let Some(captures) = BORDER_COLOR_PATTERN.captures(token) else {
            continue;
        };
        let direction = captures.get(1).map(|capture| capture.as_str());
        let color = captures.get(2).map_or("", |capture| capture.as_str());
        if color.starts_with("opacity-") {
            update_tailwind_border_edges(&mut opacity_by_edge, direction, color != "opacity-0");
            continue;
        }
        if color.starts_with("spacing-") || matches!(color, "collapse" | "separate") {
            continue;
        }
        update_tailwind_border_edges(
            &mut color_by_edge,
            direction,
            color != "transparent" && !color.ends_with("/0"),
        );
    }
    (0..4).any(|edge| {
        width_by_edge[edge].value == Some(true)
            && style_by_edge[edge].value == Some(true)
            && color_by_edge[edge].value == Some(true)
            && opacity_by_edge[edge].value == Some(true)
    })
}

fn make_tailwind_border_edge_states(value: bool) -> [EffectiveTailwindBooleanState; 4] {
    [EffectiveTailwindBooleanState {
        is_declared: false,
        specificity: 0,
        value: Some(value),
    }; 4]
}

fn parse_tailwind_border_length(value: &str) -> Option<f64> {
    value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix("px]"))
        .unwrap_or(value)
        .parse::<f64>()
        .ok()
}

fn update_tailwind_border_edges(
    states: &mut [EffectiveTailwindBooleanState; 4],
    direction: Option<&str>,
    value: bool,
) {
    let specificity = match direction {
        None => 0,
        Some("x" | "y") => 1,
        Some(_) => 2,
    };
    for edge in tailwind_border_edges(direction) {
        states[*edge] = update_effective_tailwind_boolean_state(states[*edge], value, specificity);
    }
}
