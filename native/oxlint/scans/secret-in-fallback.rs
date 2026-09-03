use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "A secret env var has a hardcoded string fallback: the literal is a committed secret and the app fails open (uses it) when the variable is unset.";

static ENV_FALLBACK_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)(?-u:\b)process\.env\.([A-Z][A-Z0-9_]*)\s*(?:\?\?|\|\|)\s*([\"'`])([^\"'`\n]{8,})[\"'`]"#
);
static SECRET_NAME_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|API_?KEY|APIKEY|ACCESS_KEY|CLIENT_SECRET|CREDENTIAL|SIGNING_KEY|ENCRYPTION_KEY|WEBHOOK_SECRET|SERVICE_ROLE)"
);
static REFERENCE_SUFFIX_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)_(?:NAME|HEADER|ENDPOINT|URL|URI|ID|PREFIX|SUFFIX|PARAM|PARAMS|FIELD|ISSUER|AUDIENCE|ALGORITHM|ALG|REGION|BUCKET|HOST|HOSTNAME|PORT|PATH|VERSION|SCOPE|TYPE|FORMAT|EXPIRY|TTL)$"
);
static NAME_LIKE_PLACEHOLDER_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*[_-](?:token|secret|key|password|passwd|credential)s?$"
);
static PLACEHOLDER_PREFIX_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)^(?:changeme|change[_-]?me|placeholder|your[_-]|example|sample|dummy|development|local|todo|replace[_-]?me|https?://|x{3,}|\*{3,})"
);
static ZERO_FILLED_PATTERN: Lazy<Regex> = lazy_regex!(r"^[A-Za-z0-9_-]{0,12}0{8,}$");

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path) {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    let found = ENV_FALLBACK_PATTERN
        .captures_iter(normalized.as_ref())
        .find_map(|captures| {
            let full = captures.get(0)?;
            let name = captures.get(1)?.as_str();
            let opening_quote = captures.get(2)?.as_str();
            let value = captures.get(3)?.as_str();
            let closing_quote = full.as_str().chars().next_back()?;
            if opening_quote.chars().next()? != closing_quote || !is_secret_fallback(name, value) {
                return None;
            }
            Some(full)
        });
    let Some(found) = found else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, normalized.as_ref(), found.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}

fn is_secret_fallback(name: &str, value: &str) -> bool {
    if !SECRET_NAME_PATTERN.is_match(name) || REFERENCE_SUFFIX_PATTERN.is_match(name) {
        return false;
    }
    let uppercase_name = name.to_ascii_uppercase();
    let is_explicit_secret_suffix = ["_SECRET", "_PRIVATE_KEY", "_PASSWORD", "_PASSWD"]
        .iter()
        .any(|suffix| uppercase_name.ends_with(suffix));
    let is_public_prefix = [
        "NEXT_PUBLIC_",
        "EXPO_PUBLIC_",
        "GATSBY_PUBLIC_",
        "NUXT_PUBLIC_",
        "REACT_APP_PUBLIC_",
        "VITE_PUBLIC_",
        "PUBLIC_",
    ]
    .iter()
    .any(|prefix| uppercase_name.starts_with(prefix));
    if is_public_prefix && !is_explicit_secret_suffix {
        return false;
    }
    if uppercase_name.ends_with("PUBLISHABLE_KEY") || uppercase_name.ends_with("ANON_KEY") {
        return false;
    }
    let lowercase_value = value.to_ascii_lowercase();
    !value.chars().all(|character| character.is_ascii_digit())
        && !NAME_LIKE_PLACEHOLDER_PATTERN.is_match(value)
        && !ZERO_FILLED_PATTERN.is_match(value)
        && lowercase_value != "test test test test test test test test test test test junk"
        && !PLACEHOLDER_PREFIX_PATTERN.is_match(value)
}
