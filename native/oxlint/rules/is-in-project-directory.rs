fn is_in_project_directory(ctx: &crate::context::LintContext, directory_path: &str) -> bool {
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    if filename.is_empty() {
        return false;
    }
    let directory_segment = format!("/{directory_path}/");
    let root_directory = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("rootDirectory"))
        .and_then(serde_json::Value::as_str)
        .map(|root_directory| root_directory.replace('\\', "/"));
    if let Some(root_directory) = root_directory {
        let normalized_root_directory = root_directory.trim_end_matches('/');
        let root_directory_prefix = format!("{normalized_root_directory}/");
        if let Some(relative_filename) = filename.strip_prefix(&root_directory_prefix) {
            return relative_filename.starts_with(&format!("{directory_path}/"))
                || relative_filename.contains(&directory_segment);
        }
    }
    filename
        .get(1..)
        .is_some_and(|filename_without_leading_character| {
            filename_without_leading_character.contains(&directory_segment)
        })
}
