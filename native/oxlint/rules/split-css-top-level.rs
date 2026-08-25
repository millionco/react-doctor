fn split_css_top_level(value: &str, separator: char) -> Option<Vec<&str>> {
    let mut parts = Vec::new();
    let mut depth = 0_i32;
    let mut part_start_index = 0;
    for (character_index, character) in value.char_indices() {
        if character == '(' {
            depth += 1;
        }
        if character == ')' {
            depth -= 1;
            if depth < 0 {
                return None;
            }
        }
        if character == separator && depth == 0 {
            parts.push(
                value[part_start_index..character_index]
                    .trim_matches(|character| is_js_whitespace(character)),
            );
            part_start_index = character_index + character.len_utf8();
        }
    }
    if depth != 0 {
        return None;
    }
    parts.push(
        value[part_start_index..].trim_matches(|character| is_js_whitespace(character)),
    );
    Some(parts)
}
