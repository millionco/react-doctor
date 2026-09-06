use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "GitHub/GitLab/Bitbucket URL construction interpolates path components that may be attacker-controlled.";
const INTERPOLATION_LOOKAHEAD_CHARS: usize = 200;

static HOST_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)api\.github\.com|github\.com|gitlab\.com|bitbucket\.org");
static INTERPOLATION_PATTERN: Lazy<Regex> = lazy_regex!(r"\$\{([^}]*)\}");
static EXTERNAL_INPUT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"\b(?:params|searchParams|query|req|request|input|payload)\s*(?:\.|\[)|\buntrusted|\bdecodeURI[A-Za-z0-9_]*"
);
static ENCODED_PATTERN: Lazy<Regex> = lazy_regex!(r"encodeURIComponent\s*\(");
static TO_STRING_PATTERN: Lazy<Regex> =
    lazy_regex!(r"^\s*[A-Za-z_$][A-Za-z0-9_$]*\.toString\(\)\s*$");

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path) {
        return Vec::new();
    }
    let content = super::normalize_js_regex_content::normalize_js_regex_content(source);
    for host_match in HOST_PATTERN.find_iter(&content) {
        let host_tail = &content[host_match.start()..];
        let tail_end = host_tail
            .char_indices()
            .nth(INTERPOLATION_LOOKAHEAD_CHARS)
            .map_or(content.len(), |(index, _)| host_match.start() + index);
        let raw_tail = &content[host_match.start()..tail_end];
        let url_tail = raw_tail
            .find('`')
            .map_or(raw_tail, |index| &raw_tail[..index]);
        let has_tainted_interpolation =
            INTERPOLATION_PATTERN
                .captures_iter(url_tail)
                .any(|captures| {
                    let expression = captures.get(1).map_or("", |capture| capture.as_str());
                    EXTERNAL_INPUT_PATTERN.is_match(expression)
                        && !ENCODED_PATTERN.is_match(expression)
                        && !TO_STRING_PATTERN.is_match(expression)
                });
        if has_tainted_interpolation {
            let (line, column) = get_location_at_index(source, &content, host_match.start());
            return vec![ScanFinding::inherited(MESSAGE, line, column)];
        }
    }
    Vec::new()
}
