fn is_react_router_framework_file_active(ctx: &crate::context::ContextHost<'_>) -> bool {
    let Some((package_directory, has_any_dependency, has_framework_dependency)) =
        nearest_react_router_framework_package_status(ctx.file_path())
    else {
        return true;
    };
    let is_project_package = react_doctor_framework_root_directory(ctx)
        .as_deref()
        .is_some_and(|root_directory| {
            let resolved_package_directory = package_directory
                .canonicalize()
                .unwrap_or(package_directory);
            let resolved_root_directory = root_directory
                .canonicalize()
                .unwrap_or_else(|_| root_directory.to_path_buf());
            resolved_package_directory.starts_with(resolved_root_directory)
        });
    if is_project_package && has_any_dependency {
        return has_framework_dependency;
    }
    is_react_router_file_active(ctx)
}

fn react_doctor_framework_root_directory(
    ctx: &crate::context::ContextHost<'_>,
) -> Option<std::path::PathBuf> {
    ctx.settings()
        .json
        .as_ref()?
        .get("react-doctor")?
        .as_object()?
        .get("rootDirectory")?
        .as_str()
        .filter(|root_directory| !root_directory.is_empty())
        .map(std::path::PathBuf::from)
}

fn nearest_react_router_framework_package_status(
    file_path: &std::path::Path,
) -> Option<(std::path::PathBuf, bool, bool)> {
    let mut directory = file_path.parent()?;
    loop {
        let package_json_path = directory.join("package.json");
        if package_json_path.is_file() {
            let package_json = std::fs::read_to_string(package_json_path).ok()?;
            let manifest = serde_json::from_str::<serde_json::Value>(&package_json).ok()?;
            let manifest = manifest.as_object()?;
            let mut has_any_dependency = false;
            let mut has_framework_dependency = false;
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
                has_framework_dependency |= dependencies.contains_key("@react-router/dev");
            }
            return Some((
                directory.to_path_buf(),
                has_any_dependency,
                has_framework_dependency,
            ));
        }
        directory = directory.parent()?;
    }
}
