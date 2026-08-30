pub fn get_location_at_index(
    original_content: &str,
    position_preserving_content: &str,
    byte_index: usize,
) -> (usize, usize) {
    let bounded_index = byte_index.min(original_content.len());
    let mut line = 1;
    let mut column = 1;
    let mut previous_was_carriage_return = false;

    for (character_byte_index, character) in original_content[..bounded_index].char_indices() {
        let character_end = character_byte_index + character.len_utf8();
        let is_preserved = original_content.as_bytes()[character_byte_index..character_end]
            == position_preserving_content.as_bytes()[character_byte_index..character_end];
        if character == '\n' && previous_was_carriage_return && is_preserved {
            previous_was_carriage_return = false;
            continue;
        }
        if is_preserved && matches!(character, '\r' | '\n' | '\u{2028}' | '\u{2029}') {
            line += 1;
            column = 1;
            previous_was_carriage_return = character == '\r';
            continue;
        }
        previous_was_carriage_return = false;
        column += character.len_utf16();
    }

    (line, column)
}
