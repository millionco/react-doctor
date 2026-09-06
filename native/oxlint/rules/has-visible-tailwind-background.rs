fn has_visible_tailwind_background(tokens: &[&str]) -> bool {
    let mut color_state = EffectiveTailwindBooleanState {
        is_declared: false,
        is_important: false,
        specificity: 0,
        value: Some(false),
    };
    let mut opacity_state = EffectiveTailwindBooleanState {
        is_declared: false,
        is_important: false,
        specificity: 0,
        value: Some(true),
    };
    for marked_token in tokens {
        let (is_important, token) = tailwind_token_priority(marked_token);
        if token.starts_with("bg-opacity-") {
            opacity_state = update_effective_tailwind_boolean_state(
                opacity_state,
                token != "bg-opacity-0",
                is_important,
                0,
            );
            continue;
        }
        if token != "bg-transparent"
            && (!token.starts_with("bg-") || is_non_surface_tailwind_background(token))
        {
            continue;
        }
        let is_transparent = matches!(token, "bg-transparent" | "bg-[transparent]")
            || token
                .strip_prefix("bg-")
                .and_then(|value| value.strip_suffix("/0"))
                .is_some_and(|value| !value.is_empty());
        color_state =
            update_effective_tailwind_boolean_state(color_state, !is_transparent, is_important, 0);
    }
    color_state.value == Some(true) && opacity_state.value == Some(true)
}

fn is_non_surface_tailwind_background(token: &str) -> bool {
    let Some(value) = token.strip_prefix("bg-") else {
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
