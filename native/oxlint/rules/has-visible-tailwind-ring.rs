static TAILWIND_RING_WIDTH_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> =
    lazy_regex::lazy_regex!(r"^ring(?:-(px|[0-9.]+|\[[0-9.]+px\]))?$");

fn has_visible_tailwind_ring(tokens: &[&str]) -> bool {
    let mut width_state = EffectiveTailwindBooleanState {
        is_declared: false,
        is_important: false,
        specificity: 0,
        value: Some(false),
    };
    let mut color_state = EffectiveTailwindBooleanState {
        is_declared: false,
        is_important: false,
        specificity: 0,
        value: Some(true),
    };
    let mut opacity_state = EffectiveTailwindBooleanState {
        is_declared: false,
        is_important: false,
        specificity: 0,
        value: Some(true),
    };
    for marked_token in tokens {
        let (is_important, token) = tailwind_token_priority(marked_token);
        if let Some(captures) = TAILWIND_RING_WIDTH_PATTERN.captures(token) {
            let width = captures.get(1).map(|capture| capture.as_str());
            let has_width = width.is_none_or(|width| {
                width == "px" || parse_tailwind_ring_width(width).is_some_and(|width| width > 0.0)
            });
            width_state =
                update_effective_tailwind_boolean_state(width_state, has_width, is_important, 0);
            continue;
        }
        if token == "ring-opacity-0" {
            opacity_state =
                update_effective_tailwind_boolean_state(opacity_state, false, is_important, 0);
            continue;
        }
        if token.starts_with("ring-opacity-") {
            opacity_state =
                update_effective_tailwind_boolean_state(opacity_state, true, is_important, 0);
            continue;
        }
        if token == "ring-transparent" || token.starts_with("ring-") && token.ends_with("/0") {
            color_state =
                update_effective_tailwind_boolean_state(color_state, false, is_important, 0);
            continue;
        }
        if token.starts_with("ring-") && !token.starts_with("ring-offset-") && token != "ring-inset"
        {
            color_state =
                update_effective_tailwind_boolean_state(color_state, true, is_important, 0);
        }
    }
    width_state.value == Some(true)
        && color_state.value == Some(true)
        && opacity_state.value == Some(true)
}

fn parse_tailwind_ring_width(value: &str) -> Option<f64> {
    let value = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix("px]"))
        .unwrap_or(value);
    let mut did_see_digit = false;
    let mut did_see_decimal_point = false;
    let mut end = 0;
    for (index, byte) in value.bytes().enumerate() {
        if byte.is_ascii_digit() {
            did_see_digit = true;
            end = index + 1;
            continue;
        }
        if byte == b'.' && !did_see_decimal_point {
            did_see_decimal_point = true;
            end = index + 1;
            continue;
        }
        break;
    }
    if !did_see_digit {
        return None;
    }
    value[..end].parse::<f64>().ok()
}
