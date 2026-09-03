use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, first_pattern_finding::first_pattern_finding};

const MESSAGE: &str = "A browser artifact exposes Firebase/Supabase config together with sensitive collections or authorization fields.";

static FIREBASE_CONFIG_FORWARD_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?is)\b(?:initializeApp|firebase|firestore|getFirestore)\b.{0,700}\b(?:apiKey|authDomain|projectId|databaseURL|storageBucket)\b"
);
static FIREBASE_CONFIG_REVERSE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?is)\b(?:apiKey|authDomain|projectId|databaseURL|storageBucket)\b.{0,700}\b(?:firebase|firestore|getFirestore|initializeApp)\b"
);
static SUPABASE_CONFIG_FORWARD_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?is)\bcreateClient\b.{0,700}\b(?:supabase|SUPABASE_URL)\b");
static SUPABASE_CONFIG_REVERSE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?is)\b(?:supabase|SUPABASE_URL)\b.{0,700}\bcreateClient\b");
static AUTHORITY_SURFACE_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)\b(?:collection\s*\(\s*["'](?:boosts|sessions|sessions_admin|users|orgs|candidateJobs|conversations|documents)|from\s*\(\s*["'](?:users|profiles|documents|organizations|memberships)|creatorID|creatorId|providerId|ghostOrg|ownerId|orgId|tenantId|workspaceId|isAdmin|SuperAdmin)\b"#
);

pub fn scan(relative_path: &str, source: &str, is_generated_bundle: bool) -> Vec<ScanFinding> {
    if !super::is_browser_artifact_path::is_browser_artifact_path(
        relative_path,
        is_generated_bundle,
    ) {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let normalized_source =
        super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    if ![
        &*FIREBASE_CONFIG_FORWARD_PATTERN,
        &*FIREBASE_CONFIG_REVERSE_PATTERN,
        &*SUPABASE_CONFIG_FORWARD_PATTERN,
        &*SUPABASE_CONFIG_REVERSE_PATTERN,
    ]
    .iter()
    .any(|pattern| pattern.is_match(&normalized_source))
    {
        return Vec::new();
    }
    first_pattern_finding(
        source,
        &normalized_source,
        &[&AUTHORITY_SURFACE_PATTERN],
        MESSAGE,
    )
}
