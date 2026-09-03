use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, first_pattern_finding::first_pattern_finding};

const MESSAGE: &str = "Firestore query code filters by an auth-shaped field; filtering is not authorization unless rules enforce the same boundary.";

static QUERY_FILTER_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)\.where\s*\(\s*["'](?:uid|userId|userID|ownerId|ownerID|orgId|orgID|tenantId|tenantID|role)["']\s*,\s*["']==["']"#
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_client_source_path::is_client_source_path(relative_path) {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let content = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    first_pattern_finding(source, &content, &[&QUERY_FILTER_PATTERN], MESSAGE)
}
