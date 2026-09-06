use serde::{Deserialize, Serialize};

#[path = "circular-dependency.rs"]
mod circular_dependency;
#[path = "duplicate-jsx-subtree.rs"]
mod duplicate_jsx_subtree;
#[path = "unused-dependency.rs"]
mod unused_dependency;
#[path = "unused-export.rs"]
mod unused_export;
#[path = "unused-file.rs"]
mod unused_file;

pub use duplicate_jsx_subtree::{
    analyze_duplicate_jsx, DuplicateJsxAnalysisInput, DuplicateJsxCandidateInput,
    DuplicateJsxFamily, DuplicateJsxOccurrence,
};

const NATIVE_PROJECT_RULE_IDS: &[&str] = &[
    "circular-dependency",
    "duplicate-jsx-subtree",
    "unused-dependency",
    "unused-dev-dependency",
    "unused-export",
    "unused-file",
    "unused-type",
];

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAnalysisGraphInput {
    pub modules: Vec<ProjectModuleInput>,
    pub edges: Vec<ProjectEdgeInput>,
    pub platform_sibling_indices: Vec<Option<Vec<usize>>>,
    pub convention_consumed_exports: Vec<ProjectExportKeyInput>,
    pub report_types: bool,
    pub include_entry_exports: bool,
    pub stale_package_analysis: Option<StalePackageAnalysisInput>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StalePackageAnalysisInput {
    pub declared_dependencies: Vec<DeclaredDependencyAnalysisInput>,
    pub sorted_declared_dependency_names: Vec<String>,
    pub observed_package_names: Vec<String>,
    pub used_package_names: Vec<String>,
    pub peer_satisfied_package_names: Vec<String>,
    pub ambiguous_binary_package_names: Vec<String>,
    pub source_file_rescued_package_names: Vec<String>,
    pub override_mappings: Vec<OverrideMappingInput>,
    pub final_peer_satisfied_package_names: Vec<String>,
    pub is_peer_metadata_complete: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeclaredDependencyAnalysisInput {
    pub name: String,
    pub is_dev_dependency: bool,
    pub is_always_considered_used: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverrideMappingInput {
    pub from_package: String,
    pub to_package: String,
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
    pub top_level_import_references: Vec<String>,
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
    pub is_side_effect: bool,
    pub is_type_only: bool,
    pub re_exported_names: Vec<String>,
    pub re_export_mappings: Vec<ProjectReExportMappingInput>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLinkedSymbolInput {
    pub imported_name: String,
    pub local_name: String,
    pub is_type_only: bool,
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

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnusedDependencyFinding {
    pub name: String,
    pub is_dev_dependency: bool,
    pub reason: String,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedDependencyFinding {
    pub name: String,
    pub is_dev_dependency: bool,
    pub reasons: Vec<String>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CircularDependencyFinding {
    pub files: Vec<String>,
}

#[derive(Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAnalysisOutput {
    pub unused_files: Vec<UnusedFileFinding>,
    pub verified_unused_files: Vec<UnusedFileFinding>,
    pub unused_exports: Vec<UnusedExportFinding>,
    pub unused_dependencies: Vec<UnusedDependencyFinding>,
    pub skipped_dependencies: Vec<SkippedDependencyFinding>,
    pub circular_dependencies: Vec<CircularDependencyFinding>,
}

pub fn analyze_project_graph(graph: &ProjectAnalysisGraphInput) -> ProjectAnalysisOutput {
    let mut output = unused_file::analyze(graph);
    output.unused_exports = unused_export::analyze(graph);
    if let Some(stale_package_analysis) = &graph.stale_package_analysis {
        unused_dependency::analyze(stale_package_analysis, &mut output);
    }
    output.circular_dependencies = circular_dependency::analyze(graph);
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
                    "topLevelImportReferences": [],
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
                "includeEntryExports": false,
                "stalePackageAnalysis": {
                    "declaredDependencies": [{
                        "name": "unused-development-package",
                        "isDevDependency": true,
                        "isAlwaysConsideredUsed": false
                    }],
                    "sortedDeclaredDependencyNames": ["unused-development-package"],
                    "observedPackageNames": [],
                    "usedPackageNames": [],
                    "peerSatisfiedPackageNames": [],
                    "ambiguousBinaryPackageNames": [],
                    "sourceFileRescuedPackageNames": [],
                    "overrideMappings": [],
                    "finalPeerSatisfiedPackageNames": [],
                    "isPeerMetadataComplete": true
                }
            }"#,
        )
        .unwrap();

        assert_eq!(
            serde_json::to_value(analyze_project_graph(&graph)).unwrap(),
            serde_json::json!({
                "unusedFiles": [{ "path": "src/orphan.ts" }],
                "verifiedUnusedFiles": [{ "path": "src/orphan.ts" }],
                "unusedExports": [],
                "unusedDependencies": [{
                    "name": "unused-development-package",
                    "isDevDependency": true,
                    "reason": "\"unused-development-package\" is declared in devDependencies but is never imported or referenced by any source file, script, or config — remove it from package.json if it is genuinely unused"
                }],
                "skippedDependencies": [],
                "circularDependencies": []
            })
        );
    }

    #[test]
    fn exports_the_implemented_project_rule_ids() {
        assert_eq!(
            native_project_rule_ids(),
            [
                "circular-dependency",
                "duplicate-jsx-subtree",
                "unused-dependency",
                "unused-dev-dependency",
                "unused-export",
                "unused-file",
                "unused-type"
            ]
        );
    }
}
