#[derive(Clone, Copy)]
struct EffectiveTailwindClassNameTokenResolution<'a> {
    #[allow(dead_code)]
    is_ambiguous: bool,
    is_important: bool,
    #[allow(dead_code)]
    utility: Option<&'a str>,
}

fn resolve_effective_tailwind_class_name_token<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    predicate: impl Fn(&str) -> bool,
    target_variant_scope: &[&str],
) -> EffectiveTailwindClassNameTokenResolution<'a> {
    let is_applicable = |token: &TailwindClassNameToken<'a>| {
        predicate(token.utility)
            && does_tailwind_variant_scope_cover(&token.variants, target_variant_scope)
    };
    let has_important_token = tokens
        .iter()
        .any(|token| is_applicable(token) && token.is_important);
    let most_specific_scope_length = tokens
        .iter()
        .filter(|token| is_applicable(token) && (!has_important_token || token.is_important))
        .map(|token| token.variants.len())
        .max();
    let mut utility = None;
    for token in tokens {
        if !is_applicable(token)
            || has_important_token && !token.is_important
            || Some(token.variants.len()) != most_specific_scope_length
        {
            continue;
        }
        if utility.is_some_and(|current| current != token.utility) {
            return EffectiveTailwindClassNameTokenResolution {
                is_ambiguous: true,
                is_important: false,
                utility: None,
            };
        }
        utility = Some(token.utility);
    }
    EffectiveTailwindClassNameTokenResolution {
        is_ambiguous: false,
        is_important: utility.is_some() && has_important_token,
        utility,
    }
}

fn does_tailwind_variant_scope_cover(candidate_scope: &[&str], target_scope: &[&str]) -> bool {
    let mut target_variant_index = 0;
    for candidate_variant in candidate_scope {
        while target_variant_index < target_scope.len()
            && target_scope[target_variant_index] != *candidate_variant
        {
            target_variant_index += 1;
        }
        if target_variant_index == target_scope.len() {
            return false;
        }
        target_variant_index += 1;
    }
    true
}
