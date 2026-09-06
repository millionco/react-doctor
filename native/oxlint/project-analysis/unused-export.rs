use std::collections::{HashMap, HashSet};

use super::{
    ProjectAnalysisGraphInput, ProjectEdgeInput, ProjectExportInput, ProjectReExportMappingInput,
    UnusedExportFinding,
};

struct ReExportTarget<'a> {
    target_index: usize,
    mappings: &'a [ProjectReExportMappingInput],
}

enum UsageWorkItem {
    All { module_index: usize },
    Named { path: String, name: String },
}

#[derive(Eq, Hash, PartialEq)]
enum UsageVisit {
    All(String),
    Named(String, String),
}

pub(super) fn analyze(graph: &ProjectAnalysisGraphInput) -> Vec<UnusedExportFinding> {
    let usage_map = build_usage_map(graph);
    let convention_consumed_exports = graph
        .convention_consumed_exports
        .iter()
        .map(|export| (export.path.as_str(), export.name.as_str()))
        .collect::<HashSet<_>>();
    let mut unused_exports = Vec::new();

    for module in &graph.modules {
        if module.has_package_dynamic_loader_uncertainty
            || !module.is_reachable && !module.is_externally_consumed
            || module.is_declaration_file
            || module.is_git_ignored
            || module.is_analysis_excluded
            || module.is_entry_point && !graph.include_entry_exports
        {
            continue;
        }

        let default_export_linked_names = module
            .exports
            .iter()
            .filter(|export| {
                export.is_default
                    && export.default_export_local_name.is_some()
                    && usage_map.contains(&(module.path.clone(), "default".to_string()))
            })
            .filter_map(|export| export.default_export_local_name.as_deref())
            .collect::<HashSet<_>>();

        for export in &module.exports {
            if export.name == "*" && export.is_namespace_re_export
                || export.is_re_export && export.re_export_original_name.is_some()
                || !graph.report_types && export.is_type_only
                || usage_map.contains(&(module.path.clone(), export.name.clone()))
                || convention_consumed_exports
                    .contains(&(module.path.as_str(), export.name.as_str()))
                || module.local_identifier_references.contains(&export.name)
                || !export.is_default && default_export_linked_names.contains(export.name.as_str())
                || export.is_default
                    && export
                        .default_export_local_name
                        .as_ref()
                        .is_some_and(|local_name| {
                            usage_map.contains(&(module.path.clone(), local_name.clone()))
                        })
            {
                continue;
            }
            unused_exports.push(UnusedExportFinding {
                path: module.path.clone(),
                name: export.name.clone(),
                line: export.line,
                column: export.column,
                is_type_only: export.is_type_only,
            });
        }
    }

    unused_exports
}

