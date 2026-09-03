pub fn is_browser_artifact_path(relative_path: &str, is_generated_bundle: bool) -> bool {
    if is_non_shipped_build_artifact_path(relative_path) {
        return false;
    }
    is_generated_bundle
        || relative_path.ends_with(".map")
        || [
            ".next/static/",
            ".output/public/",
            "build/static/",
            "dist/assets/",
            "public/",
            "out/",
            "storybook-static/",
        ]
        .iter()
        .any(|segment| {
            relative_path.starts_with(segment) || relative_path.contains(&format!("/{segment}"))
        })
}

fn is_non_shipped_build_artifact_path(relative_path: &str) -> bool {
    let segments = relative_path.split('/').collect::<Vec<_>>();
    for (index, segment) in segments.iter().enumerate() {
        if !matches!(*segment, ".next" | ".output") {
            continue;
        }
        if *segment == ".next" && segments.get(index + 1) == Some(&"dev") {
            return true;
        }
        if segments.get(index + 1) == Some(&"server") && index + 2 < segments.len() {
            return true;
        }
    }
    false
}
