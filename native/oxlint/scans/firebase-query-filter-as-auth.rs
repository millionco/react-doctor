use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{
    ScanFinding, first_pattern_finding::first_pattern_finding, scan_content::ScanContent,
};

const MESSAGE: &str = "Firestore query code filters by an auth-shaped field; filtering is not authorization unless rules enforce the same boundary.";

static QUERY_FILTER_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)\.where\s*\(\s*["'](?:uid|userId|userID|ownerId|ownerID|orgId|orgID|tenantId|tenantID|role)["']\s*,\s*["']==["']"#
);

pub fn scan(relative_path: &str, source: &ScanContent<'_>) -> Vec<ScanFinding> {
    if !super::is_client_source_path::is_client_source_path(relative_path) {
        return Vec::new();
    }
    let content = source.normalized_scannable(false);
    first_pattern_finding(source, &content, &[&QUERY_FILTER_PATTERN], MESSAGE)
}
