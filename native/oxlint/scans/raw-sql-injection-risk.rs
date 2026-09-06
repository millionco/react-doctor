use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "Code uses a raw SQL escape hatch or string-built query shape that can bypass parameter binding.";

static QUERY_RAW_UNSAFE_PATTERN: Lazy<Regex> = lazy_regex!(r"\$queryRawUnsafe\s*\(");
static EXECUTE_RAW_UNSAFE_PATTERN: Lazy<Regex> = lazy_regex!(r"\$executeRawUnsafe\s*\(");
static PRISMA_RAW_PATTERN: Lazy<Regex> = lazy_regex!(r"(?-u:\b)Prisma\.raw\s*\(");
static SQL_RAW_PATTERN: Lazy<Regex> = lazy_regex!(r"(?-u:\b)sql\.\s*(?:raw|unsafe)\s*\(");
static QUERY_RECEIVER_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i-u:\b(?:client|pool|conn)\.query)");
static QUERY_METHOD_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i-u:\.query)");
static RAW_METHOD_PATTERN: Lazy<Regex> = lazy_regex!(r"\.(?:where|orderBy|having)Raw\s*\(");
static CURSOR_F_STRING_PATTERN: Lazy<Regex> =
    lazy_regex!(r#"(?-u:\b)cursor\.execute\s*\(\s*f['\"]"#);
static CURSOR_STRING_BUILD_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?-u:\b)cursor\.execute\s*\(\s*(?:\"[^\"]{0,400}\"|'[^']{0,400}')\s*(?:%|\.format\s*\(|\+)"#
);
static SESSION_F_STRING_PATTERN: Lazy<Regex> =
    lazy_regex!(r#"(?-u:\b)(?:engine|session)\.execute\s*\(\s*(?:text\s*\(\s*)?f['\"]"#);
static PHP_QUERY_BUILD_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"\$[A-Za-z0-9_]+->(?:query|exec|prepare|executeQuery|executeStatement|createQuery|createNativeQuery)\s*\(\s*(?:\"[^\"]{0,400}\"|'[^']{0,400}')\s*\.\s*\$"#
);
static MYSQLI_QUERY_BUILD_PATTERN: Lazy<Regex> =
    lazy_regex!(r#"mysqli_query\s*\(\s*[^,]+,\s*(?:\"[^\"]{0,400}\"|'[^']{0,400}')\s*\.\s*\$"#);
static SQL_ESCAPER_CALLEE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u)^(?:[A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*\.escape(?:Id|Literal|Identifier)|(?:[A-Za-z0-9_$]+\.)*(?:connection|conn|client|pool|db|mysql|sqlstring|knex)\.escape)"
);
pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_script_source_path(relative_path) {
        return Vec::new();
    }
    let comment_stripped =
        super::strip_comments_preserving_positions::strip_comments_preserving_positions(source);
    let scannable =
        super::normalize_js_regex_content::normalize_js_regex_content(&comment_stripped);
    let Some((start, _)) = raw_sql_first_match(&scannable) else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, &scannable, start);
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}

fn raw_sql_first_match(source: &str) -> Option<(usize, usize)> {
    if let Some(found) = QUERY_RAW_UNSAFE_PATTERN.find(source) {
        return Some((found.start(), found.end()));
    }
    if let Some(found) = EXECUTE_RAW_UNSAFE_PATTERN.find(source) {
        return Some((found.start(), found.end()));
    }
    if let Some(found) = raw_sql_first_dynamic_raw_call(source, &PRISMA_RAW_PATTERN) {
        return Some(found);
    }
    if let Some(found) = raw_sql_first_dynamic_raw_call(source, &SQL_RAW_PATTERN) {
        return Some(found);
    }
    if let Some(found) = raw_sql_first_interpolated_query(source) {
        return Some(found);
    }
    if let Some(found) = raw_sql_first_unsafe_query_concat(source) {
        return Some(found);
    }
    if let Some(found) = raw_sql_first_dynamic_raw_call(source, &RAW_METHOD_PATTERN) {
        return Some(found);
    }
    for pattern in [
        &*CURSOR_F_STRING_PATTERN,
        &*CURSOR_STRING_BUILD_PATTERN,
        &*SESSION_F_STRING_PATTERN,
        &*PHP_QUERY_BUILD_PATTERN,
        &*MYSQLI_QUERY_BUILD_PATTERN,
    ] {
        if let Some(found) = pattern.find(source) {
            return Some((found.start(), found.end()));
        }
    }
    None
}

