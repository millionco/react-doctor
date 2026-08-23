const DEPENDENCY_SECTION_NAMES: [&str; 4] = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
];

trait NextFileContext {
    fn next_file_path(&self) -> &std::path::Path;
    fn next_root_directory(&self) -> Option<&str>;
}

impl NextFileContext for crate::context::LintContext<'_> {
    fn next_file_path(&self) -> &std::path::Path {
        self.file_path()
    }

    fn next_root_directory(&self) -> Option<&str> {
        get_next_root_directory(self.settings().json.as_ref())
    }
}

impl NextFileContext for crate::context::ContextHost<'_> {
    fn next_file_path(&self) -> &std::path::Path {
        self.file_path()
    }

    fn next_root_directory(&self) -> Option<&str> {
        get_next_root_directory(self.settings().json.as_ref())
    }
}

fn is_next_file_active(ctx: &impl NextFileContext) -> bool {
    let Some(package_directory) = find_nearest_package_directory(ctx.next_file_path()) else {
        return true;
    };
    let package_json_path = package_directory.join("package.json");
    let Some(manifest) = std::fs::read_to_string(package_json_path)
        .ok()
        .and_then(|manifest| serde_json::from_str::<serde_json::Value>(&manifest).ok())
        .and_then(|manifest| manifest.as_object().cloned())
    else {
        return true;
    };
    if DEPENDENCY_SECTION_NAMES.iter().any(|section_name| {
        manifest
            .get(*section_name)
            .and_then(serde_json::Value::as_object)
            .is_some_and(|section| section.contains_key("next"))
    }) {
        return true;
    }
    let declares_any_dependency = DEPENDENCY_SECTION_NAMES.iter().any(|section_name| {
        manifest
            .get(*section_name)
            .and_then(serde_json::Value::as_object)
            .is_some_and(|section| !section.is_empty())
    });
    if !declares_any_dependency {
        return true;
    }
    let Some(root_directory) = ctx.next_root_directory() else {
        return true;
    };
    !is_package_within_project_root(&package_directory, root_directory)
}

fn get_next_root_directory(
    settings: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Option<&str> {
    settings
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("rootDirectory"))
        .and_then(serde_json::Value::as_str)
        .filter(|root_directory| !root_directory.is_empty())
}

fn find_nearest_package_directory(file_path: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut current_directory = file_path.parent();
    while let Some(directory) = current_directory {
        if directory.join("package.json").is_file() {
            return Some(directory.to_path_buf());
        }
        current_directory = directory.parent();
    }
    None
}

fn is_package_within_project_root(
    package_directory: &std::path::Path,
    root_directory: &str,
) -> bool {
    let resolved_package_directory = std::fs::canonicalize(package_directory)
        .unwrap_or_else(|_| package_directory.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/");
    let normalized_root_directory = root_directory.replace('\\', "/");
    if resolved_package_directory == normalized_root_directory {
        return false;
    }
    let root_prefix = if normalized_root_directory.ends_with('/') {
        normalized_root_directory
    } else {
        format!("{normalized_root_directory}/")
    };
    resolved_package_directory.starts_with(&root_prefix)
}
