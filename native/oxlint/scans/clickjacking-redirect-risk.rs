use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "Redirect or framing configuration may let attacker-controlled URLs chain into privileged UI or clickjacking.";

static REDIRECT_CALL_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)\bredirect\s*\(");
static SAFE_REDIRECT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)^\s*(?:await\s+)?[A-Za-z0-9_$]*(?:safe|valid|sanitiz|allowlist|whitelist)[A-Za-z0-9_$]*\s*\("
);
static REDIRECT_INPUT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)\b(?:searchParams\.get|nextUrl\.searchParams|returnTo|callbackUrl|continue|next)\b"
);
static IFRAME_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?is)<iframe\b.{0,700}(?:\b(?:next=|continue=|redirect=|redirect_uri|userstoinvite|sharingaction|\.\.)|[?&](?:amp;)?role=)"
);
static FRAME_POLICY_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)frame-ancestors\s+(?:\*|'self'\s+\*)|X-Frame-Options["']?\s*:\s*["']?ALLOW"#
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path)
        && !super::is_config_or_ci_path::is_config_or_ci_path(relative_path)
    {
        return Vec::new();
    }
    let content = super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(&content);

    let redirect_index = REDIRECT_CALL_PATTERN
        .find_iter(&normalized)
        .find_map(|redirect_match| {
            let arguments_start = redirect_match.end();
            let tail = &normalized[arguments_start..];
            if SAFE_REDIRECT_PATTERN.is_match(tail) {
                return None;
            }
            let argument_end = tail
                .char_indices()
                .find(|(_, character)| matches!(character, ')' | '\'' | '"' | '`' | '\n'))
                .map_or(tail.len(), |(index, _)| index);
            if REDIRECT_INPUT_PATTERN.is_match(&tail[..argument_end]) {
                return Some(redirect_match.start());
            }
            None
        });
    let other_index = IFRAME_PATTERN
        .find(&normalized)
        .map(|found| found.start())
        .into_iter()
        .chain(
            FRAME_POLICY_PATTERN
                .find(&normalized)
                .map(|found| found.start()),
        )
        .min();
    redirect_index
        .into_iter()
        .chain(other_index)
        .min()
        .map(|index| finding(source, &content, index))
        .unwrap_or_default()
}

fn finding(original: &str, content: &str, index: usize) -> Vec<ScanFinding> {
    let (line, column) = get_location_at_index(original, content, index);
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