fn raw_sql_first_dynamic_raw_call(source: &str, pattern: &Regex) -> Option<(usize, usize)> {
    pattern.find_iter(source).find_map(|found| {
        (!raw_sql_has_safe_literal_argument(source, found.end()))
            .then_some((found.start(), found.end()))
    })
}

fn raw_sql_has_safe_literal_argument(source: &str, start: usize) -> bool {
    let cursor = raw_sql_skip_whitespace(source, start);
    let Some(delimiter) = source.as_bytes().get(cursor).copied() else {
        return false;
    };
    if matches!(delimiter, b'\'' | b'"') {
        let mut end = cursor + 1;
        while let Some(byte) = source.as_bytes().get(end).copied() {
            if byte == b'\n' || matches!(byte, b'\'' | b'"') {
                if byte != delimiter {
                    return false;
                }
                let after_literal = raw_sql_skip_whitespace(source, end + 1);
                return matches!(source.as_bytes().get(after_literal), Some(b',' | b')'));
            }
            end += 1;
        }
        return false;
    }
    if delimiter != b'`' {
        return false;
    }
    let mut end = cursor + 1;
    while let Some(byte) = source.as_bytes().get(end).copied() {
        if byte == b'$' {
            return false;
        }
        if byte == b'`' {
            return true;
        }
        end += 1;
    }
    false
}

fn raw_sql_first_interpolated_query(source: &str) -> Option<(usize, usize)> {
    for found in QUERY_RECEIVER_PATTERN.find_iter(source) {
        let mut cursor = raw_sql_skip_whitespace(source, found.end());
        if source.as_bytes().get(cursor) != Some(&b'(') {
            continue;
        }
        cursor = raw_sql_skip_whitespace(source, cursor + 1);
        if !matches!(source.as_bytes().get(cursor), Some(b'\'' | b'"' | b'`')) {
            continue;
        }
        cursor = raw_sql_skip_whitespace(source, cursor + 1);
        let Some(keyword_end) = raw_sql_query_keyword_end(source, cursor) else {
            continue;
        };
        let mut interpolation = None;
        let mut search_cursor = keyword_end;
        let mut code_units = 0;
        while search_cursor < source.len() && code_units <= 400 {
            if source.as_bytes().get(search_cursor) == Some(&b')') {
                break;
            }
            if source.as_bytes().get(search_cursor..search_cursor + 2) == Some(b"${")
                && !raw_sql_interpolation_is_sanitized(source, search_cursor + 2)
            {
                interpolation = Some(search_cursor + 2);
            }
            let character = source[search_cursor..].chars().next()?;
            code_units += character.len_utf16();
            search_cursor += character.len_utf8();
        }
        if let Some(end) = interpolation {
            return Some((found.start(), end));
        }
    }
    None
}

fn raw_sql_query_keyword_end(source: &str, start: usize) -> Option<usize> {
    for keyword in ["SELECT", "INSERT", "UPDATE", "DELETE"] {
        let end = start.checked_add(keyword.len())?;
        let Some(candidate) = source.get(start..end) else {
            continue;
        };
        if candidate.eq_ignore_ascii_case(keyword)
            && source
                .as_bytes()
                .get(end)
                .is_none_or(|byte| !byte.is_ascii_alphanumeric() && *byte != b'_')
        {
            return Some(end);
        }
    }
    None
}

