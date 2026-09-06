use std::{cmp::Ordering, collections::HashSet};

use super::{CircularDependencyFinding, ProjectAnalysisGraphInput, ProjectEdgeInput};

const MAX_CYCLES_PER_SCC: usize = 20;
const MAX_TOTAL_CYCLES: usize = 200;
const MAX_SCC_SIZE_FOR_ENUMERATION: usize = 50;

struct StronglyConnectedComponentFrame {
    node_index: usize,
    successor_index: usize,
}

struct StronglyConnectedComponentState {
    node_indices: Vec<Option<usize>>,
    low_links: Vec<usize>,
    nodes_on_stack: Vec<bool>,
    component_stack: Vec<usize>,
    components: Vec<Vec<usize>>,
    next_node_index: usize,
}

pub(super) fn analyze(graph: &ProjectAnalysisGraphInput) -> Vec<CircularDependencyFinding> {
    let adjacency_list = build_adjacency_list(graph);
    let init_access_edges = build_module_init_access_edge_set(graph);
    let mut components = find_strongly_connected_components(&adjacency_list)
        .into_iter()
        .filter(|component| component.len() >= 2)
        .collect::<Vec<_>>();
    components.sort_by_key(Vec::len);

    let mut all_cycles = Vec::new();
    let mut seen_cycles = HashSet::new();
    for component in components {
        if all_cycles.len() >= MAX_TOTAL_CYCLES {
            break;
        }
        if component.len() > MAX_SCC_SIZE_FOR_ENUMERATION {
            continue;
        }
        for cycle in enumerate_elementary_cycles(&component, &adjacency_list, graph) {
            if !cycle_has_module_init_access(&cycle, &init_access_edges) {
                continue;
            }
            if seen_cycles.insert(cycle.clone()) {
                all_cycles.push(cycle);
            }
            if all_cycles.len() >= MAX_TOTAL_CYCLES {
                break;
            }
        }
    }
    all_cycles.sort_by_key(Vec::len);
    all_cycles
        .into_iter()
        .map(|cycle| CircularDependencyFinding {
            files: cycle
                .into_iter()
                .map(|node_index| graph.modules[node_index].path.clone())
                .collect(),
        })
        .collect()
}

fn build_adjacency_list(graph: &ProjectAnalysisGraphInput) -> Vec<Vec<usize>> {
    let mut adjacency_list = vec![Vec::new(); graph.modules.len()];
    let mut target_sets = (0..graph.modules.len())
        .map(|_| HashSet::new())
        .collect::<Vec<_>>();
    for edge in &graph.edges {
        let Some(source_module) = graph.modules.get(edge.source) else {
            continue;
        };
        let Some(target_module) = graph.modules.get(edge.target) else {
            continue;
        };
        if source_module.is_analysis_excluded
            || target_module.is_analysis_excluded
            || edge.is_dynamic
            || edge.is_type_only
            || (!edge.imported_symbols.is_empty()
                && edge
                    .imported_symbols
                    .iter()
                    .all(|symbol| symbol.is_type_only))
            || is_compile_time_erased_edge(edge, graph)
        {
            continue;
        }
        if target_sets[edge.source].insert(edge.target) {
            adjacency_list[edge.source].push(edge.target);
        }
    }
    adjacency_list
}

fn is_compile_time_erased_edge(edge: &ProjectEdgeInput, graph: &ProjectAnalysisGraphInput) -> bool {
    if edge.is_re_export_edge || edge.imported_symbols.is_empty() {
        return false;
    }
    let Some(target_module) = graph.modules.get(edge.target) else {
        return false;
    };
    edge.imported_symbols.iter().all(|symbol| {
        if symbol.is_type_only {
            return true;
        }
        if symbol.is_namespace {
            return false;
        }
        let export_name = if symbol.is_default {
            "default"
        } else {
            symbol.imported_name.as_str()
        };
        let mut matching_exports = target_module
            .exports
            .iter()
            .filter(|export| export.name == export_name)
            .peekable();
        matching_exports.peek().is_some() && matching_exports.all(|export| export.is_type_only)
    })
}

