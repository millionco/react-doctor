use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "Private or long-lived release key material appears in the repository.";

static TEST_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)(?:__fixtures__|__mocks__|__tests__|__integration__|fixtures|mocks|test|tests|testdata|test-data|e2e|playwright|cypress|specs?)(?:/|$)|^(?:test|spec)-[^/]+\.[cm]?[jt]sx?$|\.(?:test|spec|e2e|e2e-spec|integration-test|fixture|fixtures|stories|story)\.[cm]?[jt]sx?$|(?:^|/)(?:playwright|cypress|vitest|jest|karma)[^/]*\.conf(?:ig)?\.[cm]?[jt]s$|(?:^|/)(?:test_[^/]+|[^/]+_test|conftest)\.py$|\.env\.[^/]*(?:test|e2e)[^/]*$"
);
static DOCUMENTATION_CONTEXT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|/)(?:README|CHANGELOG|CONTRIBUTING|PUBLISHING|DOCS)\.mdx?$|\.mdx?$");
static KEY_MARKER_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)PRIVATE KEY|SSH_PRIVATE_KEY|GPG_PRIVATE_KEY|DEPLOY_KEY|SIGNING_KEY");
static KEY_ASSIGNMENT_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)\b(?:SSH_PRIVATE_KEY|GPG_PRIVATE_KEY|DEPLOY_KEY|SIGNING_KEY)\b\s*[:=]\s*["'][^"'\n]{16,}["']"#
);
static PEM_HEADER_PATTERN: Lazy<Regex> =
    lazy_regex!(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----");
static PLACEHOLDER_PREFIX_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?is)(?:placeholder|example|sample|dummy|fake).{0,40}$");

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    let content = super::normalize_js_regex_content::normalize_js_regex_content(source);
    if TEST_CONTEXT_PATTERN.is_match(&normalized_path)
        || DOCUMENTATION_CONTEXT_PATTERN.is_match(&normalized_path)
        || !KEY_MARKER_PATTERN.is_match(&content)
    {
        return Vec::new();
    }
    let assignment_index = KEY_ASSIGNMENT_PATTERN
        .find(&content)
        .map(|found| found.start());
    let pem_index = PEM_HEADER_PATTERN.find_iter(&content).find_map(|header| {
        let prefix_start = content[..header.start()]
            .char_indices()
            .rev()
            .nth(50)
            .map_or(0, |(index, _)| index);
        if PLACEHOLDER_PREFIX_PATTERN.is_match(&content[prefix_start..header.start()]) {
            return None;
        }
        let body_start = skip_pem_spacing(&content, header.end());
        let body_end = content[body_start..]
            .char_indices()
            .take_while(|(_, character)| {
                character.is_ascii_alphanumeric()
                    || matches!(character, '+' | '/' | '=' | ' ' | '\t' | '\r' | '\n')
            })
            .last()
            .map_or(body_start, |(offset, character)| {
                body_start + offset + character.len_utf8()
            });
        let body = &content[body_start..body_end];
        if body.chars().count() < 39 {
            return None;
        }
        let before_hyphen = content[body_end..].split('-').next().unwrap_or("");
        if before_hyphen
            .find("...")
            .is_some_and(|ellipsis_index| before_hyphen[..ellipsis_index].chars().count() <= 160)
        {
            return None;
        }
        Some(header.start())
    });
    let Some(index) = assignment_index.into_iter().chain(pem_index).min() else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, &content, index);
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}

fn skip_pem_spacing(source: &str, start: usize) -> usize {
    let mut cursor = start;
    loop {
        let tail = &source[cursor..];
        if tail.starts_with("\\r") || tail.starts_with("\\n") {
            cursor += 2;
            continue;
        }
        let Some(character) = tail.chars().next() else {
            return cursor;
        };
        if !character.is_whitespace() {
            return cursor;
        }
        cursor += character.len_utf8();
    }
}
