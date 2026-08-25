fn has_visible_tailwind_border(tokens: &[&str]) -> bool {
    visible_tailwind_border_edges(tokens)
        .iter()
        .any(|edge| *edge)
}
