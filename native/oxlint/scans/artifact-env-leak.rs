use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str =
    "A browser artifact contains server-secret environment names or a full environment dump shape.";

static DOCUMENTATION_CONTEXT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|/)(?:README|CHANGELOG|CONTRIBUTING|PUBLISHING|DOCS)\.mdx?$|\.mdx?$");
static FULL_ENV_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"\b(?:process\s*\.\s*env|import\s*\.\s*meta\s*\.\s*env|window\.__[A-Z0-9_]*ENV[A-Z0-9_]*__|__[A-Z0-9_]*ENV[A-Z0-9_]*__)\b"
);
static FULL_ENV_COMMENT_TRIVIA_PATTERN: Lazy<Regex> = lazy_regex!(
    r"\b(?:(?:process|window)\s*(?:/[*/]|<!--|-->|\.\s*(?:/[*/]|<!--|-->))|import\s*(?:/[*/]|<!--|-->|\.\s*(?:/[*/]|<!--|-->|meta\s*(?:/[*/]|<!--|-->|\.\s*(?:/[*/]|<!--|-->)))))"
);
static FULL_ENV_SECRET_NAME_PATTERN: Lazy<Regex> = lazy_regex!(
    r"\b(?:DATABASE_URL|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|MAILGUN_API_KEY|SALESFORCE_CLIENT_SECRET|OKTA_CLIENT_SECRET|SESSION_SECRET|COOKIE_SECRET|PRIVATE_KEY|SERVICE_ROLE)\b"
);
static FULL_ENV_SECRET_NAME_CANDIDATE_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&FULL_ENV_SECRET_NAME_PATTERN.as_str().replace(r"\b", ""))
        .expect("valid secret name pattern")
});
static SOURCE_PATH_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)\.[cm]?[jt]sx?$");

pub fn scan(relative_path: &str, source: &str, is_generated_bundle: bool) -> Vec<ScanFinding> {
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    if DOCUMENTATION_CONTEXT_PATTERN.is_match(&normalized_path)
        || !super::is_browser_artifact_path::is_browser_artifact_path(
            relative_path,
            is_generated_bundle,
        )
    {
        return Vec::new();
    }
    let artifact_content =
        super::mask_third_party_source_map_sources::mask_third_party_source_map_sources(
            relative_path,
            source,
        );
    let Some((raw_index, is_exact)) = find_raw_candidate(&artifact_content) else {
        return Vec::new();
    };
    let raw_findings = if is_exact {
        finding(source, &artifact_content, raw_index)
    } else {
        find_leak(&artifact_content)
            .map(|index| finding(source, &artifact_content, index))
            .unwrap_or_default()
    };
    let Some(executable_content) = mask_source_comments(relative_path, &artifact_content) else {
        return finding(source, &artifact_content, raw_index);
    };
    if executable_content == artifact_content {
        return raw_findings;
    }
    find_leak(&executable_content)
        .map(|index| finding(source, &executable_content, index))
        .unwrap_or_default()
}

fn find_raw_candidate(content: &str) -> Option<(usize, bool)> {
    if let Some(index) = find_suspicious_public_name(content) {
        return Some((index, true));
    }
    if !FULL_ENV_SECRET_NAME_CANDIDATE_PATTERN.is_match(content) {
        return None;
    }
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(content);
    let secret = FULL_ENV_SECRET_NAME_PATTERN.find(&normalized)?;
    if FULL_ENV_CONTEXT_PATTERN.is_match(&normalized) {
        return Some((secret.start(), true));
    }
    FULL_ENV_COMMENT_TRIVIA_PATTERN
        .is_match(&normalized)
        .then_some((secret.start(), false))
}

fn find_leak(content: &str) -> Option<usize> {
    find_suspicious_public_name(content).or_else(|| {
        let normalized = super::normalize_js_regex_content::normalize_js_regex_content(content);
        (FULL_ENV_CONTEXT_PATTERN.is_match(&normalized))
            .then(|| {
                FULL_ENV_SECRET_NAME_PATTERN
                    .find(&normalized)
                    .map(|found| found.start())
            })
            .flatten()
    })
}

fn find_suspicious_public_name(content: &str) -> Option<usize> {
    super::security_secret_patterns::first_suspicious_public_env_secret_name(content)
}

fn mask_source_comments(relative_path: &str, source: &str) -> Option<String> {
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    if !SOURCE_PATH_PATTERN.is_match(&normalized_path) {
        return Some(source.to_string());
    }
    let lowercase_path = relative_path.to_ascii_lowercase();
    let source_type = SourceType::from_path(&lowercase_path).ok()?;
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let mut output = source.as_bytes().to_vec();
    if source.starts_with("#!") {
        let end = source
            .char_indices()
            .find(|(_, character)| matches!(character, '\r' | '\n' | '\u{2028}' | '\u{2029}'))
            .map_or(source.len(), |(index, _)| index);
        blank_range(&mut output, source, 0, end);
    }
    for comment in &parser_return.program.comments {
        blank_range(
            &mut output,
            source,
            comment.span.start as usize,
            comment.span.end as usize,
        );
    }
    Some(String::from_utf8(output).unwrap_or_else(|_| source.to_string()))
}

fn blank_range(output: &mut [u8], original: &str, start: usize, end: usize) {
    for (offset, character) in original[start..end].char_indices() {
        if matches!(character, '\r' | '\n' | '\u{2028}' | '\u{2029}') {
            continue;
        }
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

fn finding(original: &str, content: &str, index: usize) -> Vec<ScanFinding> {
    let (line, column) = get_location_at_index(original, content, index);
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
