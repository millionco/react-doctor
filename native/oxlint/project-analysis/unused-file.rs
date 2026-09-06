use super::{
    ProjectAnalysisGraphInput, ProjectAnalysisOutput, ProjectModuleInput, UnusedFileFinding,
};

const EXCLUDED_EXTENSIONS: &[&str] = &[
    ".html", ".mdx", ".md", ".css", ".scss", ".less", ".sass", ".graphql", ".gql",
];
const TEST_FILE_MARKERS: &[&str] = &[
    ".test.",
    ".spec.",
    ".stories.",
    ".story.",
    ".cy.",
    ".test-d.",
];
const EXCLUDED_DIRECTORY_NAMES: &[&str] = &[
    "e2e",
    "cypress",
    "playwright",
    "__fixtures__",
    "__snapshots__",
    "scripts",
];
const PARSE_OPAQUE_ERROR_CODES: &[&str] = &["file-minified", "file-too-large", "file-binary"];
const SCRIPT_EXTENSIONS: &[&str] = &["js", "jsx", "ts", "tsx"];

pub(super) fn analyze(graph: &ProjectAnalysisGraphInput) -> ProjectAnalysisOutput {
    let has_reachable_direct_importer_by_module =
        collect_has_reachable_direct_importer_by_module(graph);
    let is_re_export_only_barrel_with_reachable_source_by_module =
        collect_is_re_export_only_barrel_with_reachable_source_by_module(graph);
    let mut output = ProjectAnalysisOutput::default();

    for (module_index, module) in graph.modules.iter().enumerate() {
        if !is_unused_file(
            module_index,
            module,
            &has_reachable_direct_importer_by_module,
            &is_re_export_only_barrel_with_reachable_source_by_module,
        ) {
            continue;
        }
        output.unused_files.push(UnusedFileFinding {
            path: module.path.clone(),
        });
        if module.is_package_graph_complete {
            output.verified_unused_files.push(UnusedFileFinding {
                path: module.path.clone(),
            });
        }
    }

    output
}

fn collect_has_reachable_direct_importer_by_module(graph: &ProjectAnalysisGraphInput) -> Vec<bool> {
    let mut has_reachable_direct_importer_by_module = vec![false; graph.modules.len()];
    for edge in &graph.edges {
        if edge.is_re_export_edge
            || !graph
                .modules
                .get(edge.source)
                .is_some_and(|module| module.is_reachable)
        {
            continue;
        }
        if let Some(has_reachable_direct_importer) =
            has_reachable_direct_importer_by_module.get_mut(edge.target)
        {
            *has_reachable_direct_importer = true;
        }
    }
    has_reachable_direct_importer_by_module
}

fn collect_is_re_export_only_barrel_with_reachable_source_by_module(
    graph: &ProjectAnalysisGraphInput,
) -> Vec<bool> {
    let is_re_export_only_barrel_by_module = graph
        .modules
        .iter()
        .map(|module| {
            !module.exports.is_empty()
                && module
                    .exports
                    .iter()
                    .all(|export| export.is_namespace_re_export || export.is_synthetic)
        })
        .collect::<Vec<_>>();
    let mut is_re_export_only_barrel_with_reachable_source_by_module =
        vec![false; graph.modules.len()];

    for edge in &graph.edges {
        if !is_re_export_only_barrel_by_module
            .get(edge.source)
            .copied()
            .unwrap_or(false)
            || !graph
                .modules
                .get(edge.target)
                .is_some_and(|module| module.is_reachable)
        {
            continue;
        }
        if let Some(has_reachable_source) =
            is_re_export_only_barrel_with_reachable_source_by_module.get_mut(edge.source)
        {
            *has_reachable_source = true;
        }
    }
    is_re_export_only_barrel_with_reachable_source_by_module
}

fn is_unused_file(
    module_index: usize,
    module: &ProjectModuleInput,
    has_reachable_direct_importer_by_module: &[bool],
    is_re_export_only_barrel_with_reachable_source_by_module: &[bool],
) -> bool {
    !module.is_reachable
        && !module.is_entry_point
        && !module.is_externally_consumed
        && !module.is_declaration_file
        && !module.is_config_file
        && !module.is_git_ignored
        && !module.is_analysis_excluded
        && !has_excluded_extension(&module.path)
        && !is_excluded_by_pattern(&module.path)
        && !is_opaque_to_analysis(module)
        && !is_re_export_only_barrel_with_reachable_source_by_module[module_index]
        && !has_reachable_direct_importer_by_module[module_index]
}

