use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, first_pattern_finding::first_pattern_finding};

const MESSAGE: &str = "Firebase rules grant broad access to everyone or to any signed-in user, which is the Chattr/Firewreck failure mode.";

static PERMISSIVE_RULE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)allow\s+(?:read|write|create|update|delete|list|get|read,\s*write)\s*:\s*if\s+(?:true|request\.auth\s*!=\s*null)\s*;?"
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_firebase_rules_path::is_firebase_rules_path(relative_path) {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let content = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    first_pattern_finding(source, &content, &[&PERMISSIVE_RULE_PATTERN], MESSAGE)
}
