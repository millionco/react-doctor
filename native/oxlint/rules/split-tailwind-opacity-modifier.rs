fn split_tailwind_opacity_modifier(utility: &str) -> (&str, Option<&str>) {
    let modifier_index =
        tailwind_top_level_character_indices(utility, |character| character == '/')
            .into_iter()
            .next();
    modifier_index.map_or((utility, None), |modifier_index| {
        (
            &utility[..modifier_index],
            Some(&utility[modifier_index + 1..]),
        )
    })
}