fn has_excluded_extension(file_path: &str) -> bool {
    file_path
        .rfind('.')
        .is_some_and(|last_dot| EXCLUDED_EXTENSIONS.contains(&&file_path[last_dot..]))
}

fn is_excluded_by_pattern(file_path: &str) -> bool {
    TEST_FILE_MARKERS
        .iter()
        .any(|marker| file_path.contains(marker))
        || file_path.starts_with("__tests__/")
        || file_path.contains("/__tests__/")
        || has_excluded_directory(file_path)
        || is_config_filename(file_path.rsplit('/').next().unwrap_or(file_path))
}

fn has_excluded_directory(file_path: &str) -> bool {
    let mut component_start = 0;
    for component in file_path.split('/') {
        let component_end = component_start + component.len();
        if component_end < file_path.len()
            && EXCLUDED_DIRECTORY_NAMES.contains(&component)
            && !file_path[component_end + 1..].contains("node_modules")
        {
            return true;
        }
        component_start = component_end + 1;
    }
    false
}

fn is_config_filename(filename: &str) -> bool {
    let Some((stem, extension)) = filename.rsplit_once('.') else {
        return false;
    };
    if !SCRIPT_EXTENSIONS.contains(&extension) {
        return false;
    }
    if stem == "setupTests" {
        return true;
    }
    if stem
        .strip_suffix(".setup")
        .is_some_and(|prefix| !prefix.is_empty())
    {
        return true;
    }
    let Some((prefix, variant)) = stem.split_once(".config") else {
        return false;
    };
    !prefix.is_empty() && (variant.is_empty() || variant.starts_with('.') && variant.len() > 1)
}

fn is_opaque_to_analysis(module: &ProjectModuleInput) -> bool {
    module
        .parse_error_codes
        .iter()
        .any(|error_code| PARSE_OPAQUE_ERROR_CODES.contains(&error_code.as_str()))
}

#[cfg(test)]
mod tests {
    use super::super::{ProjectEdgeInput, ProjectExportInput};
    use super::*;

    fn module(path: &str) -> ProjectModuleInput {
        ProjectModuleInput {
            path: path.to_string(),
            is_package_graph_complete: true,
            ..ProjectModuleInput::default()
        }
    }

    #[test]
    fn reports_unreachable_source_files_in_module_order() {
        let graph = ProjectAnalysisGraphInput {
            modules: vec![module("src/z.ts"), module("src/a.ts")],
            edges: vec![],
            ..ProjectAnalysisGraphInput::default()
        };

        assert_eq!(
            analyze(&graph),
            ProjectAnalysisOutput {
                unused_files: vec![
                    UnusedFileFinding {
                        path: "src/z.ts".to_string()
                    },
                    UnusedFileFinding {
                        path: "src/a.ts".to_string()
                    },
                ],
                verified_unused_files: vec![
                    UnusedFileFinding {
                        path: "src/z.ts".to_string()
                    },
                    UnusedFileFinding {
                        path: "src/a.ts".to_string()
                    },
                ],
                unused_exports: vec![],
                circular_dependencies: vec![],
                unused_dependencies: vec![],
                skipped_dependencies: vec![],
            }
        );
    }

    #[test]
    fn requires_a_complete_package_graph_for_verified_findings() {
        let mut incomplete_module = module("src/orphan.ts");
        incomplete_module.is_package_graph_complete = false;
        let graph = ProjectAnalysisGraphInput {
            modules: vec![incomplete_module],
            edges: vec![],
            ..ProjectAnalysisGraphInput::default()
        };

        assert_eq!(
            analyze(&graph),
            ProjectAnalysisOutput {
                unused_files: vec![UnusedFileFinding {
                    path: "src/orphan.ts".to_string(),
                }],
                verified_unused_files: vec![],
                unused_exports: vec![],
                circular_dependencies: vec![],
                unused_dependencies: vec![],
                skipped_dependencies: vec![],
            }
        );
    }

    #[test]
    fn preserves_files_with_a_reachable_direct_importer() {
        let mut importer = module("src/index.ts");
        importer.is_reachable = true;
        let graph = ProjectAnalysisGraphInput {
            modules: vec![importer, module("src/imported.ts")],
            edges: vec![ProjectEdgeInput {
                source: 0,
                target: 1,
                is_re_export_edge: false,
                ..ProjectEdgeInput::default()
            }],
            ..ProjectAnalysisGraphInput::default()
        };

        assert!(analyze(&graph).unused_files.is_empty());
    }

