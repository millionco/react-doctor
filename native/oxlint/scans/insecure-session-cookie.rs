use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{
    ScanFinding, get_location_at_index::get_location_at_index, scan_content::ScanContent,
};

const MESSAGE: &str = "An auth/session cookie is exposed to JavaScript (set via document.cookie, with httpOnly: false, or without cookie options), letting an XSS payload steal it.";

static COOKIE_SET_CALL_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:\.cookies\.set|cookies\(\s*\)\.set|\.cookie)\s*\(");
static HTTP_ONLY_DISABLED_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)httpOnly\s*:\s*false\b");
static COOKIE_CONFIG_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)cookie\s*:\s*\{");
static CLIENT_COOKIE_WRITE_PATTERN: Lazy<Regex> =
    lazy_regex!(r#"(?i)document\.cookie\s*=\s*[`"']"#);

pub fn scan(relative_path: &str, source: &ScanContent<'_>) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path) {
        return Vec::new();
    }
    let content = source.normalized_scannable(false);
    if !content.to_ascii_lowercase().contains("cookie") {
        return Vec::new();
    }
    let mut findings = Vec::new();
    for found in COOKIE_SET_CALL_PATTERN.find_iter(&content) {
        let open_paren = found.end() - 1;
        let Some((literal_start, literal_end)) = first_string_literal(&content, found.end()) else {
            continue;
        };
        let cookie_name_literal = &content[literal_start + 1..literal_end - 1];
        if cookie_name_literal
            .chars()
            .any(|character| matches!(character, '\'' | '"' | '`'))
            || !has_auth_cookie_name(cookie_name_literal)
        {
            continue;
        }
        let Some(close_paren) =
            super::find_matching_bracket::find_matching_bracket(&content, open_paren)
        else {
            continue;
        };
        let arguments = &content[open_paren + 1..close_paren];
        let has_no_options = count_top_level_arguments(arguments) < 3;
        let arguments_without_strings = blank_string_contents(arguments);
        if !has_no_options && !HTTP_ONLY_DISABLED_PATTERN.is_match(&arguments_without_strings) {
            continue;
        }
        findings.push(finding(source, &content, found.start()));
    }

    let blanked_content = blank_string_contents(&content);
    for found in COOKIE_CONFIG_PATTERN.find_iter(&blanked_content) {
        let brace = found.end() - 1;
        let block_end =
            super::find_matching_bracket::find_matching_bracket(&blanked_content, brace)
                .unwrap_or_else(|| {
                    blanked_content[brace..]
                        .char_indices()
                        .nth(400)
                        .map_or(blanked_content.len(), |(offset, _)| brace + offset)
                });
        if HTTP_ONLY_DISABLED_PATTERN.is_match(&blanked_content[brace..block_end]) {
            findings.push(finding(source, &blanked_content, found.start()));
        }
    }

    for found in CLIENT_COOKIE_WRITE_PATTERN.find_iter(&content) {
        let quote_index = found.end() - 1;
        let Some((_, literal_end)) = first_string_literal(&content, quote_index) else {
            continue;
        };
        let literal = &content[quote_index + 1..literal_end - 1];
        let Some(equals_index) = literal.find('=') else {
            continue;
        };
        let cookie_name = &literal[..equals_index];
        if !cookie_name
            .chars()
            .any(|character| matches!(character, ';' | '\'' | '"' | '`'))
            && has_auth_cookie_name(cookie_name)
        {
            findings.push(finding(source, &content, found.start()));
        }
    }
    findings
}

fn first_string_literal(content: &str, start: usize) -> Option<(usize, usize)> {
    let literal_start = content[start..]
        .char_indices()
        .find(|(_, character)| !character.is_whitespace())
        .map(|(offset, _)| start + offset)?;
    let delimiter = *content.as_bytes().get(literal_start)?;
    if !matches!(delimiter, b'\'' | b'"' | b'`') {
        return None;
    }
    let mut cursor = literal_start + 1;
    while cursor < content.len() {
        let byte = content.as_bytes()[cursor];
        if byte == b'\\' {
            cursor = escaped_character_end(content, cursor);
        } else if byte == delimiter {
            return Some((literal_start, cursor + 1));
        } else {
            cursor += content[cursor..].chars().next().map_or(1, char::len_utf8);
        }
    }
    None
}

fn has_auth_cookie_name(cookie_name: &str) -> bool {
    let lowercase = cookie_name.to_ascii_lowercase();
    [
        "session",
        "sess",
        "sid",
        "connect.sid",
        "auth",
        "jwt",
        "access_token",
        "access-token",
        "accesstoken",
        "refresh_token",
        "refresh-token",
        "refreshtoken",
        "id_token",
        "id-token",
        "idtoken",
    ]
    .iter()
    .any(|candidate| {
        lowercase.match_indices(candidate).any(|(index, _)| {
            let before = lowercase[..index].chars().next_back();
            let after = lowercase[index + candidate.len()..].chars().next();
            !before.is_some_and(|character| character.is_ascii_alphanumeric())
                && !after.is_some_and(|character| character.is_ascii_alphanumeric())
        })
    })
}

fn count_top_level_arguments(arguments: &str) -> usize {
    if arguments.trim().is_empty() {
        return 0;
    }
    let mut depth = 0isize;
    let mut delimiter = None;
    let mut count = 1usize;
    let mut cursor = 0;
    while cursor < arguments.len() {
        let byte = arguments.as_bytes()[cursor];
        if let Some(active_delimiter) = delimiter {
            if byte == b'\\' {
                cursor = escaped_character_end(arguments, cursor);
                continue;
            }
            if byte == active_delimiter {
                delimiter = None;
            }
        } else if matches!(byte, b'\'' | b'"' | b'`') {
            delimiter = Some(byte);
        } else if matches!(byte, b'(' | b'[' | b'{') {
            depth += 1;
        } else if matches!(byte, b')' | b']' | b'}') {
            depth -= 1;
        } else if byte == b',' && depth == 0 {
            count += 1;
        }
        cursor += arguments[cursor..].chars().next().map_or(1, char::len_utf8);
    }
    count
}

fn blank_string_contents(content: &str) -> String {
    let mut output = content.as_bytes().to_vec();
    let mut delimiter = None;
    let mut cursor = 0;
    while cursor < content.len() {
        let byte = content.as_bytes()[cursor];
        if let Some(active_delimiter) = delimiter {
            if byte == b'\\' {
                cursor = escaped_character_end(content, cursor);
                continue;
            }
            if byte == active_delimiter {
                delimiter = None;
            } else if byte != b'\n' {
                let character_end =
                    cursor + content[cursor..].chars().next().map_or(1, char::len_utf8);
                blank_bytes(&mut output, content, cursor, character_end);
                cursor = character_end;
                continue;
            }
        } else if matches!(byte, b'\'' | b'"' | b'`') {
            delimiter = Some(byte);
        }
        cursor += content[cursor..].chars().next().map_or(1, char::len_utf8);
    }
    String::from_utf8(output).unwrap_or_else(|_| content.to_string())
}

fn escaped_character_end(source: &str, backslash_index: usize) -> usize {
    let escaped_start = backslash_index + 1;
    source
        .get(escaped_start..)
        .and_then(|tail| tail.chars().next())
        .map_or(source.len(), |character| {
            escaped_start + character.len_utf8()
        })
}

fn blank_bytes(output: &mut [u8], source: &str, start: usize, end: usize) {
    for (offset, character) in source[start..end].char_indices() {
        let character_start = start + offset;
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

fn finding(original: &str, content: &str, index: usize) -> ScanFinding {
    let (line, column) = get_location_at_index(original, content, index);
    ScanFinding::inherited(MESSAGE, line, column)
}