fn build_usage_map(graph: &ProjectAnalysisGraphInput) -> HashSet<(String, String)> {
    let mut used_exports = HashSet::new();
    let source_to_targets = build_source_to_targets_map(graph);
    let module_index_by_path = graph
        .modules
        .iter()
        .map(|module| (module.path.as_str(), module.index))
        .collect::<HashMap<_, _>>();
    let mut re_export_edges_by_source = HashMap::<usize, Vec<&ProjectEdgeInput>>::new();
    for edge in &graph.edges {
        if edge.is_re_export_edge {
            re_export_edges_by_source
                .entry(edge.source)
                .or_default()
                .push(edge);
        }
    }

    for module in &graph.modules {
        if !module.is_entry_point {
            continue;
        }
        for edge in re_export_edges_by_source
            .get(&module.index)
            .into_iter()
            .flatten()
        {
            let is_wildcard_re_export = edge.re_exported_names.iter().any(|name| name == "*");
            for target_index in sibling_targets(graph, edge.target) {
                let Some(target_module) = graph.modules.get(target_index) else {
                    continue;
                };
                if is_wildcard_re_export {
                    mark_exports_used(
                        graph,
                        &source_to_targets,
                        &module_index_by_path,
                        &mut used_exports,
                        UsageWorkItem::All {
                            module_index: target_index,
                        },
                    );
                    continue;
                }
                for mapping in &edge.re_export_mappings {
                    let work_item = if mapping.original_name == "*" {
                        UsageWorkItem::All {
                            module_index: target_index,
                        }
                    } else {
                        UsageWorkItem::Named {
                            path: target_module.path.clone(),
                            name: mapping.original_name.clone(),
                        }
                    };
                    mark_exports_used(
                        graph,
                        &source_to_targets,
                        &module_index_by_path,
                        &mut used_exports,
                        work_item,
                    );
                }
            }
        }
    }

    for edge in &graph.edges {
        let source_module = graph.modules.get(edge.source);
        for target_index in sibling_targets(graph, edge.target) {
            let Some(target_module) = graph.modules.get(target_index) else {
                continue;
            };
            if edge.is_dynamic && edge.imported_symbols.is_empty() {
                mark_exports_used(
                    graph,
                    &source_to_targets,
                    &module_index_by_path,
                    &mut used_exports,
                    UsageWorkItem::All {
                        module_index: target_index,
                    },
                );
                continue;
            }
            for symbol in &edge.imported_symbols {
                if symbol.is_namespace {
                    handle_namespace_import(
                        source_module,
                        target_index,
                        &symbol.local_name,
                        graph,
                        &source_to_targets,
                        &module_index_by_path,
                        &mut used_exports,
                    );
                    continue;
                }
                let import_name = if symbol.is_default {
                    "default"
                } else {
                    &symbol.imported_name
                };
                mark_exports_used(
                    graph,
                    &source_to_targets,
                    &module_index_by_path,
                    &mut used_exports,
                    UsageWorkItem::Named {
                        path: target_module.path.clone(),
                        name: import_name.to_string(),
                    },
                );

                if symbol.is_default
                    && !target_module.exports.iter().any(|export| export.is_default)
                    && symbol.local_name != "default"
                    && target_module
                        .exports
                        .iter()
                        .any(|export| export.name == symbol.local_name)
                {
                    mark_exports_used(
                        graph,
                        &source_to_targets,
                        &module_index_by_path,
                        &mut used_exports,
                        UsageWorkItem::Named {
                            path: target_module.path.clone(),
                            name: symbol.local_name.clone(),
                        },
                    );
                }
            }
        }
    }

    used_exports
}

fn sibling_targets(graph: &ProjectAnalysisGraphInput, target: usize) -> Vec<usize> {
    graph
        .platform_sibling_indices
        .get(target)
        .and_then(Option::as_ref)
        .cloned()
        .unwrap_or_else(|| vec![target])
}

fn build_source_to_targets_map(
    graph: &ProjectAnalysisGraphInput,
) -> HashMap<usize, Vec<ReExportTarget<'_>>> {
    let mut source_to_targets = HashMap::<usize, Vec<ReExportTarget<'_>>>::new();
    for edge in &graph.edges {
        if !edge.is_re_export_edge {
            continue;
        }
        for target_index in sibling_targets(graph, edge.target) {
            source_to_targets
                .entry(edge.source)
                .or_default()
                .push(ReExportTarget {
                    target_index,
                    mappings: &edge.re_export_mappings,
                });
        }
    }
    source_to_targets
}

