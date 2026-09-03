use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "Webhook handler code does not show an obvious signature verification step.";

static WEBHOOK_PATH_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)[^/]*webhook[^/]*/|(?:^|/)[^/]*webhook[^/]*\.[cm]?[jt]s$|(?-u:\bwebhook\b)"
);
static WEBHOOK_ENTRYPOINT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?-u:\b)(?:export\s+(?:async\s+)?function\s+POST|export\s+const\s+(?:POST|handler|webhook)|webhookHandler|webhookRoute)(?-u:\b)"
);
static WEBHOOK_VERIFICATION_SIGNAL_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)verifySignature|verify[^\r\n\u{2028}\u{2029}]*signature|verify[A-Za-z0-9_]*(?:Webhook|Auth)|constructEvent|createHmac|timingSafeEqual|svix|webhookSecret|stripe\.webhooks|[\"'][A-Za-z0-9_-]*signature[\"']"#
);
static WEBHOOK_VERIFICATION_HELPER_CALL_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?-u:\b)[A-Za-z]{0,40}(?:verif|valid|check|assert|authenticat|compare|guard)[A-Za-z]{0,40}(?:secret|signature|hmac|webhook|digest)[A-Za-z]{0,40}\s*\("
);
static OUTBOUND_WEBHOOK_URL_MENTION_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)webhook[\s_-]?ur[il][A-Za-z0-9_]*");
static OUTBOUND_WEBHOOK_CONFIG_PATTERN: Lazy<Regex> = lazy_regex!(
    r"process\.env\.[A-Za-z0-9_]*WEBHOOK_URL|(?-u:\b)(?:send|post|dispatch|publish|notify)[A-Za-z0-9_]*Webhook"
);
static REQUEST_READ_PATTERN: Lazy<Regex> = lazy_regex!(r"(?-u:\b)(?:req|request)(?-u:\b)");
static COMMENT_OR_STRING_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"//[^\n]*|(?s:/\*.*?\*/)|\"(?:\\[^\n\r\u{2028}\u{2029}]|[^\"\\\n])*\"|'(?:\\[^\n\r\u{2028}\u{2029}]|[^'\\\n])*'|`(?:\\[^\n\r\u{2028}\u{2029}]|[^`\\])*`"#
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path)
        || OUTBOUND_WEBHOOK_CONFIG_PATTERN.is_match(source)
    {
        return Vec::new();
    }
    let judgeable = COMMENT_OR_STRING_PATTERN.replace_all(source, "");
    let judgeable = OUTBOUND_WEBHOOK_URL_MENTION_PATTERN.replace_all(&judgeable, "");
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    if !WEBHOOK_PATH_PATTERN.is_match(normalized_path.as_ref())
        && !WEBHOOK_PATH_PATTERN.is_match(judgeable.as_ref())
    {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    if !REQUEST_READ_PATTERN.is_match(normalized.as_ref())
        || WEBHOOK_VERIFICATION_SIGNAL_PATTERN.is_match(normalized.as_ref())
        || WEBHOOK_VERIFICATION_HELPER_CALL_PATTERN.is_match(normalized.as_ref())
    {
        return Vec::new();
    }
    let Some(found) = WEBHOOK_ENTRYPOINT_PATTERN.find(normalized.as_ref()) else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, normalized.as_ref(), found.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
