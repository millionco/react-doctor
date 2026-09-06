fn is_technical_label_text(text: &str) -> bool {
    if is_uppercase_technical_token(text) {
        return true;
    }
    let terminal_segments = text
        .split(" — ")
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    terminal_segments.len() > 1
        && terminal_segments.iter().all(|segment| {
            segment
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
                || is_uppercase_technical_token(segment)
                || is_delimited_technical_token(segment)
        })
}

fn is_uppercase_technical_token(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
        && bytes.all(|byte| {
            byte.is_ascii_uppercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'_' | b'.' | b':' | b'/' | b'-')
        })
}

fn is_delimited_technical_token(value: &str) -> bool {
    let mut has_delimiter = false;
    let mut segment_has_character = false;
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() {
            segment_has_character = true;
            continue;
        }
        if !matches!(byte, b'-' | b'_' | b'.' | b'/' | b':') || !segment_has_character {
            return false;
        }
        has_delimiter = true;
        segment_has_character = false;
    }
    has_delimiter && segment_has_character
}
