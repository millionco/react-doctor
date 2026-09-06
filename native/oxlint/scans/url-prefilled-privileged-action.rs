use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{
    ScanFinding, get_location_at_index::get_location_at_index, scan_content::ScanContent,
};

const MESSAGE: &str = "Client code reads sensitive action state from the URL, which can pre-fill invites, roles, redirects, or sharing flows with attacker values.";

static PRIVILEGED_QUERY_PARAM_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)(?-u:\b)(?:searchParams|useSearchParams\s*\(\s*\)|URLSearchParams\s*\([^)]{0,120}\))(?:[?!])?\.get(?:All)?\s*\(\s*[\"'](?:userstoinvite|role|permission|sharingaction|invite|admin|next|continue|returnTo|redirect_uri|callbackUrl)[\"']|(?-u:\b)searchParams\.(?:userstoinvite|role|permission|sharingaction|invite|admin|returnTo|redirect_uri|callbackUrl)(?-u:\b)"#
);
static VALIDATOR_PREFIX_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:safe|valid|sanitiz|relativ|allowlist|whitelist|parse|normaliz)[A-Za-z0-9_$]*\(\s*(?:new\s+)?(?:[A-Za-z0-9_$]+\s*\.\s*){0,4}$"
);

pub fn scan(relative_path: &str, source: &ScanContent<'_>) -> Vec<ScanFinding> {
    if !super::is_client_source_path::is_client_source_path(relative_path) {
        return Vec::new();
    }
    let normalized = source.normalized_scannable(false);
    let found = PRIVILEGED_QUERY_PARAM_PATTERN
        .find_iter(normalized.as_ref())
        .find(|found| !VALIDATOR_PREFIX_PATTERN.is_match(&normalized[..found.start()]));
    let Some(found) = found else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, normalized.as_ref(), found.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
