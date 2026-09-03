use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "Client code reads sensitive action state from the URL, which can pre-fill invites, roles, redirects, or sharing flows with attacker values.";

static PRIVILEGED_QUERY_PARAM_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)(?-u:\b)(?:searchParams|useSearchParams\s*\(\s*\)|URLSearchParams\s*\([^)]{0,120}\))(?:[?!])?\.get(?:All)?\s*\(\s*[\"'](?:userstoinvite|role|permission|sharingaction|invite|admin|next|continue|returnTo|redirect_uri|callbackUrl)[\"']|(?-u:\b)searchParams\.(?:userstoinvite|role|permission|sharingaction|invite|admin|returnTo|redirect_uri|callbackUrl)(?-u:\b)"#
);
static VALIDATOR_PREFIX_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:safe|valid|sanitiz|relativ|allowlist|whitelist|parse|normaliz)[A-Za-z0-9_$]*\(\s*(?:new\s+)?(?:[A-Za-z0-9_$]+\s*\.\s*){0,4}$"
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_client_source_path::is_client_source_path(relative_path) {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    let found = PRIVILEGED_QUERY_PARAM_PATTERN
        .find_iter(normalized.as_ref())
        .find(|found| !VALIDATOR_PREFIX_PATTERN.is_match(&normalized[..found.start()]));
    let Some(found) = found else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, normalized.as_ref(), found.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
