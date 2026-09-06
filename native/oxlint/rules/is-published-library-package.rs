fn nearest_bundle_package_manifest(
    file_path: &std::path::Path,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    let mut directory = file_path.parent()?;
    loop {
        let manifest_path = directory.join("package.json");
        if manifest_path.is_file() {
            return serde_json::from_str::<serde_json::Value>(
                &std::fs::read_to_string(manifest_path).ok()?,
            )
            .ok()?
            .as_object()
            .cloned();
        }
        directory = directory.parent()?;
    }
}

fn is_published_library_package(file_path: &std::path::Path) -> bool {
    let Some(manifest) = nearest_bundle_package_manifest(file_path) else {
        return false;
    };
    manifest.get("private") != Some(&serde_json::Value::Bool(true))
        && manifest
            .get("peerDependencies")
            .and_then(serde_json::Value::as_object)
            .is_some_and(|dependencies| dependencies.contains_key("react"))
}
