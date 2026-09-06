fn has_visible_tailwind_fill_or_edge(tokens: &[&str]) -> bool {
    has_visible_tailwind_border(tokens)
        || has_visible_tailwind_ring(tokens)
        || has_visible_tailwind_background(tokens)
}