fn raw_sql_interpolation_is_sanitized(source: &str, start: usize) -> bool {
    let token_start = raw_sql_skip_whitespace(source, start);
    let mut token_end = token_start;
    while source
        .as_bytes()
        .get(token_end)
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | b'.'))
    {
        token_end += 1;
    }
    let token = &source[token_start..token_end];
    let last_segment = token.rsplit('.').next().unwrap_or(token);
    let lowercase_segment = last_segment.to_ascii_lowercase();
    let has_sanitizer_name = ["sanitiz", "escape", "quote"]
        .iter()
        .any(|part| lowercase_segment.contains(part));
    has_sanitizer_name
        && source
            .as_bytes()
            .get(raw_sql_skip_whitespace(source, token_end))
            == Some(&b'(')
}

fn raw_sql_first_unsafe_query_concat(source: &str) -> Option<(usize, usize)> {
    for found in QUERY_METHOD_PATTERN.find_iter(source) {
        let mut cursor = raw_sql_skip_whitespace(source, found.end());
        if source.as_bytes().get(cursor) != Some(&b'(') {
            continue;
        }
        cursor = raw_sql_skip_whitespace(source, cursor + 1);
        let Some(literal_end) = raw_sql_literal_operand_end(source, cursor) else {
            continue;
        };
        cursor = literal_end;
        loop {
            cursor = raw_sql_skip_whitespace(source, cursor);
            if source.as_bytes().get(cursor) != Some(&b'+') {
                break;
            }
            let operand_start = cursor + 1;
            let Some(safe_end) = raw_sql_safe_concat_operand_end(source, operand_start) else {
                return Some((found.start(), cursor + 1));
            };
            cursor = safe_end;
        }
    }
    None
}

fn raw_sql_safe_concat_operand_end(source: &str, start: usize) -> Option<usize> {
    let mut cursor = raw_sql_skip_whitespace(source, start);
    let has_open_parenthesis = source.as_bytes().get(cursor) == Some(&b'(');
    if has_open_parenthesis {
        cursor = raw_sql_skip_whitespace(source, cursor + 1);
    }
    let operand_end = raw_sql_literal_operand_end(source, cursor)
        .or_else(|| raw_sql_escaper_call_end(source, cursor))?;
    cursor = raw_sql_skip_whitespace(source, operand_end);
    if source.as_bytes().get(cursor) == Some(&b')') {
        cursor += 1;
    }
    Some(cursor)
}

fn raw_sql_literal_operand_end(source: &str, start: usize) -> Option<usize> {
    let delimiter = *source.as_bytes().get(start)?;
    if !matches!(delimiter, b'\'' | b'"' | b'`') {
        return None;
    }
    let mut cursor = start + 1;
    let mut code_units = 0;
    while cursor < source.len() && code_units <= 200 {
        let byte = source.as_bytes()[cursor];
        if byte == b'\n' || (delimiter == b'`' && byte == b'$') {
            return None;
        }
        if byte == delimiter {
            return (code_units <= 200).then_some(cursor + 1);
        }
        let character = source[cursor..].chars().next()?;
        code_units += character.len_utf16();
        cursor += character.len_utf8();
    }
    None
}

fn raw_sql_escaper_call_end(source: &str, start: usize) -> Option<usize> {
    let callee = SQL_ESCAPER_CALLEE_PATTERN.find(&source[start..])?;
    let mut cursor = raw_sql_skip_whitespace(source, start + callee.end());
    if source.as_bytes().get(cursor) != Some(&b'(') {
        return None;
    }
    cursor += 1;
    let mut code_units = 0;
    while cursor < source.len() && code_units <= 200 {
        let byte = source.as_bytes()[cursor];
        if byte == b'(' {
            return None;
        }
        if byte == b')' {
            return (code_units <= 200).then_some(cursor + 1);
        }
        let character = source[cursor..].chars().next()?;
        code_units += character.len_utf16();
        cursor += character.len_utf8();
    }
    None
}

fn raw_sql_skip_whitespace(source: &str, start: usize) -> usize {
    let mut cursor = start;
    while let Some(character) = source.get(cursor..).and_then(|text| text.chars().next()) {
        if !is_js_whitespace(character) {
            break;
        }
        cursor += character.len_utf8();
    }
    cursor
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
