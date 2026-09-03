use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "JWT is configured with the 'none' algorithm, which disables signature verification, so any forged token is accepted.";

static JWT_EVIDENCE_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)\bjwt\b|jsonwebtoken|\bjose\b");
static NONE_ALGORITHM_PATTERN: Lazy<Regex> =
    lazy_regex!(r#"(?i)\b(?:alg|algorithms?)\s*:\s*\[?\s*["'`]none["'`]"#);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path) {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let content = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    if !JWT_EVIDENCE_PATTERN.is_match(&content) {
        return Vec::new();
    }
    let findings = NONE_ALGORITHM_PATTERN
        .find_iter(&content)
        .filter(|found| !is_inside_string_literal(&content, found.start()))
        .map(|found| {
            let (line, column) = get_location_at_index(source, &content, found.start());
            ScanFinding::inherited(MESSAGE, line, column)
        })
        .collect::<Vec<_>>();
    findings
}

fn is_inside_string_literal(content: &str, index: usize) -> bool {
    let mut delimiter = None;
    let mut template_expression_depths = Vec::<usize>::new();
    let mut cursor = 0;
    while cursor < index {
        let byte = content.as_bytes()[cursor];
        if delimiter == Some(b'`') {
            if byte == b'\\' {
                cursor = escaped_character_end(content, cursor).min(index);
            } else if byte == b'`' {
                delimiter = None;
                cursor += 1;
            } else if byte == b'$' && content.as_bytes().get(cursor + 1) == Some(&b'{') {
                template_expression_depths.push(0);
                delimiter = None;
                cursor += 2;
            } else {
                cursor += content[cursor..].chars().next().map_or(1, char::len_utf8);
            }
            continue;
        }
        if let Some(active_delimiter) = delimiter {
            if byte == b'\\' {
                cursor = escaped_character_end(content, cursor).min(index);
            } else {
                if byte == active_delimiter {
                    delimiter = None;
                }
                cursor += content[cursor..].chars().next().map_or(1, char::len_utf8);
            }
            continue;
        }
        if matches!(byte, b'\'' | b'"' | b'`') {
            delimiter = Some(byte);
        } else if let Some(depth) = template_expression_depths.last_mut() {
            if byte == b'{' {
                *depth += 1;
            } else if byte == b'}' {
                if *depth == 0 {
                    template_expression_depths.pop();
                    delimiter = Some(b'`');
                } else {
                    *depth -= 1;
                }
            }
        }
        cursor += content[cursor..].chars().next().map_or(1, char::len_utf8);
    }
    delimiter.is_some()
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
