fn is_non_source_file(ctx: &crate::context::ContextHost) -> bool {
    let filename = format!("/{}", ctx.file_path().to_string_lossy().replace('\\', "/"));
    [
        "/dist/",
        "/build/",
        ".min.",
        ".umd.",
        "/.yalc/",
        "/vendor/",
        "/public/",
    ]
    .iter()
    .any(|marker| filename.contains(marker))
}
