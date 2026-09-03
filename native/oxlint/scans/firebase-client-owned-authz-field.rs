use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, first_pattern_finding::first_pattern_finding};

const MESSAGE: &str = "Client code writes an ownership, tenant, or role field that should be server-owned and immutable.";

static DATABASE_EVIDENCE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)firebase|firestore|supabase|\b(?:setDoc|addDoc)\s*\(");
static CLIENT_AUTHORITY_WRITE_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?is)(?:\b(?:setDoc|updateDoc|addDoc)\s*\(|(?:\b(?:firebase|firestore|getFirestore)\b|\bcollection\s*\(|\.collection\s*\().{0,500}\.(?:set|update|add)\s*\()(?:[^;'"`]|'[^'\n]*'|"[^"\n]*"|`[^`]*`){0,700}\b(?:ownerId|ownerID|creatorId|creatorID|providerId|providerID|orgId|orgID|tenantId|tenantID|workspaceId|workspaceID|ghostOrg|role|roles|isAdmin)\b"#
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_client_source_path::is_client_source_path(relative_path) {
        return Vec::new();
    }
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    let normalized_source = super::normalize_js_regex_content::normalize_js_regex_content(source);
    if !DATABASE_EVIDENCE_PATTERN.is_match(&normalized_source)
        && !DATABASE_EVIDENCE_PATTERN.is_match(&normalized_path)
    {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let content = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    first_pattern_finding(
        source,
        &content,
        &[&CLIENT_AUTHORITY_WRITE_PATTERN],
        MESSAGE,
    )
}