    #[test]
    fn does_not_treat_re_exports_as_direct_importers() {
        let mut importer = module("src/index.ts");
        importer.is_reachable = true;
        let graph = ProjectAnalysisGraphInput {
            modules: vec![importer, module("src/imported.ts")],
            edges: vec![ProjectEdgeInput {
                source: 0,
                target: 1,
                is_re_export_edge: true,
                ..ProjectEdgeInput::default()
            }],
            ..ProjectAnalysisGraphInput::default()
        };

        assert_eq!(analyze(&graph).unused_files.len(), 1);
    }

    #[test]
    fn preserves_re_export_only_barrels_with_reachable_sources() {
        let mut barrel = module("src/barrel.ts");
        barrel.exports.push(ProjectExportInput {
            is_namespace_re_export: true,
            is_synthetic: false,
            ..ProjectExportInput::default()
        });
        let mut source = module("src/source.ts");
        source.is_reachable = true;
        let graph = ProjectAnalysisGraphInput {
            modules: vec![barrel, source],
            edges: vec![ProjectEdgeInput {
                source: 0,
                target: 1,
                is_re_export_edge: true,
                ..ProjectEdgeInput::default()
            }],
            ..ProjectAnalysisGraphInput::default()
        };

        assert!(analyze(&graph).unused_files.is_empty());
    }

    #[test]
    fn applies_source_path_exclusions() {
        let paths = [
            "src/component.test.tsx",
            "src/__tests__/component.tsx",
            "src/e2e/component.tsx",
            "src/vite.config.prod.ts",
            "src/setupTests.ts",
            "src/content.mdx",
        ];
        let graph = ProjectAnalysisGraphInput {
            modules: paths.into_iter().map(module).collect(),
            edges: vec![],
            ..ProjectAnalysisGraphInput::default()
        };

        assert!(analyze(&graph).unused_files.is_empty());
    }

    #[test]
    fn matches_canonical_config_filename_boundaries() {
        let excluded_filenames = [
            "vite.config.ts",
            "vite.config.production.tsx",
            "client.setup.js",
            "setupTests.jsx",
        ];
        let included_filenames = [
            ".config.ts",
            "vite.config..ts",
            "vite.configuration.ts",
            "client.setup.production.ts",
            "setuptests.ts",
        ];

        assert!(excluded_filenames.into_iter().all(is_config_filename));
        assert!(included_filenames
            .into_iter()
            .all(|filename| !is_config_filename(filename)));
    }

    #[test]
    fn applies_module_classification_exclusions() {
        let mut modules = Vec::new();
        for excluded_field in 0..7 {
            let mut excluded_module = module(&format!("src/excluded-{excluded_field}.ts"));
            match excluded_field {
                0 => excluded_module.is_reachable = true,
                1 => excluded_module.is_entry_point = true,
                2 => excluded_module.is_externally_consumed = true,
                3 => excluded_module.is_declaration_file = true,
                4 => excluded_module.is_config_file = true,
                5 => excluded_module.is_git_ignored = true,
                6 => excluded_module.is_analysis_excluded = true,
                _ => unreachable!(),
            }
            modules.push(excluded_module);
        }
        let graph = ProjectAnalysisGraphInput {
            modules,
            edges: vec![],
            ..ProjectAnalysisGraphInput::default()
        };

        assert!(analyze(&graph).unused_files.is_empty());
    }

    #[test]
    fn keeps_excluded_directory_names_before_node_modules() {
        let graph = ProjectAnalysisGraphInput {
            modules: vec![module("src/scripts/node_modules/package/index.ts")],
            edges: vec![],
            ..ProjectAnalysisGraphInput::default()
        };

        assert_eq!(analyze(&graph).unused_files.len(), 1);
    }

    #[test]
    fn preserves_files_with_opaque_parse_errors() {
        let mut opaque_module = module("src/bundle.js");
        opaque_module
            .parse_error_codes
            .push("file-minified".to_string());
        let graph = ProjectAnalysisGraphInput {
            modules: vec![opaque_module],
            edges: vec![],
            ..ProjectAnalysisGraphInput::default()
        };

        assert!(analyze(&graph).unused_files.is_empty());
    }
}
