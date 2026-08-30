use std::collections::BTreeMap;

use serde::Deserialize;

mod get_location_at_index;
mod sanitize_sql_for_scan;
mod scan_finding;
mod supabase_table_missing_rls;

pub use scan_finding::ScanFinding;

const NATIVE_SCAN_RULE_IDS: &[&str] = &["supabase-table-missing-rls"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFileInput {
    pub absolute_path: String,
    pub relative_path: String,
    pub content: String,
    pub is_generated_bundle: bool,
    pub rule_ids: Vec<String>,
}

pub fn native_scan_rule_ids() -> Vec<String> {
    NATIVE_SCAN_RULE_IDS.iter().map(|rule_id| (*rule_id).to_string()).collect()
}

pub fn scan_file(input: &ScanFileInput) -> BTreeMap<String, Vec<ScanFinding>> {
    let mut findings_by_rule = BTreeMap::new();
    for rule_id in &input.rule_ids {
        let findings = match rule_id.as_str() {
            "supabase-table-missing-rls" => {
                supabase_table_missing_rls::scan(&input.relative_path, &input.content)
            }
            _ => continue,
        };
        findings_by_rule.insert(rule_id.clone(), findings);
    }
    findings_by_rule
}
