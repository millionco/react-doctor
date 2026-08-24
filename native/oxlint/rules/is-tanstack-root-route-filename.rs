fn is_tanstack_root_route_filename(filename: &str) -> bool {
    ["__root.ts", "__root.tsx", "__root.js", "__root.jsx"]
        .iter()
        .any(|suffix| filename.ends_with(suffix))
}
