use std::collections::BTreeMap;

use serde::Deserialize;

mod active_static_asset;
mod agent_tool_capability_risk;
mod artifact_baas_authority_surface;
mod artifact_env_leak;
mod artifact_secret_leak;
mod build_pipeline_secret_boundary;
mod clickjacking_redirect_risk;
mod command_execution_input_risk;
mod cors_cookie_trust_risk;
mod dangerous_html_sink;
mod find_matching_bracket;
mod firebase_client_owned_authz_field;
mod firebase_permissive_rules;
mod firebase_query_filter_as_auth;
mod first_pattern_finding;
mod get_location_at_index;
mod get_scannable_content;
mod git_provider_url_injection_risk;
mod import_metadata_execution_risk;
mod insecure_crypto_risk;
mod insecure_session_cookie;
mod is_browser_artifact_path;
mod is_client_source_path;
mod is_config_or_ci_path;
mod is_firebase_rules_path;
mod is_production_file_path;
mod jwt_insecure_verification;
mod key_lifecycle_risk;
mod mask_third_party_source_map_sources;
mod mcp_tool_capability_risk;
mod mdx_ssr_execution_risk;
mod normalize_js_regex_content;
mod nosql_injection_risk;
mod package_metadata_secret;
mod path_traversal_risk;
mod plugin_update_trust_risk;
mod postmessage_origin_risk;
mod public_debug_artifact;
mod public_env_secret_name;
mod raw_sql_injection_risk;
mod repository_secret_file;
mod request_body_mass_assignment;
mod sanitize_sql_for_scan;
mod scan_content;
mod scan_finding;
mod secret_in_fallback;
mod security_file_path;
mod security_secret_patterns;
mod strip_comments_preserving_positions;
mod supabase_client_owned_authz_field;
mod supabase_rls_policy_risk;
mod supabase_table_missing_rls;
mod svg_filter_clickjacking_risk;
mod tenant_static_proxy_risk;
mod unsafe_json_in_html;
mod untrusted_redirect_following;
mod url_prefilled_privileged_action;
mod webhook_signature_risk;

pub use scan_finding::ScanFinding;