fn build_module_init_access_edge_set(graph: &ProjectAnalysisGraphInput) -> HashSet<(usize, usize)> {
    let mut init_access_edges = HashSet::new();
    for edge in &graph.edges {
        if edge.is_dynamic || edge.is_re_export_edge || edge.is_type_only {
            continue;
        }
        if edge.is_side_effect || edge.imported_symbols.is_empty() {
            init_access_edges.insert((edge.source, edge.target));
            continue;
        }
        let Some(source_module) = graph.modules.get(edge.source) else {
            continue;
        };
        if edge.imported_symbols.iter().any(|symbol| {
            !symbol.is_type_only
                && source_module
                    .top_level_import_references
                    .contains(&symbol.local_name)
        }) {
            init_access_edges.insert((edge.source, edge.target));
        }
    }
    init_access_edges
}

fn cycle_has_module_init_access(
    cycle: &[usize],
    init_access_edges: &HashSet<(usize, usize)>,
) -> bool {
    cycle.iter().enumerate().any(|(position, source)| {
        let target = cycle[(position + 1) % cycle.len()];
        init_access_edges.contains(&(*source, target))
    })
}

fn compare_javascript_strings(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn canonicalize_cycle(cycle: &[usize], graph: &ProjectAnalysisGraphInput) -> Vec<usize> {
    let Some((minimum_position, _)) = cycle.iter().enumerate().min_by(|(_, left), (_, right)| {
        compare_javascript_strings(&graph.modules[**left].path, &graph.modules[**right].path)
    }) else {
        return Vec::new();
    };
    cycle[minimum_position..]
        .iter()
        .chain(&cycle[..minimum_position])
        .copied()
        .collect()
}

fn enumerate_elementary_cycles(
    component_nodes: &[usize],
    adjacency_list: &[Vec<usize>],
    graph: &ProjectAnalysisGraphInput,
) -> Vec<Vec<usize>> {
    if let [node_a, node_b] = component_nodes {
        return if compare_javascript_strings(
            &graph.modules[*node_a].path,
            &graph.modules[*node_b].path,
        ) != Ordering::Greater
        {
            vec![vec![*node_a, *node_b]]
        } else {
            vec![vec![*node_b, *node_a]]
        };
    }

    let component_set = component_nodes.iter().copied().collect::<HashSet<_>>();
    let mut cycles = Vec::new();
    let mut seen_cycles = HashSet::new();
    for &start_node in component_nodes {
        if cycles.len() >= MAX_CYCLES_PER_SCC {
            break;
        }
        let mut visited_in_this_search = HashSet::from([start_node]);
        let mut path_stack = vec![start_node];
        let mut successor_position_stack = vec![0];
        while !path_stack.is_empty() && cycles.len() < MAX_CYCLES_PER_SCC {
            let current_node = *path_stack.last().expect("path stack is non-empty");
            let successor_position = successor_position_stack
                .last_mut()
                .expect("successor stack follows path stack");
            while *successor_position < adjacency_list[current_node].len()
                && !component_set.contains(&adjacency_list[current_node][*successor_position])
            {
                *successor_position += 1;
            }
            if *successor_position < adjacency_list[current_node].len() {
                let successor = adjacency_list[current_node][*successor_position];
                *successor_position += 1;
                if successor == start_node {
                    let canonical_cycle = canonicalize_cycle(&path_stack, graph);
                    if seen_cycles.insert(canonical_cycle.clone()) {
                        cycles.push(canonical_cycle);
                    }
                } else if visited_in_this_search.insert(successor) {
                    path_stack.push(successor);
                    successor_position_stack.push(0);
                }
            } else {
                if let Some(node_index) = path_stack.pop() {
                    visited_in_this_search.remove(&node_index);
                }
                successor_position_stack.pop();
            }
        }
    }
    cycles
}

fn find_strongly_connected_components(adjacency_list: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let mut state = StronglyConnectedComponentState {
        node_indices: vec![None; adjacency_list.len()],
        low_links: vec![0; adjacency_list.len()],
        nodes_on_stack: vec![false; adjacency_list.len()],
        component_stack: Vec::new(),
        components: Vec::new(),
        next_node_index: 0,
    };
    for start_node_index in 0..adjacency_list.len() {
        if state.node_indices[start_node_index].is_some() {
            continue;
        }
        traverse_strongly_connected_component(start_node_index, adjacency_list, &mut state);
    }
    state.components
}

fn discover_node(node_index: usize, state: &mut StronglyConnectedComponentState) {
    state.node_indices[node_index] = Some(state.next_node_index);
    state.low_links[node_index] = state.next_node_index;
    state.next_node_index += 1;
    state.nodes_on_stack[node_index] = true;
    state.component_stack.push(node_index);
}

fn traverse_strongly_connected_component(
    start_node_index: usize,
    adjacency_list: &[Vec<usize>],
    state: &mut StronglyConnectedComponentState,
) {
    discover_node(start_node_index, state);
    let mut traversal_stack = vec![StronglyConnectedComponentFrame {
        node_index: start_node_index,
        successor_index: 0,
    }];
    while !traversal_stack.is_empty() {
        let frame_index = traversal_stack.len() - 1;
        let node_index = traversal_stack[frame_index].node_index;
        let successor_index = traversal_stack[frame_index].successor_index;
        if successor_index < adjacency_list[node_index].len() {
            let successor_node_index = adjacency_list[node_index][successor_index];
            traversal_stack[frame_index].successor_index += 1;
            if state.node_indices[successor_node_index].is_none() {
                discover_node(successor_node_index, state);
                traversal_stack.push(StronglyConnectedComponentFrame {
                    node_index: successor_node_index,
                    successor_index: 0,
                });
            } else if state.nodes_on_stack[successor_node_index] {
                state.low_links[node_index] = state.low_links[node_index]
                    .min(state.node_indices[successor_node_index].unwrap_or_default());
            }
            continue;
        }

        let current_traversal_index = state.node_indices[node_index].unwrap_or_default();
        traversal_stack.pop();
        if let Some(parent_frame) = traversal_stack.last() {
            state.low_links[parent_frame.node_index] =
                state.low_links[parent_frame.node_index].min(state.low_links[node_index]);
        }
        if current_traversal_index != state.low_links[node_index] {
            continue;
        }
        let mut component = Vec::new();
        while let Some(component_node_index) = state.component_stack.pop() {
            state.nodes_on_stack[component_node_index] = false;
            component.push(component_node_index);
            if component_node_index == node_index {
                break;
            }
        }
        state.components.push(component);
    }
}

#[cfg(test)]
mod tests {
    use super::super::{ProjectExportInput, ProjectLinkedSymbolInput, ProjectModuleInput};
    use super::*;

    fn module(path: &str) -> ProjectModuleInput {
        ProjectModuleInput {
            path: path.to_string(),
            ..ProjectModuleInput::default()
        }
    }

    fn runtime_edge(source: usize, target: usize, local_name: &str) -> ProjectEdgeInput {
        ProjectEdgeInput {
            source,
            target,
            imported_symbols: vec![ProjectLinkedSymbolInput {
                imported_name: local_name.to_string(),
                local_name: local_name.to_string(),
                ..ProjectLinkedSymbolInput::default()
            }],
            ..ProjectEdgeInput::default()
        }
    }

    #[test]
    fn reports_runtime_cycles_with_module_init_access() {
        let mut module_a = module("src/a.ts");
        module_a
            .top_level_import_references
            .push("valueB".to_string());
        let graph = ProjectAnalysisGraphInput {
            modules: vec![module_a, module("src/b.ts")],
            edges: vec![runtime_edge(0, 1, "valueB"), runtime_edge(1, 0, "valueA")],
        };

        assert_eq!(
            analyze(&graph),
            [CircularDependencyFinding {
                files: vec!["src/a.ts".to_string(), "src/b.ts".to_string()],
            }]
        );
    }

    #[test]
    fn suppresses_function_only_dynamic_type_only_and_erased_cycles() {
        let mut type_module = module("src/type-a.ts");
        type_module.exports.push(ProjectExportInput {
            name: "Shape".to_string(),
            is_type_only: true,
            ..ProjectExportInput::default()
        });
        let graphs = [
            ProjectAnalysisGraphInput {
                modules: vec![module("src/a.ts"), module("src/b.ts")],
                edges: vec![runtime_edge(0, 1, "valueB"), runtime_edge(1, 0, "valueA")],
            },
            ProjectAnalysisGraphInput {
                modules: vec![module("src/a.ts"), module("src/b.ts")],
                edges: vec![
                    ProjectEdgeInput {
                        is_dynamic: true,
                        ..runtime_edge(0, 1, "valueB")
                    },
                    runtime_edge(1, 0, "valueA"),
                ],
            },
            ProjectAnalysisGraphInput {
                modules: vec![module("src/a.ts"), module("src/b.ts")],
                edges: vec![
                    ProjectEdgeInput {
                        is_type_only: true,
                        ..runtime_edge(0, 1, "valueB")
                    },
                    runtime_edge(1, 0, "valueA"),
                ],
            },
            ProjectAnalysisGraphInput {
                modules: vec![module("src/value.ts"), type_module],
                edges: vec![runtime_edge(0, 1, "Shape"), runtime_edge(1, 0, "value")],
            },
        ];

        assert!(graphs.iter().all(|graph| analyze(graph).is_empty()));
    }

    #[test]
    fn reports_side_effect_cycles_and_skips_excluded_modules() {
        let side_effect_graph = ProjectAnalysisGraphInput {
            modules: vec![module("src/a.ts"), module("src/b.ts")],
            edges: vec![
                ProjectEdgeInput {
                    source: 0,
                    target: 1,
                    is_side_effect: true,
                    ..ProjectEdgeInput::default()
                },
                runtime_edge(1, 0, "valueA"),
            ],
        };
        assert_eq!(analyze(&side_effect_graph).len(), 1);

        let mut excluded_module = module("src/b.ts");
        excluded_module.is_analysis_excluded = true;
        let excluded_graph = ProjectAnalysisGraphInput {
            modules: vec![module("src/a.ts"), excluded_module],
            edges: vec![
                ProjectEdgeInput {
                    source: 0,
                    target: 1,
                    is_side_effect: true,
                    ..ProjectEdgeInput::default()
                },
                runtime_edge(1, 0, "valueA"),
            ],
        };
        assert!(analyze(&excluded_graph).is_empty());
    }

    #[test]
    fn matches_javascript_utf16_cycle_rotation() {
        let mut astral_module = module("src/\u{10000}.ts");
        astral_module
            .top_level_import_references
            .push("value".to_string());
        let graph = ProjectAnalysisGraphInput {
            modules: vec![module("src/\u{e000}.ts"), astral_module],
            edges: vec![runtime_edge(0, 1, "value"), runtime_edge(1, 0, "value")],
        };

        assert_eq!(analyze(&graph)[0].files[0], "src/\u{10000}.ts");
    }

    #[test]
    fn enforces_scc_and_cycle_caps() {
        let oversized_module_count = MAX_SCC_SIZE_FOR_ENUMERATION + 1;
        let oversized_graph = ProjectAnalysisGraphInput {
            modules: (0..oversized_module_count)
                .map(|index| module(&format!("src/{index}.ts")))
                .collect(),
            edges: (0..oversized_module_count)
                .map(|index| ProjectEdgeInput {
                    source: index,
                    target: (index + 1) % oversized_module_count,
                    is_side_effect: true,
                    ..ProjectEdgeInput::default()
                })
                .collect(),
        };
        assert!(analyze(&oversized_graph).is_empty());

        let mut modules = Vec::new();
        let mut edges = Vec::new();
        for component_index in 0..11 {
            let component_start = modules.len();
            for node_index in 0..4 {
                modules.push(module(&format!("src/{component_index}-{node_index}.ts")));
            }
            for source in component_start..component_start + 4 {
                for target in component_start..component_start + 4 {
                    if source != target {
                        edges.push(ProjectEdgeInput {
                            source,
                            target,
                            is_side_effect: true,
                            ..ProjectEdgeInput::default()
                        });
                    }
                }
            }
        }
        let capped_graph = ProjectAnalysisGraphInput { modules, edges };
        assert_eq!(analyze(&capped_graph).len(), MAX_TOTAL_CYCLES);
    }
}
