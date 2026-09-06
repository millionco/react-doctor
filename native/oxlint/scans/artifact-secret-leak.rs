use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "A browser-delivered artifact contains a secret-looking credential value.";

static DOCUMENTATION_CONTEXT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|/)(?:README|CHANGELOG|CONTRIBUTING|PUBLISHING|DOCS)\.mdx?$|\.mdx?$");

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
    let Some(index) = super::security_secret_patterns::first_secret_value(source, true) else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, source, index);
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
