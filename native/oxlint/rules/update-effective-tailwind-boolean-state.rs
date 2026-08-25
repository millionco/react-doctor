#[derive(Clone, Copy)]
struct EffectiveTailwindBooleanState {
    is_declared: bool,
    specificity: usize,
    value: Option<bool>,
}

fn update_effective_tailwind_boolean_state(
    current_state: EffectiveTailwindBooleanState,
    value: bool,
    specificity: usize,
) -> EffectiveTailwindBooleanState {
    if !current_state.is_declared || specificity > current_state.specificity {
        return EffectiveTailwindBooleanState {
            is_declared: true,
            specificity,
            value: Some(value),
        };
    }
    if specificity < current_state.specificity {
        return current_state;
    }
    EffectiveTailwindBooleanState {
        is_declared: true,
        specificity,
        value: (current_state.value == Some(value)).then_some(value),
    }
}
