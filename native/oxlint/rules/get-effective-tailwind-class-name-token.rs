fn get_effective_tailwind_class_name_token<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    predicate: impl Fn(&str) -> bool,
) -> Option<&'a str> {
    let applicable_tokens = tokens
        .iter()
        .filter(|token| token.variants.is_empty() && predicate(token.utility))
        .collect::<Vec<_>>();
    let has_important_token = applicable_tokens.iter().any(|token| token.is_important);
    let mut effective_utility = None;
    for token in applicable_tokens {
        if has_important_token && !token.is_important {
            continue;
        }
        if effective_utility.is_some_and(|utility| utility != token.utility) {
            return None;
        }
        effective_utility = Some(token.utility);
    }
    effective_utility
}
