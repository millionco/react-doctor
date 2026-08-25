const MINIMUM_CARD_PADDING_PX: f64 = 8.0;

fn is_tailwind_padded_card_surface(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    let Some(class_name) = get_static_class_name(opening_element) else {
        return false;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    let effective_rounding =
        get_effective_tailwind_class_name_token(&tokens, is_card_rounding_utility);
    effective_rounding != Some("rounded-full")
        && is_tailwind_card_surface_from_tokens(&tokens)
        && card_padding_values(&tokens)
            .into_iter()
            .any(|padding| padding >= MINIMUM_CARD_PADDING_PX)
}
