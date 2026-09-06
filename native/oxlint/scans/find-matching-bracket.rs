pub fn find_matching_bracket(source: &str, open_index: usize) -> Option<usize> {
    let opening = *source.as_bytes().get(open_index)?;
    let closing = match opening {
        b'(' => b')',
        b'[' => b']',
        b'{' => b'}',
        _ => return None,
    };
    let mut depth = 0usize;
    let mut delimiter = None;
    let mut cursor = open_index;
    while cursor < source.len() {
        let byte = source.as_bytes()[cursor];
        if let Some(active_delimiter) = delimiter {
            if byte == b'\\' {
                let escaped_start = cursor + 1;
                cursor = source
                    .get(escaped_start..)
                    .and_then(|tail| tail.chars().next())
                    .map_or(source.len(), |character| {
                        escaped_start + character.len_utf8()
                    });
                continue;
            }
            if byte == active_delimiter {
                delimiter = None;
            }
            cursor += source[cursor..].chars().next().map_or(1, char::len_utf8);
            continue;
        }
        if matches!(byte, b'\'' | b'"' | b'`') {
            delimiter = Some(byte);
        } else if byte == opening {
            depth += 1;
        } else if byte == closing {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return Some(cursor);
            }
        }
        cursor += source[cursor..].chars().next().map_or(1, char::len_utf8);
    }
    None
}
