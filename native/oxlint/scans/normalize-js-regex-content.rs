use std::borrow::Cow;

pub fn normalize_js_regex_content(source: &str) -> Cow<'_, str> {
    if source.is_ascii() {
        return Cow::Borrowed(source);
    }
    let mut bytes = source.as_bytes().to_vec();
    for (start, character) in source.char_indices() {
        if character == '\u{0085}' {
            bytes[start + 1] = 0x80;
        } else if character == '\u{FEFF}' {
            bytes[start..start + 3].copy_from_slice("\u{2000}".as_bytes());
        } else if character.len_utf16() == 2 {
            bytes[start..start + 4].copy_from_slice(&[0xC2, 0x80, 0xC2, 0x80]);
        } else if !is_javascript_regex_whitespace(character) && !character.is_ascii() {
            match character.len_utf8() {
                2 => bytes[start..start + 2].copy_from_slice("\u{0080}".as_bytes()),
                3 => bytes[start..start + 3].copy_from_slice("\u{200B}".as_bytes()),
                _ => {}
            }
        }
    }
    Cow::Owned(String::from_utf8(bytes).unwrap_or_else(|_| source.to_string()))
}

fn is_javascript_regex_whitespace(character: char) -> bool {
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

#[cfg(test)]
mod tests {
    use super::normalize_js_regex_content;

    #[test]
    fn preserves_offsets_while_aligning_javascript_regex_semantics() {
        let source = "\u{0085}\u{017F}\u{212A}\u{FEFF}\u{1F642}";
        let normalized = normalize_js_regex_content(source);

        assert_eq!(normalized.len(), source.len());
        assert_eq!(normalized.chars().count(), source.encode_utf16().count());
        assert_eq!(
            normalized,
            "\u{0080}\u{0080}\u{200B}\u{2000}\u{0080}\u{0080}"
        );
    }

    #[test]
    fn makes_non_ascii_bmp_characters_non_word_without_changing_offsets() {
        let source = "édocument.write Katex";
        let normalized = normalize_js_regex_content(source);

        assert_eq!(normalized.len(), source.len());
        assert_eq!(normalized.chars().count(), source.encode_utf16().count());
        assert_eq!(normalized, "\u{0080}document.write \u{200B}atex");
    }
}
