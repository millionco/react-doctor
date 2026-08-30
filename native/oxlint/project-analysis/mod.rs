use serde::{Deserialize, Serialize};

#[path = "unused-export.rs"]
mod unused_export;
#[path = "unused-file.rs"]
mod unused_file;

const NATIVE_PROJECT_RULE_IDS: &[&str] = &["unused-export", "unused-file", "unused-type"];

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAnalysisGraphInput {
    pub modules: Vec<ProjectModuleInput>,
    pub edges: Vec<ProjectEdgeInput>,
    pub platform_sibling_indices: Vec<Option<Vec<usize>>>,
    pub convention_consumed_exports: Vec<ProjectExportKeyInput>,
    pub report_types: bool,
    pub include_entry_exports: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectModuleInput {
    pub index: usize,
    pub path: String,
    pub exports: Vec<ProjectExportInput>,
    pub member_accesses: Vec<ProjectMemberAccessInput>,
    pub whole_object_uses: Vec<String>,
    pub local_identifier_references: Vec<String>,
    pub parse_error_codes: Vec<String>,
    pub is_reachable: bool,
    pub is_entry_point: bool,
    pub is_externally_consumed: bool,
    pub is_declaration_file: bool,
    pub is_config_file: bool,
    pub is_git_ignored: bool,
    pub is_analysis_excluded: bool,
    pub is_package_graph_complete: bool,
    pub has_package_dynamic_loader_uncertainty: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectExportInput {
    pub name: String,
    pub is_default: bool,
    pub is_type_only: bool,
    pub is_re_export: bool,
    pub is_namespace_re_export: bool,
    pub is_synthetic: bool,
    pub has_re_export_source: bool,
    pub re_export_original_name: Option<String>,
    pub default_export_local_name: Option<String>,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEdgeInput {
    pub source: usize,
    pub target: usize,
    pub imported_symbols: Vec<ProjectLinkedSymbolInput>,
    pub is_re_export_edge: bool,
    pub is_dynamic: bool,
    pub re_exported_names: Vec<String>,
    pub re_export_mappings: Vec<ProjectReExportMappingInput>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLinkedSymbolInput {
    pub imported_name: String,
    pub local_name: String,
    pub is_namespace: bool,
    pub is_default: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectReExportMappingInput {
    pub exported_name: String,
    pub original_name: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemberAccessInput {
    pub object_name: String,
    pub member_name: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectExportKeyInput {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnusedFileFinding {
    pub path: String,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnusedExportFinding {
    pub path: String,
    pub name: String,
    pub line: usize,
    pub column: usize,
    pub is_type_only: bool,
}

#[derive(Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAnalysisOutput {
    pub unused_files: Vec<UnusedFileFinding>,
    pub verified_unused_files: Vec<UnusedFileFinding>,
    pub unused_exports: Vec<UnusedExportFinding>,
}

pub fn analyze_project_graph(graph: &ProjectAnalysisGraphInput) -> ProjectAnalysisOutput {
    let mut output = unused_file::analyze(graph);
    output.unused_exports = unused_export::analyze(graph);
    output
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
                    "index": 0,
                    "path": "src/orphan.ts",
                    "exports": [],
                    "memberAccesses": [],
                    "wholeObjectUses": [],
                    "localIdentifierReferences": [],
                    "parseErrorCodes": [],
                    "isReachable": false,
                    "isEntryPoint": false,
                    "isExternallyConsumed": false,
                    "isDeclarationFile": false,
                    "isConfigFile": false,
                    "isGitIgnored": false,
                    "isAnalysisExcluded": false,
                    "isPackageGraphComplete": true,
                    "hasPackageDynamicLoaderUncertainty": false
                }],
                "edges": [],
                "platformSiblingIndices": [],
                "conventionConsumedExports": [],
                "reportTypes": true,
                "includeEntryExports": false
            }"#,
        )
        .unwrap();

        assert_eq!(
            serde_json::to_value(analyze_project_graph(&graph)).unwrap(),
            serde_json::json!({
                "unusedFiles": [{ "path": "src/orphan.ts" }],
                "verifiedUnusedFiles": [{ "path": "src/orphan.ts" }],
                "unusedExports": []
            })
        );
    }

    #[test]
    fn exports_the_implemented_project_rule_ids() {
        assert_eq!(
            native_project_rule_ids(),
            ["unused-export", "unused-file", "unused-type"]
        );
    }
}
