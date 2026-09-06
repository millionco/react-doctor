fn get_static_tailwind_font_size(class_name: &str) -> Option<f64> {
    let tokens = tailwind_class_name_tokens(class_name);
    let effective_utility = get_effective_tailwind_class_name_token(&tokens, |utility| {
        parse_static_tailwind_font_size(utility).is_some()
    })?;
    parse_static_tailwind_font_size(effective_utility)
}
