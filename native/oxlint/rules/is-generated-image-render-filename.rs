fn is_generated_image_render_filename(ctx: &crate::context::ContextHost) -> bool {
    let file_name = ctx
        .file_path()
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or_default();
    let Some((stem, extension)) = file_name.rsplit_once('.') else {
        return false;
    };
    matches!(extension, "ts" | "tsx" | "js" | "jsx" | "mts" | "mjs")
        && ["opengraph-image", "twitter-image", "icon", "apple-icon"]
            .iter()
            .any(|prefix| {
                stem.strip_prefix(prefix)
                    .is_some_and(|suffix| suffix.bytes().all(|byte| byte.is_ascii_digit()))
            })
}
