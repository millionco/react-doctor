fn normalize_tailwind_arbitrary_utility_value(value: &str) -> String {
    let mut normalized_value = String::with_capacity(value.len());
    let mut previous_character = None;
    for character in value.chars() {
        if character == '_' && previous_character != Some('\\') {
            normalized_value.push(' ');
        } else {
            normalized_value.push(character);
        }
        previous_character = Some(character);
    }
    normalized_value
}