const NATIVE_SCAN_RULE_IDS: &[&str] = &[
    "active-static-asset",
    "agent-tool-capability-risk",
    "artifact-baas-authority-surface",
    "artifact-env-leak",
    "artifact-secret-leak",
    "build-pipeline-secret-boundary",
    "clickjacking-redirect-risk",
    "command-execution-input-risk",
    "cors-cookie-trust-risk",
    "dangerous-html-sink",
    "firebase-client-owned-authz-field",
    "firebase-permissive-rules",
    "firebase-query-filter-as-auth",
    "git-provider-url-injection-risk",
    "import-metadata-execution-risk",
    "insecure-crypto-risk",
    "insecure-session-cookie",
    "jwt-insecure-verification",
    "key-lifecycle-risk",
    "mcp-tool-capability-risk",
    "mdx-ssr-execution-risk",
    "nosql-injection-risk",
    "package-metadata-secret",
    "path-traversal-risk",
    "plugin-update-trust-risk",
    "postmessage-origin-risk",
    "public-debug-artifact",
    "public-env-secret-name",
    "raw-sql-injection-risk",
    "repository-secret-file",
    "request-body-mass-assignment",
    "secret-in-fallback",
    "supabase-client-owned-authz-field",
    "supabase-rls-policy-risk",
    "supabase-table-missing-rls",
    "svg-filter-clickjacking-risk",
    "tenant-static-proxy-risk",
    "unsafe-json-in-html",
    "untrusted-redirect-following",
    "url-prefilled-privileged-action",
    "webhook-signature-risk",
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
    let content = scan_content::ScanContent::new(&input.relative_path, &input.content);
    let mut findings_by_rule = BTreeMap::new();
    for rule_id in &input.rule_ids {
        let findings = match rule_id.as_str() {
            "active-static-asset" => active_static_asset::scan(
                &input.relative_path,
                &content,
                input.is_generated_bundle,
            ),
            "agent-tool-capability-risk" => {
                agent_tool_capability_risk::scan(&input.relative_path, &content)
            }
            "artifact-baas-authority-surface" => artifact_baas_authority_surface::scan(
                &input.relative_path,
                &content,
                input.is_generated_bundle,
            ),
            "artifact-env-leak" => artifact_env_leak::scan(
                &input.relative_path,
                &content,
                input.is_generated_bundle,
            ),
            "artifact-secret-leak" => artifact_secret_leak::scan(
                &input.relative_path,
                &content,
                input.is_generated_bundle,
            ),
            "build-pipeline-secret-boundary" => {
                build_pipeline_secret_boundary::scan(&input.relative_path, &content)
            }
            "clickjacking-redirect-risk" => {
                clickjacking_redirect_risk::scan(&input.relative_path, &content)
            }
            "command-execution-input-risk" => {
                command_execution_input_risk::scan(&input.relative_path, &content)
            }
            "cors-cookie-trust-risk" => {
                cors_cookie_trust_risk::scan(&input.relative_path, &content)
            }
            "dangerous-html-sink" => dangerous_html_sink::scan(
                &input.relative_path,
                &input.absolute_path,
                &content,
                input.is_generated_bundle,
            ),
            "firebase-client-owned-authz-field" => {
                firebase_client_owned_authz_field::scan(&input.relative_path, &content)
            }
            "firebase-permissive-rules" => {
                firebase_permissive_rules::scan(&input.relative_path, &content)
            }
            "firebase-query-filter-as-auth" => {
                firebase_query_filter_as_auth::scan(&input.relative_path, &content)
            }
            "git-provider-url-injection-risk" => {
                git_provider_url_injection_risk::scan(&input.relative_path, &content)
            }
            "import-metadata-execution-risk" => {
                import_metadata_execution_risk::scan(&input.relative_path, &content)
            }
            "insecure-crypto-risk" => {
                insecure_crypto_risk::scan(&input.relative_path, &content)
            }
            "insecure-session-cookie" => {
                insecure_session_cookie::scan(&input.relative_path, &content)
            }
            "jwt-insecure-verification" => {
                jwt_insecure_verification::scan(&input.relative_path, &content)
            }
            "key-lifecycle-risk" => key_lifecycle_risk::scan(&input.relative_path, &content),
            "mcp-tool-capability-risk" => {
                mcp_tool_capability_risk::scan(&input.relative_path, &content)
            }
            "mdx-ssr-execution-risk" => {
                mdx_ssr_execution_risk::scan(&input.relative_path, &content)
            }
            "nosql-injection-risk" => {
                nosql_injection_risk::scan(&input.relative_path, &content)
            }
            "package-metadata-secret" => {
                package_metadata_secret::scan(&input.relative_path, &content)
            }
            "path-traversal-risk" => {
                path_traversal_risk::scan(&input.relative_path, &content)
            }
            "plugin-update-trust-risk" => {
                plugin_update_trust_risk::scan(&input.relative_path, &content)
            }
            "postmessage-origin-risk" => postmessage_origin_risk::scan(
                &input.absolute_path,
                &input.relative_path,
                &content,
            ),
            "public-debug-artifact" => {
                public_debug_artifact::scan(&input.relative_path, &content)
            }
            "public-env-secret-name" => {
                public_env_secret_name::scan(&input.relative_path, &content)
            }
            "raw-sql-injection-risk" => {
                raw_sql_injection_risk::scan(&input.relative_path, &content)
            }
            "repository-secret-file" => {
                repository_secret_file::scan(&input.relative_path, &content)
            }
            "request-body-mass-assignment" => {
                request_body_mass_assignment::scan(&input.relative_path, &content)
            }
            "secret-in-fallback" => secret_in_fallback::scan(&input.relative_path, &content),
            "supabase-client-owned-authz-field" => {
                supabase_client_owned_authz_field::scan(&input.relative_path, &content)
            }
            "supabase-rls-policy-risk" => {
                supabase_rls_policy_risk::scan(&input.relative_path, &content)
            }
            "supabase-table-missing-rls" => {
                supabase_table_missing_rls::scan(&input.relative_path, &content)
            }
            "svg-filter-clickjacking-risk" => {
                svg_filter_clickjacking_risk::scan(&input.relative_path, &content)
            }
            "tenant-static-proxy-risk" => {
                tenant_static_proxy_risk::scan(&input.relative_path, &content)
            }
            "unsafe-json-in-html" => {
                unsafe_json_in_html::scan(&input.relative_path, &content)
            }
            "untrusted-redirect-following" => {
                untrusted_redirect_following::scan(&input.relative_path, &content)
            }
            "url-prefilled-privileged-action" => {
                url_prefilled_privileged_action::scan(&input.relative_path, &content)
            }
            "webhook-signature-risk" => {
                webhook_signature_risk::scan(&input.relative_path, &content)
            }
            _ => continue,
        };
        findings_by_rule.insert(rule_id.clone(), findings);
    }
    findings_by_rule
}
