use std::collections::BTreeMap;

use serde::Deserialize;

mod active_static_asset;
mod dangerous_html_sink;
mod get_location_at_index;
mod is_production_file_path;
mod normalize_js_regex_content;
mod nosql_injection_risk;
mod raw_sql_injection_risk;
mod sanitize_sql_for_scan;
mod scan_finding;
mod strip_comments_preserving_positions;
mod supabase_client_owned_authz_field;
mod supabase_rls_policy_risk;
mod supabase_table_missing_rls;
mod unsafe_json_in_html;

pub use scan_finding::ScanFinding;

const NATIVE_SCAN_RULE_IDS: &[&str] = &[
    "active-static-asset",
    "dangerous-html-sink",
    "nosql-injection-risk",
    "raw-sql-injection-risk",
    "supabase-client-owned-authz-field",
    "supabase-rls-policy-risk",
    "supabase-table-missing-rls",
    "unsafe-json-in-html",
];

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
    NATIVE_SCAN_RULE_IDS
        .iter()
        .map(|rule_id| (*rule_id).to_string())
        .collect()
}

pub fn scan_file(input: &ScanFileInput) -> BTreeMap<String, Vec<ScanFinding>> {
    let mut findings_by_rule = BTreeMap::new();
    for rule_id in &input.rule_ids {
        let findings = match rule_id.as_str() {
            "active-static-asset" => active_static_asset::scan(
                &input.relative_path,
                &input.content,
                input.is_generated_bundle,
            ),
            "dangerous-html-sink" => dangerous_html_sink::scan(
                &input.relative_path,
                &input.absolute_path,
                &input.content,
                input.is_generated_bundle,
            ),
            "nosql-injection-risk" => {
                nosql_injection_risk::scan(&input.relative_path, &input.content)
            }
            "raw-sql-injection-risk" => {
                raw_sql_injection_risk::scan(&input.relative_path, &input.content)
            }
            "supabase-client-owned-authz-field" => {
                supabase_client_owned_authz_field::scan(&input.relative_path, &input.content)
            }
            "supabase-rls-policy-risk" => {
                supabase_rls_policy_risk::scan(&input.relative_path, &input.content)
            }
            "supabase-table-missing-rls" => {
                supabase_table_missing_rls::scan(&input.relative_path, &input.content)
            }
            "unsafe-json-in-html" => {
                unsafe_json_in_html::scan(&input.relative_path, &input.content)
            }
            _ => continue,
        };
        findings_by_rule.insert(rule_id.clone(), findings);
    }
    findings_by_rule
}
