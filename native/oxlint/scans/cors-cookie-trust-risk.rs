use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{
    ScanFinding, get_location_at_index::get_location_at_index, scan_content::ScanContent,
};

const MESSAGE: &str = "Credentialed CORS or broad auth-cookie scope can make a docs/custom-domain XSS become account compromise.";

static CORS_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?is)Access-Control-Allow-Credentials["']?\s*[:,]\s*["']?true.{0,700}Access-Control-Allow-Origin["']?\s*[:,]\s*["']?(?:\*|https://docs\.|https://.*mintlify)"#
);
static COOKIE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?is)\b(?:session|auth|token|jwt)[^=\n]{0,80}(?:=[^;\n]{0,120};[^=\n]{0,80})?\bDomain=\."
);

pub fn scan(relative_path: &str, source: &ScanContent<'_>) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path)
        && !super::is_config_or_ci_path::is_config_or_ci_path(relative_path)
    {
        return Vec::new();
    }
    let content = source.normalized_scannable(false);
    let Some(index) = CORS_PATTERN
        .find(&content)
        .map(|found| found.start())
        .into_iter()
        .chain(COOKIE_PATTERN.find(&content).map(|found| found.start()))
        .min()
    else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, &content, index);
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