fn handle_namespace_import(
    source_module: Option<&super::ProjectModuleInput>,
    target_module_index: usize,
    namespace_local_name: &str,
    graph: &ProjectAnalysisGraphInput,
    source_to_targets: &HashMap<usize, Vec<ReExportTarget<'_>>>,
    module_index_by_path: &HashMap<&str, usize>,
    used_exports: &mut HashSet<(String, String)>,
) {
    let Some(source_module) = source_module else {
        mark_exports_used(
            graph,
            source_to_targets,
            module_index_by_path,
            used_exports,
            UsageWorkItem::All {
                module_index: target_module_index,
            },
        );
        return;
    };
    if source_module
        .whole_object_uses
        .contains(&namespace_local_name.to_string())
    {
        mark_exports_used(
            graph,
            source_to_targets,
            module_index_by_path,
            used_exports,
            UsageWorkItem::All {
                module_index: target_module_index,
            },
        );
        return;
    }

    let mut accessed_member_names = Vec::new();
    let mut seen_member_names = HashSet::new();
    for access in &source_module.member_accesses {
        if access.object_name == namespace_local_name
            && seen_member_names.insert(access.member_name.as_str())
        {
            accessed_member_names.push(access.member_name.as_str());
        }
    }
    let is_namespace_re_exported = source_module.exports.iter().any(|export| {
        export.re_export_original_name.as_deref() == Some(namespace_local_name)
            || !export.is_re_export && export.name == namespace_local_name
    });
    if accessed_member_names.is_empty() || is_namespace_re_exported {
        mark_exports_used(
            graph,
            source_to_targets,
            module_index_by_path,
            used_exports,
            UsageWorkItem::All {
                module_index: target_module_index,
            },
        );
        return;
    }
    let Some(target_module) = graph.modules.get(target_module_index) else {
        return;
    };
    for member_name in accessed_member_names {
        mark_exports_used(
            graph,
            source_to_targets,
            module_index_by_path,
            used_exports,
            UsageWorkItem::Named {
                path: target_module.path.clone(),
                name: member_name.to_string(),
            },
        );
    }
}

fn mark_exports_used(
    graph: &ProjectAnalysisGraphInput,
    source_to_targets: &HashMap<usize, Vec<ReExportTarget<'_>>>,
    module_index_by_path: &HashMap<&str, usize>,
    used_exports: &mut HashSet<(String, String)>,
    initial_work_item: UsageWorkItem,
) {
    let mut visited = HashSet::new();
    let mut work_items = vec![initial_work_item];

    while let Some(work_item) = work_items.pop() {
        match work_item {
            UsageWorkItem::All { module_index } => {
                let Some(module) = graph.modules.get(module_index) else {
                    continue;
                };
                if !visited.insert(UsageVisit::All(module.path.clone())) {
                    continue;
                }
                for export in &module.exports {
                    if export.name == "*" && export.is_namespace_re_export {
                        continue;
                    }
                    used_exports.insert((module.path.clone(), export.name.clone()));
                    if export.is_re_export && export.has_re_export_source {
                        push_re_export_work_items(
                            module.index,
                            export,
                            graph,
                            source_to_targets,
                            &mut work_items,
                        );
                    }
                }
            }
            UsageWorkItem::Named { path, name } => {
                if !visited.insert(UsageVisit::Named(path.clone(), name.clone())) {
                    continue;
                }
                used_exports.insert((path.clone(), name.clone()));
                let Some(module_index) = module_index_by_path.get(path.as_str()).copied() else {
                    continue;
                };
                let Some(module) = graph.modules.get(module_index) else {
                    continue;
                };
                for export in module.exports.iter().filter(|export| export.name == name) {
                    if export.is_re_export && export.has_re_export_source {
                        push_re_export_work_items(
                            module.index,
                            export,
                            graph,
                            source_to_targets,
                            &mut work_items,
                        );
                    }
                }
            }
        }
    }
}

