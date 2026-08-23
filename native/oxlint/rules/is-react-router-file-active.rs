use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
};

#[derive(Debug)]
struct ReactRouterPackageSummary {
    directory: PathBuf,
    has_any_dependency: bool,
    has_react_router_dependency: bool,
}

static REACT_ROUTER_PACKAGE_SUMMARIES: LazyLock<
    Mutex<HashMap<PathBuf, Option<Arc<ReactRouterPackageSummary>>>>,
> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn is_react_router_file_active(ctx: &crate::context::ContextHost<'_>) -> bool {
    let Some(package_summary) = nearest_react_router_package_summary(ctx.file_path()) else {
        return true;
    };
    if package_summary.has_react_router_dependency || !package_summary.has_any_dependency {
        return true;
    }
    !react_doctor_root_directory(ctx)
        .as_deref()
        .is_some_and(|root_directory| {
            is_nested_package_within_root(&package_summary.directory, root_directory)
        })
}

fn react_doctor_root_directory(ctx: &crate::context::ContextHost<'_>) -> Option<PathBuf> {
    ctx.settings()
        .json
        .as_ref()?
        .get("react-doctor")?
        .as_object()?
        .get("rootDirectory")?
        .as_str()
        .filter(|root_directory| !root_directory.is_empty())
        .map(PathBuf::from)
}

fn is_nested_package_within_root(package_directory: &Path, root_directory: &Path) -> bool {
    let resolved_package_directory = package_directory
        .canonicalize()
        .unwrap_or_else(|_| package_directory.to_path_buf());
    resolved_package_directory != root_directory
        && resolved_package_directory.starts_with(root_directory)
}

fn nearest_react_router_package_summary(
    file_path: &Path,
) -> Option<Arc<ReactRouterPackageSummary>> {
    let mut directory = file_path.parent()?;
    let mut visited_directories = Vec::new();
    loop {
        let cached_package_summary = {
            let cache = REACT_ROUTER_PACKAGE_SUMMARIES
                .lock()
                .expect("react router package cache lock should not be poisoned");
            cache.get(directory).cloned()
        };
        if let Some(package_summary) = cached_package_summary {
            cache_react_router_package_summary(&visited_directories, package_summary.clone());
            return package_summary;
        }
        visited_directories.push(directory.to_path_buf());
        let package_json_path = directory.join("package.json");
        if package_json_path.is_file() {
            let package_summary = read_react_router_package_summary(directory, &package_json_path);
            cache_react_router_package_summary(&visited_directories, package_summary.clone());
            return package_summary;
        }
        let Some(parent_directory) = directory.parent() else {
            cache_react_router_package_summary(&visited_directories, None);
            return None;
        };
        directory = parent_directory;
    }
}

fn cache_react_router_package_summary(
    directories: &[PathBuf],
    package_summary: Option<Arc<ReactRouterPackageSummary>>,
) {
    let mut cache = REACT_ROUTER_PACKAGE_SUMMARIES
        .lock()
        .expect("react router package cache lock should not be poisoned");
    for directory in directories {
        cache.insert(directory.clone(), package_summary.clone());
    }
}

fn read_react_router_package_summary(
    package_directory: &Path,
    package_json_path: &Path,
) -> Option<Arc<ReactRouterPackageSummary>> {
    let package_json = std::fs::read_to_string(package_json_path).ok()?;
    let manifest = serde_json::from_str::<serde_json::Value>(&package_json).ok()?;
    let manifest = manifest.as_object()?;
    let mut has_any_dependency = false;
    let mut has_react_router_dependency = false;
    for section_name in [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ] {
        let Some(dependencies) = manifest
            .get(section_name)
            .and_then(serde_json::Value::as_object)
        else {
            continue;
        };
        has_any_dependency |= !dependencies.is_empty();
        has_react_router_dependency |= ["@react-router/dev", "react-router-dom", "react-router"]
            .iter()
            .any(|dependency_name| dependencies.contains_key(*dependency_name));
    }
    Some(Arc::new(ReactRouterPackageSummary {
        directory: package_directory.to_path_buf(),
        has_any_dependency,
        has_react_router_dependency,
    }))
}
