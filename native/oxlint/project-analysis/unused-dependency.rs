use std::collections::{HashMap, HashSet};

use super::{
    ProjectAnalysisOutput, SkippedDependencyFinding, StalePackageAnalysisInput,
    UnusedDependencyFinding,
};

pub(super) fn analyze(input: &StalePackageAnalysisInput, output: &mut ProjectAnalysisOutput) {
    let declared_names = input
        .declared_dependencies
        .iter()
        .map(|dependency| dependency.name.as_str())
        .collect::<HashSet<_>>();
    let observed_package_names = input
        .observed_package_names
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let mut used_package_names = input
        .used_package_names
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let peer_satisfied_package_names = input
        .peer_satisfied_package_names
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let ambiguous_binary_package_names = input
        .ambiguous_binary_package_names
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let mut skipped_reasons_by_name = HashMap::<&str, HashSet<&str>>::new();

    for dependency in &input.declared_dependencies {
        if observed_package_names.contains(dependency.name.as_str())
            || peer_satisfied_package_names.contains(dependency.name.as_str())
        {
            continue;
        }
        if dependency.is_always_considered_used {
            skipped_reasons_by_name
                .entry(dependency.name.as_str())
                .or_default()
                .insert("allowlisted-name");
        }
        if ambiguous_binary_package_names.contains(dependency.name.as_str()) {
            skipped_reasons_by_name
                .entry(dependency.name.as_str())
                .or_default()
                .insert("ambiguous-binary");
        }
    }

    let mut candidate_unused = input
        .declared_dependencies
        .iter()
        .filter(|dependency| {
            !dependency.is_always_considered_used
                && !used_package_names.contains(dependency.name.as_str())
                && !ambiguous_binary_package_names.contains(dependency.name.as_str())
        })
        .map(|dependency| dependency.name.as_str())
        .collect::<HashSet<_>>();

    for package_name in &input.source_file_rescued_package_names {
        used_package_names.insert(package_name);
        candidate_unused.remove(package_name.as_str());
    }

    for override_mapping in &input.override_mappings {
        if used_package_names.contains(override_mapping.from_package.as_str())
            && declared_names.contains(override_mapping.to_package.as_str())
        {
            used_package_names.insert(&override_mapping.to_package);
            candidate_unused.remove(override_mapping.to_package.as_str());
        }
    }

    for package_name in &input.final_peer_satisfied_package_names {
        used_package_names.insert(package_name);
        candidate_unused.remove(package_name.as_str());
    }

    if !input.is_peer_metadata_complete {
        for dependency in &input.declared_dependencies {
            if candidate_unused.contains(dependency.name.as_str()) {
                skipped_reasons_by_name
                    .entry(dependency.name.as_str())
                    .or_default()
                    .insert("incomplete-peer-metadata");
            }
        }
        candidate_unused.clear();
    }

    for dependency in &input.declared_dependencies {
        if !candidate_unused.contains(dependency.name.as_str()) {
            continue;
        }
        let dependency_section = if dependency.is_dev_dependency {
            "devDependencies"
        } else {
            "dependencies"
        };
        output.unused_dependencies.push(UnusedDependencyFinding {
            name: dependency.name.clone(),
            is_dev_dependency: dependency.is_dev_dependency,
            reason: format!(
                "\"{}\" is declared in {dependency_section} but is never imported or referenced by any source file, script, or config — remove it from package.json if it is genuinely unused",
                dependency.name
            ),
        });
    }

    let is_dev_dependency_by_name = input
        .declared_dependencies
        .iter()
        .map(|dependency| (dependency.name.as_str(), dependency.is_dev_dependency))
        .collect::<HashMap<_, _>>();
    for name in &input.sorted_declared_dependency_names {
        let Some(reasons) = skipped_reasons_by_name.remove(name.as_str()) else {
            continue;
        };
        let mut reasons = reasons.into_iter().map(str::to_string).collect::<Vec<_>>();
        reasons.sort_unstable();
        output.skipped_dependencies.push(SkippedDependencyFinding {
            name: name.clone(),
            is_dev_dependency: is_dev_dependency_by_name
                .get(name.as_str())
                .copied()
                .unwrap_or(false),
            reasons,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::super::{DeclaredDependencyAnalysisInput, OverrideMappingInput};
    use super::*;

    fn dependency(name: &str, is_dev_dependency: bool) -> DeclaredDependencyAnalysisInput {
        DeclaredDependencyAnalysisInput {
            name: name.to_string(),
            is_dev_dependency,
            is_always_considered_used: false,
        }
    }

    #[test]
    fn preserves_declaration_order_and_dependency_kind() {
        let input = StalePackageAnalysisInput {
            declared_dependencies: vec![
                dependency("z-runtime", false),
                dependency("a-development", true),
            ],
            is_peer_metadata_complete: true,
            ..StalePackageAnalysisInput::default()
        };
        let mut output = ProjectAnalysisOutput::default();

        analyze(&input, &mut output);

        assert_eq!(
            output.unused_dependencies,
            [
                UnusedDependencyFinding {
                    name: "z-runtime".to_string(),
                    is_dev_dependency: false,
                    reason: "\"z-runtime\" is declared in dependencies but is never imported or referenced by any source file, script, or config — remove it from package.json if it is genuinely unused".to_string(),
                },
                UnusedDependencyFinding {
                    name: "a-development".to_string(),
                    is_dev_dependency: true,
                    reason: "\"a-development\" is declared in devDependencies but is never imported or referenced by any source file, script, or config — remove it from package.json if it is genuinely unused".to_string(),
                },
            ]
        );
    }

    #[test]
    fn applies_exemptions_rescues_overrides_and_peer_safety() {
        let mut allowlisted = dependency("allowlisted", false);
        allowlisted.is_always_considered_used = true;
        let input = StalePackageAnalysisInput {
            declared_dependencies: vec![
                allowlisted,
                dependency("ambiguous", true),
                dependency("rescued", false),
                dependency("used-source", false),
                dependency("override-target", false),
                dependency("peer", true),
                dependency("candidate", false),
            ],
            sorted_declared_dependency_names: vec![
                "allowlisted".to_string(),
                "ambiguous".to_string(),
                "candidate".to_string(),
                "override-target".to_string(),
                "peer".to_string(),
                "rescued".to_string(),
                "used-source".to_string(),
            ],
            used_package_names: vec!["used-source".to_string()],
            ambiguous_binary_package_names: vec!["ambiguous".to_string()],
            source_file_rescued_package_names: vec!["rescued".to_string()],
            override_mappings: vec![OverrideMappingInput {
                from_package: "used-source".to_string(),
                to_package: "override-target".to_string(),
            }],
            final_peer_satisfied_package_names: vec!["peer".to_string()],
            is_peer_metadata_complete: false,
            ..StalePackageAnalysisInput::default()
        };
        let mut output = ProjectAnalysisOutput::default();

        analyze(&input, &mut output);

        assert!(output.unused_dependencies.is_empty());
        assert_eq!(
            output.skipped_dependencies,
            [
                SkippedDependencyFinding {
                    name: "allowlisted".to_string(),
                    is_dev_dependency: false,
                    reasons: vec!["allowlisted-name".to_string()],
                },
                SkippedDependencyFinding {
                    name: "ambiguous".to_string(),
                    is_dev_dependency: true,
                    reasons: vec!["ambiguous-binary".to_string()],
                },
                SkippedDependencyFinding {
                    name: "candidate".to_string(),
                    is_dev_dependency: false,
                    reasons: vec!["incomplete-peer-metadata".to_string()],
                },
            ]
        );
    }
}
