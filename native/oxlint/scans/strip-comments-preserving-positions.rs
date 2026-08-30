use oxc_syntax::identifier::is_identifier_part;

const REGEX_PRECEDING_KEYWORDS: &[&str] = &[
    "return",
    "typeof",
    "case",
    "in",
    "of",
    "new",
    "delete",
    "void",
    "instanceof",
    "do",
    "else",
    "yield",
    "await",
    "throw",
];

pub fn strip_comments_preserving_positions(source: &str) -> String {
    if !source.contains("//") && !source.contains("/*") {
        return source.to_string();
    }

    let mut output = source.as_bytes().to_vec();
    let mut cursor = 0;
    let mut string_delimiter = None;
    while cursor < source.len() {
        let byte = source.as_bytes()[cursor];
        if let Some(delimiter) = string_delimiter {
            if byte == b'\\' {
                cursor = (cursor + 2).min(source.len());
                continue;
            }
            if byte == delimiter {
                string_delimiter = None;
                cursor += 1;
                continue;
            }
            if byte == b'\n' && delimiter != b'`' {
                string_delimiter = None;
            }
            cursor += source[cursor..].chars().next().map_or(1, char::len_utf8);
            continue;
        }
        if matches!(byte, b'\'' | b'"' | b'`') {
            string_delimiter = Some(byte);
            cursor += 1;
            continue;
        }
        if byte != b'/' {
            cursor += source[cursor..].chars().next().map_or(1, char::len_utf8);
            continue;
        }
        if source.as_bytes().get(cursor + 1) == Some(&b'/') {
            let end = source.as_bytes()[cursor..]
                .iter()
                .position(|candidate| *candidate == b'\n')
                .map_or(source.len(), |offset| cursor + offset);
            blank_range(&mut output, source, cursor, end);
            cursor = end;
            continue;
        }
        if source.as_bytes().get(cursor + 1) == Some(&b'*') {
            let end = source.as_bytes()[cursor + 2..]
                .windows(2)
                .position(|window| window == b"*/")
                .map_or(source.len(), |offset| cursor + offset + 4);
            blank_range(&mut output, source, cursor, end);
            cursor = end;
            continue;
        }
        if is_regex_literal_start(source, &output, cursor)
            && let Some(regex_end) = find_regex_literal_end(source, cursor)
        {
            cursor = regex_end;
            continue;
        }
        cursor += 1;
    }
    String::from_utf8(output).unwrap_or_else(|_| source.to_string())
}

fn is_regex_literal_start(source: &str, output: &[u8], slash_index: usize) -> bool {
    let output_text = std::str::from_utf8(output).unwrap_or(source);
    let Some((previous_index, previous_character)) = output_text[..slash_index]
        .char_indices()
        .rev()
        .find(|(_, character)| !is_js_whitespace(*character))
    else {
        return true;
    };
    let character_before = output_text[..previous_index].chars().next_back();
    if is_identifier_continue(previous_character) {
        let word_start = output_text[..previous_index]
            .char_indices()
            .rev()
            .take_while(|(_, character)| is_identifier_continue(*character))
            .last()
            .map_or(previous_index, |(index, _)| index);
        if word_start > 0 && output_text[..word_start].chars().next_back() == Some('.') {
            return false;
        }
        return REGEX_PRECEDING_KEYWORDS
            .contains(&&source[word_start..previous_index + previous_character.len_utf8()]);
    }
    if previous_character == '<' {
        return false;
    }
    if previous_character == '>' {
        return character_before == Some('=');
    }
    if matches!(previous_character, '+' | '-') {
        return character_before != Some(previous_character);
    }
    if previous_character == '!' {
        return !character_before.is_some_and(|character| {
            is_identifier_continue(character) || matches!(character, ')' | ']')
        });
    }
    !matches!(previous_character, ')' | ']' | '}' | '"' | '\'' | '`')
}

fn find_regex_literal_end(source: &str, slash_index: usize) -> Option<usize> {
    let mut cursor = slash_index + 1;
    let mut is_inside_character_class = false;
    while cursor < source.len() {
        let character = source[cursor..].chars().next()?;
        if character == '\\' {
            cursor += character.len_utf8();
            if let Some(escaped) = source.get(cursor..).and_then(|text| text.chars().next()) {
                cursor += escaped.len_utf8();
            }
            continue;
        }
        if character == '\n' {
            return None;
        }
        if character == '[' {
            is_inside_character_class = true;
        } else if character == ']' {
            is_inside_character_class = false;
        } else if character == '/' && !is_inside_character_class {
            let end = cursor + 1;
            return (source.as_bytes().get(end) != Some(&b'/')).then_some(end);
        }
        cursor += character.len_utf8();
    }
    None
}

fn is_identifier_continue(character: char) -> bool {
    is_identifier_part(character)
}

fn is_js_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}' | '\u{000B}' | '\u{000C}' | '\u{0020}' | '\u{00A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    ) || character == '\n'
        || character == '\r'
}

fn blank_range(output: &mut [u8], source: &str, start: usize, end: usize) {
    for (relative_index, character) in source[start..end].char_indices() {
        if character == '\n' {
            continue;
        }
        let character_start = start + relative_index;
        let character_end = character_start + character.len_utf8();
        let replacement = match character.len_utf8() {
            1 => " ",
            2 => "\u{00A0}",
            3 => "\u{2000}",
            4 => "\u{00A0}\u{00A0}",
            _ => unreachable!(),
        };
        output[character_start..character_end].copy_from_slice(replacement.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::strip_comments_preserving_positions;

    #[test]
    fn preserves_utf16_length_while_blanking_comments() {
        let source = "before /* a\u{00E9}\u{0800}\u{1F642} */ after";
        let stripped = strip_comments_preserving_positions(source);

        assert_eq!(stripped.len(), source.len());
        assert_eq!(
            stripped.encode_utf16().count(),
            source.encode_utf16().count()
        );
        assert!(stripped.starts_with("before "));
        assert!(stripped.ends_with(" after"));
    }
}
