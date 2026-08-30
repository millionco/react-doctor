use serde::{Deserialize, Serialize};

#[path = "unused-file.rs"]
mod unused_file;

const NATIVE_PROJECT_RULE_IDS: &[&str] = &["unused-file"];

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAnalysisGraphInput {
    pub modules: Vec<ProjectModuleInput>,
    pub edges: Vec<ProjectEdgeInput>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectModuleInput {
    pub path: String,
    pub exports: Vec<ProjectExportInput>,
    pub parse_error_codes: Vec<String>,
    pub is_reachable: bool,
    pub is_entry_point: bool,
    pub is_externally_consumed: bool,
    pub is_declaration_file: bool,
    pub is_config_file: bool,
    pub is_git_ignored: bool,
    pub is_analysis_excluded: bool,
    pub is_package_graph_complete: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectExportInput {
    pub is_namespace_re_export: bool,
    pub is_synthetic: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEdgeInput {
    pub source: usize,
    pub target: usize,
    pub is_re_export_edge: bool,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnusedFileFinding {
    pub path: String,
}

#[derive(Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAnalysisOutput {
    pub unused_files: Vec<UnusedFileFinding>,
    pub verified_unused_files: Vec<UnusedFileFinding>,
}

pub fn analyze_project_graph(graph: &ProjectAnalysisGraphInput) -> ProjectAnalysisOutput {
    unused_file::analyze(graph)
}

pub fn native_project_rule_ids() -> Vec<String> {
    NATIVE_PROJECT_RULE_IDS
        .iter()
        .map(|rule_id| (*rule_id).to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_the_camel_case_json_boundary() {
        let graph = serde_json::from_str::<ProjectAnalysisGraphInput>(
            r#"{
                "modules": [{
                    "path": "src/orphan.ts",
                    "exports": [],
                    "parseErrorCodes": [],
                    "isReachable": false,
                    "isEntryPoint": false,
                    "isExternallyConsumed": false,
                    "isDeclarationFile": false,
                    "isConfigFile": false,
                    "isGitIgnored": false,
                    "isAnalysisExcluded": false,
                    "isPackageGraphComplete": true
                }],
                "edges": []
            }"#,
        )
        .unwrap();

        assert_eq!(
            serde_json::to_value(analyze_project_graph(&graph)).unwrap(),
            serde_json::json!({
                "unusedFiles": [{ "path": "src/orphan.ts" }],
                "verifiedUnusedFiles": [{ "path": "src/orphan.ts" }]
            })
        );
    }

    #[test]
    fn exports_the_implemented_project_rule_ids() {
        assert_eq!(native_project_rule_ids(), ["unused-file"]);
    }
}
