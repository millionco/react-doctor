const TAILWIND_BREAKPOINT_NAMES: [&str; 6] = ["", "sm", "md", "lg", "xl", "2xl"];

#[derive(Clone, Copy)]
struct TailwindResponsiveVariantScope {
    maximum_breakpoint_index: usize,
    minimum_breakpoint_index: usize,
    specificity: usize,
}

#[derive(Clone, Copy)]
struct TailwindScopedVisibilityEffect {
    effect: TailwindVisibilityEffect,
    is_important: bool,
    scope: TailwindResponsiveVariantScope,
}

fn get_tailwind_visibility_at_breakpoints(class_name: &str) -> Option<Vec<bool>> {
    let mut scoped_effects = Vec::new();
    for token in tailwind_class_name_tokens(class_name) {
        let effect = match get_tailwind_visibility_effect(token.utility) {
            TailwindVisibilityEffectResolution::Known(effect) => effect,
            TailwindVisibilityEffectResolution::NotRelevant => continue,
            TailwindVisibilityEffectResolution::Unknown => return None,
        };
        let scope = get_responsive_variant_scope(&token.variants)?;
        if scope.minimum_breakpoint_index >= scope.maximum_breakpoint_index {
            continue;
        }
        scoped_effects.push(TailwindScopedVisibilityEffect {
            effect,
            is_important: token.is_important,
            scope,
        });
    }

    let mut visibility_at_breakpoints = Vec::with_capacity(TAILWIND_BREAKPOINT_NAMES.len());
    for breakpoint_index in 0..TAILWIND_BREAKPOINT_NAMES.len() {
        let display_visibility = resolve_visibility_property(
            &scoped_effects,
            breakpoint_index,
            TailwindVisibilityProperty::Display,
        )?;
        let visibility_visibility = resolve_visibility_property(
            &scoped_effects,
            breakpoint_index,
            TailwindVisibilityProperty::Visibility,
        )?;
        visibility_at_breakpoints.push(display_visibility && visibility_visibility);
    }
    Some(visibility_at_breakpoints)
}

fn get_responsive_variant_scope(variants: &[&str]) -> Option<TailwindResponsiveVariantScope> {
    let mut minimum_breakpoint_index = 0;
    let mut maximum_breakpoint_index = TAILWIND_BREAKPOINT_NAMES.len();
    for variant in variants {
        if let Some(minimum_variant_index) = get_tailwind_breakpoint_index(variant)
            && minimum_variant_index > 0
        {
            minimum_breakpoint_index = minimum_breakpoint_index.max(minimum_variant_index);
            continue;
        }
        if let Some(maximum_variant) = variant.strip_prefix("max-")
            && let Some(maximum_variant_index) = get_tailwind_breakpoint_index(maximum_variant)
            && maximum_variant_index > 0
        {
            maximum_breakpoint_index = maximum_breakpoint_index.min(maximum_variant_index);
            continue;
        }
        return None;
    }
    Some(TailwindResponsiveVariantScope {
        maximum_breakpoint_index,
        minimum_breakpoint_index,
        specificity: variants.len(),
    })
}

fn get_tailwind_breakpoint_index(breakpoint_name: &str) -> Option<usize> {
    TAILWIND_BREAKPOINT_NAMES
        .iter()
        .position(|candidate| *candidate == breakpoint_name)
}

fn resolve_visibility_property(
    scoped_effects: &[TailwindScopedVisibilityEffect],
    breakpoint_index: usize,
    property: TailwindVisibilityProperty,
) -> Option<bool> {
    let is_applicable = |scoped_effect: &&TailwindScopedVisibilityEffect| {
        scoped_effect.effect.property == property
            && breakpoint_index >= scoped_effect.scope.minimum_breakpoint_index
            && breakpoint_index < scoped_effect.scope.maximum_breakpoint_index
    };
    let applicable_effects = scoped_effects
        .iter()
        .filter(is_applicable)
        .collect::<Vec<_>>();
    if applicable_effects.is_empty() {
        return Some(true);
    }
    let has_important_effect = applicable_effects.iter().any(|effect| effect.is_important);
    let highest_importance_effects = applicable_effects
        .into_iter()
        .filter(|effect| !has_important_effect || effect.is_important)
        .collect::<Vec<_>>();
    let maximum_specificity = highest_importance_effects
        .iter()
        .map(|effect| effect.scope.specificity)
        .max()?;
    let highest_specificity_effects = highest_importance_effects
        .into_iter()
        .filter(|effect| effect.scope.specificity == maximum_specificity)
        .collect::<Vec<_>>();
    let maximum_minimum_breakpoint = highest_specificity_effects
        .iter()
        .map(|effect| effect.scope.minimum_breakpoint_index)
        .max()?;
    let latest_minimum_effects = highest_specificity_effects
        .into_iter()
        .filter(|effect| effect.scope.minimum_breakpoint_index == maximum_minimum_breakpoint)
        .collect::<Vec<_>>();
    let minimum_maximum_breakpoint = latest_minimum_effects
        .iter()
        .map(|effect| effect.scope.maximum_breakpoint_index)
        .min()?;
    let mut resolved_visibility = None;
    for effect in latest_minimum_effects
        .into_iter()
        .filter(|effect| effect.scope.maximum_breakpoint_index == minimum_maximum_breakpoint)
    {
        if resolved_visibility.is_some_and(|is_visible| is_visible != effect.effect.is_visible) {
            return None;
        }
        resolved_visibility = Some(effect.effect.is_visible);
    }
    resolved_visibility
}
