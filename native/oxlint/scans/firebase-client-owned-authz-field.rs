use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{
    ScanFinding, first_pattern_finding::first_pattern_finding, scan_content::ScanContent,
};

const MESSAGE: &str = "Client code writes an ownership, tenant, or role field that should be server-owned and immutable.";

static DATABASE_EVIDENCE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)firebase|firestore|supabase|\b(?:setDoc|addDoc)\s*\(");
static CLIENT_AUTHORITY_WRITE_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?is)(?:\b(?:setDoc|updateDoc|addDoc)\s*\(|(?:\b(?:firebase|firestore|getFirestore)\b|\bcollection\s*\(|\.collection\s*\().{0,500}\.(?:set|update|add)\s*\()(?:[^;'"`]|'[^'\n]*'|"[^"\n]*"|`[^`]*`){0,700}\b(?:ownerId|ownerID|creatorId|creatorID|providerId|providerID|orgId|orgID|tenantId|tenantID|workspaceId|workspaceID|ghostOrg|role|roles|isAdmin)\b"#
);

pub fn scan(relative_path: &str, source: &ScanContent<'_>) -> Vec<ScanFinding> {
    if !super::is_client_source_path::is_client_source_path(relative_path) {
        return Vec::new();
    }
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    if !DATABASE_EVIDENCE_PATTERN.is_match(&normalized_path)
        && !DATABASE_EVIDENCE_PATTERN.is_match(source.normalized_source())
    {
        return Vec::new();
    }
    let content = source.normalized_scannable(false);
    first_pattern_finding(
        source,
        &content,
        &[&CLIENT_AUTHORITY_WRITE_PATTERN],
        MESSAGE,
    )
}
