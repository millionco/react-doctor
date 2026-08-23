fn is_pure_black_color(value: &str) -> bool {
    let normalized_value = value
        .trim_matches(|character| is_js_whitespace(character))
        .to_ascii_lowercase();
    if normalized_value == "#000" || normalized_value == "#000000" {
        return true;
    }
    let Some(rgb_components) = normalized_value
        .strip_prefix("rgb(")
        .and_then(|value| value.strip_suffix(')'))
    else {
        return false;
    };
    let mut components = rgb_components.split(',');
    (0..3).all(|_| {
        components.next().is_some_and(|component| {
            component.trim_matches(|character| is_js_whitespace(character)) == "0"
        })
    }) && components.next().is_none()
}
