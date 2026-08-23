fn collect_axis_shorthand_values(class_name_value: &str, axis_prefix: &str) -> Vec<String> {
    let mut values = Vec::new();
    for (start_index, character) in class_name_value.char_indices() {
        if start_index > 0 {
            let previous_character = class_name_value[..start_index].chars().next_back();
            if !previous_character.is_some_and(char::is_whitespace) {
                continue;
            }
        }
        if character.is_whitespace() {
            continue;
        }
        if let Some(value) = get_axis_shorthand_value(&class_name_value[start_index..], axis_prefix)
        {
            values.push(value);
        }
    }
    values
}

fn get_axis_shorthand_value(class_token: &str, axis_prefix: &str) -> Option<String> {
    let (sign, unsigned_token) = class_token
        .strip_prefix('-')
        .map_or(("", class_token), |value| ("-", value));
    let value_with_suffix = unsigned_token.strip_prefix(axis_prefix)?.strip_prefix('-')?;
    let value_end_index = if value_with_suffix.starts_with('[') {
        value_with_suffix.find(']')? + 1
    } else {
        get_numeric_axis_value_end_index(value_with_suffix)?
    };
    let suffix = &value_with_suffix[value_end_index..];
    if !suffix.is_empty()
        && !suffix.starts_with(':')
        && !suffix.chars().next().is_some_and(char::is_whitespace)
    {
        return None;
    }
    Some(format!("{sign}{}", &value_with_suffix[..value_end_index]))
}

fn get_numeric_axis_value_end_index(value: &str) -> Option<usize> {
    let mut byte_index = 0;
    while value
        .as_bytes()
        .get(byte_index)
        .is_some_and(u8::is_ascii_digit)
    {
        byte_index += 1;
    }
    if byte_index == 0 {
        return None;
    }
    if value.as_bytes().get(byte_index) == Some(&b'.') {
        let decimal_start_index = byte_index + 1;
        byte_index = decimal_start_index;
        while value
            .as_bytes()
            .get(byte_index)
            .is_some_and(u8::is_ascii_digit)
        {
            byte_index += 1;
        }
        if byte_index == decimal_start_index {
            return None;
        }
    }
    Some(byte_index)
}
