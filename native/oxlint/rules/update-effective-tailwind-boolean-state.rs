#[derive(Clone, Copy)]
struct EffectiveTailwindBooleanState {
    is_declared: bool,
    is_important: bool,
    specificity: usize,
    value: Option<bool>,
}

fn update_effective_tailwind_boolean_state(
    current_state: EffectiveTailwindBooleanState,
    value: bool,
    is_important: bool,
    specificity: usize,
) -> EffectiveTailwindBooleanState {
    if !current_state.is_declared
        || !current_state.is_important && is_important
        || current_state.is_important == is_important && specificity > current_state.specificity
    {
        return EffectiveTailwindBooleanState {
            is_declared: true,
            is_important,
            specificity,
            value: Some(value),
        };
    }
    if current_state.is_important && !is_important
        || current_state.is_important == is_important && specificity < current_state.specificity
    {
        return current_state;
    }
    EffectiveTailwindBooleanState {
        is_declared: true,
        is_important,
        specificity,
        value: (current_state.value == Some(value)).then_some(value),
    }
}
