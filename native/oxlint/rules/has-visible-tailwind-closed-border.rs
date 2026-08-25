fn has_visible_tailwind_closed_border(tokens: &[&str]) -> bool {
    visible_tailwind_border_edges(tokens)
        .iter()
        .all(|edge| *edge)
}