fn push_re_export_work_items(
    re_exporter_module_index: usize,
    export: &ProjectExportInput,
    graph: &ProjectAnalysisGraphInput,
    source_to_targets: &HashMap<usize, Vec<ReExportTarget<'_>>>,
    work_items: &mut Vec<UsageWorkItem>,
) {
    let Some(targets) = source_to_targets.get(&re_exporter_module_index) else {
        return;
    };
    let original_name = export
        .re_export_original_name
        .as_deref()
        .unwrap_or(&export.name);
    for target in targets {
        let has_matching_mapping = target.mappings.iter().any(|mapping| {
            mapping.exported_name == export.name && mapping.original_name == original_name
                || export.is_synthetic
                    && mapping.exported_name == "*"
                    && mapping.original_name == "*"
        });
        if !has_matching_mapping {
            continue;
        }
        let Some(target_module) = graph.modules.get(target.target_index) else {
            continue;
        };
        if original_name == "*" || export.is_namespace_re_export {
            work_items.push(UsageWorkItem::All {
                module_index: target.target_index,
            });
        } else if target_module.exports.iter().any(|target_export| {
            target_export.name == original_name
                || target_export.is_namespace_re_export && target_export.name == "*"
        }) {
            work_items.push(UsageWorkItem::Named {
                path: target_module.path.clone(),
                name: original_name.to_string(),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        ProjectExportKeyInput, ProjectLinkedSymbolInput, ProjectMemberAccessInput,
        ProjectModuleInput,
    };
    use super::*;

    fn module(index: usize, path: &str) -> ProjectModuleInput {
        ProjectModuleInput {
            index,
            path: path.to_string(),
            is_reachable: true,
            ..ProjectModuleInput::default()
        }
    }

    fn export(name: &str, is_type_only: bool) -> ProjectExportInput {
        ProjectExportInput {
            name: name.to_string(),
            is_type_only,
            line: 2,
            column: 3,
            ..ProjectExportInput::default()
        }
    }

    fn graph(
        modules: Vec<ProjectModuleInput>,
        edges: Vec<ProjectEdgeInput>,
    ) -> ProjectAnalysisGraphInput {
        ProjectAnalysisGraphInput {
            modules,
            edges,
            report_types: true,
            ..ProjectAnalysisGraphInput::default()
        }
    }

    #[test]
    fn reports_value_and_type_exports_in_module_order() {
        let graph = graph(
            vec![{
                let mut module = module(0, "src/library.ts");
                module.exports = vec![export("value", false), export("Shape", true)];
                module
            }],
            vec![],
        );

        assert_eq!(
            analyze(&graph),
            [
                UnusedExportFinding {
                    path: "src/library.ts".to_string(),
                    name: "value".to_string(),
                    line: 2,
                    column: 3,
                    is_type_only: false,
                },
                UnusedExportFinding {
                    path: "src/library.ts".to_string(),
                    name: "Shape".to_string(),
                    line: 2,
                    column: 3,
                    is_type_only: true,
                },
            ]
        );
    }

    #[test]
    fn follows_namespace_member_usage_across_platform_siblings() {
        let mut importer = module(0, "src/index.ts");
        importer.member_accesses.push(ProjectMemberAccessInput {
            object_name: "library".to_string(),
            member_name: "usedMember".to_string(),
        });
        let mut base = module(1, "src/library.ts");
        base.exports = vec![export("usedMember", false), export("stale", false)];
        let mut platform = module(2, "src/library.native.ts");
        platform.exports = vec![export("usedMember", false), export("stale", false)];
        let graph = ProjectAnalysisGraphInput {
            platform_sibling_indices: vec![None, Some(vec![1, 2]), Some(vec![1, 2])],
            ..graph(
                vec![importer, base, platform],
                vec![ProjectEdgeInput {
                    source: 0,
                    target: 1,
                    imported_symbols: vec![ProjectLinkedSymbolInput {
                        local_name: "library".to_string(),
                        is_namespace: true,
                        ..ProjectLinkedSymbolInput::default()
                    }],
                    ..ProjectEdgeInput::default()
                }],
            )
        };

        assert_eq!(
            analyze(&graph)
                .into_iter()
                .map(|finding| (finding.path, finding.name))
                .collect::<Vec<_>>(),
            [
                ("src/library.ts".to_string(), "stale".to_string()),
                ("src/library.native.ts".to_string(), "stale".to_string()),
            ]
        );
    }

    #[test]
    fn honors_entry_type_convention_and_local_reference_filters() {
        let mut module = module(0, "src/page.tsx");
        module.is_entry_point = true;
        module.local_identifier_references.push("local".to_string());
        module.exports = vec![
            export("runtime", false),
            export("Shape", true),
            export("local", false),
            ProjectExportInput {
                name: "default".to_string(),
                is_default: true,
                default_export_local_name: Some("Page".to_string()),
                ..export("default", false)
            },
            export("Page", false),
        ];
        let graph = ProjectAnalysisGraphInput {
            modules: vec![module],
            convention_consumed_exports: vec![ProjectExportKeyInput {
                path: "src/page.tsx".to_string(),
                name: "runtime".to_string(),
            }],
            report_types: false,
            include_entry_exports: true,
            ..ProjectAnalysisGraphInput::default()
        };

        assert_eq!(
            analyze(&graph)
                .into_iter()
                .map(|finding| finding.name)
                .collect::<Vec<_>>(),
            ["default".to_string(), "Page".to_string()]
        );
    }

    #[test]
    fn preserves_exports_behind_dynamic_imports_and_default_aliases() {
        let importer = module(0, "src/index.ts");
        let mut dynamic_target = module(1, "src/lazy.ts");
        dynamic_target.exports = vec![export("first", false), export("second", false)];
        let mut default_target = module(2, "src/page.tsx");
        default_target.exports = vec![
            ProjectExportInput {
                name: "default".to_string(),
                is_default: true,
                default_export_local_name: Some("Page".to_string()),
                ..export("default", false)
            },
            export("Page", false),
        ];
        let graph = graph(
            vec![importer, dynamic_target, default_target],
            vec![
                ProjectEdgeInput {
                    source: 0,
                    target: 1,
                    is_dynamic: true,
                    ..ProjectEdgeInput::default()
                },
                ProjectEdgeInput {
                    source: 0,
                    target: 2,
                    imported_symbols: vec![ProjectLinkedSymbolInput {
                        imported_name: "default".to_string(),
                        local_name: "Page".to_string(),
                        is_default: true,
                        ..ProjectLinkedSymbolInput::default()
                    }],
                    ..ProjectEdgeInput::default()
                },
            ],
        );

        assert!(analyze(&graph).is_empty());
    }

    #[test]
    fn propagates_named_usage_through_re_export_chains() {
        let importer = module(0, "src/index.ts");
        let mut barrel = module(1, "src/barrel.ts");
        barrel.exports = vec![ProjectExportInput {
            name: "PublicName".to_string(),
            is_re_export: true,
            has_re_export_source: true,
            re_export_original_name: Some("InnerName".to_string()),
            ..ProjectExportInput::default()
        }];
        let mut leaf = module(2, "src/leaf.ts");
        leaf.exports = vec![export("InnerName", false), export("stale", false)];
        let graph = graph(
            vec![importer, barrel, leaf],
            vec![
                ProjectEdgeInput {
                    source: 0,
                    target: 1,
                    imported_symbols: vec![ProjectLinkedSymbolInput {
                        imported_name: "PublicName".to_string(),
                        local_name: "PublicName".to_string(),
                        ..ProjectLinkedSymbolInput::default()
                    }],
                    ..ProjectEdgeInput::default()
                },
                ProjectEdgeInput {
                    source: 1,
                    target: 2,
                    is_re_export_edge: true,
                    re_export_mappings: vec![ProjectReExportMappingInput {
                        exported_name: "PublicName".to_string(),
                        original_name: "InnerName".to_string(),
                    }],
                    ..ProjectEdgeInput::default()
                },
            ],
        );

        assert_eq!(
            analyze(&graph)
                .into_iter()
                .map(|finding| finding.name)
                .collect::<Vec<_>>(),
            ["stale".to_string()]
        );
    }
}
