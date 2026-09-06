fn tailwind_top_level_character_indices(
    value: &str,
    predicate: impl Fn(char) -> bool,
) -> Vec<usize> {
    let mut character_indices = Vec::new();
    let mut bracket_depth = 0_u32;
    let mut parenthesis_depth = 0_u32;
    let mut quote = None;
    let mut is_escaped = false;
    for (character_index, character) in value.char_indices() {
        if is_escaped {
            is_escaped = false;
            continue;
        }
        if character == '\\' {
            is_escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            }
            continue;
        }
        if character == '"' || character == '\'' {
            quote = Some(character);
            continue;
        }
        match character {
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            '(' => parenthesis_depth += 1,
            ')' => parenthesis_depth = parenthesis_depth.saturating_sub(1),
            _ => {}
        }
        if bracket_depth == 0 && parenthesis_depth == 0 && predicate(character) {
            character_indices.push(character_index);
        }
    }
    character_indices
}
