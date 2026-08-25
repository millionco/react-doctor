fn tailwind_border_edges(direction: Option<&str>) -> &'static [usize] {
    match direction {
        Some("t") => &[0],
        Some("r") => &[1],
        Some("b") => &[2],
        Some("l") => &[3],
        Some("x") => &[1, 3],
        Some("y") => &[0, 2],
        _ => &[0, 1, 2, 3],
    }
}
