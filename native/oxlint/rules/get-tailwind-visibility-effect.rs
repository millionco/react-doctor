#[derive(Clone, Copy, PartialEq, Eq)]
enum TailwindVisibilityProperty {
    Display,
    Visibility,
}

#[derive(Clone, Copy)]
struct TailwindVisibilityEffect {
    is_visible: bool,
    property: TailwindVisibilityProperty,
}

enum TailwindVisibilityEffectResolution {
    Known(TailwindVisibilityEffect),
    NotRelevant,
    Unknown,
}

fn get_tailwind_visibility_effect(utility: &str) -> TailwindVisibilityEffectResolution {
    let known_effect = match utility {
        "hidden" => Some(TailwindVisibilityEffect {
            is_visible: false,
            property: TailwindVisibilityProperty::Display,
        }),
        "block" | "contents" | "flex" | "flow-root" | "grid" | "inline" | "inline-block"
        | "inline-flex" | "inline-grid" | "inline-table" | "list-item" | "table"
        | "table-caption" | "table-cell" | "table-column" | "table-column-group"
        | "table-footer-group" | "table-header-group" | "table-row" | "table-row-group" => {
            Some(TailwindVisibilityEffect {
                is_visible: true,
                property: TailwindVisibilityProperty::Display,
            })
        }
        "collapse" | "invisible" => Some(TailwindVisibilityEffect {
            is_visible: false,
            property: TailwindVisibilityProperty::Visibility,
        }),
        "visible" => Some(TailwindVisibilityEffect {
            is_visible: true,
            property: TailwindVisibilityProperty::Visibility,
        }),
        _ => None,
    };
    if let Some(effect) = known_effect {
        return TailwindVisibilityEffectResolution::Known(effect);
    }

    if let Some(arbitrary_display_value) = get_arbitrary_css_property_value(utility, "display") {
        let display_value = normalize_tailwind_arbitrary_utility_value(arbitrary_display_value)
            .trim()
            .to_ascii_lowercase();
        if display_value == "none" {
            return TailwindVisibilityEffectResolution::Known(TailwindVisibilityEffect {
                is_visible: false,
                property: TailwindVisibilityProperty::Display,
            });
        }
        if is_visible_arbitrary_display_value(&display_value) {
            return TailwindVisibilityEffectResolution::Known(TailwindVisibilityEffect {
                is_visible: true,
                property: TailwindVisibilityProperty::Display,
            });
        }
        return TailwindVisibilityEffectResolution::Unknown;
    }

    let Some(arbitrary_visibility_value) = get_arbitrary_css_property_value(utility, "visibility")
    else {
        return TailwindVisibilityEffectResolution::NotRelevant;
    };
    let visibility_value = normalize_tailwind_arbitrary_utility_value(arbitrary_visibility_value)
        .trim()
        .to_ascii_lowercase();
    match visibility_value.as_str() {
        "visible" => TailwindVisibilityEffectResolution::Known(TailwindVisibilityEffect {
            is_visible: true,
            property: TailwindVisibilityProperty::Visibility,
        }),
        "hidden" | "collapse" => {
            TailwindVisibilityEffectResolution::Known(TailwindVisibilityEffect {
                is_visible: false,
                property: TailwindVisibilityProperty::Visibility,
            })
        }
        _ => TailwindVisibilityEffectResolution::Unknown,
    }
}

fn get_arbitrary_css_property_value<'a>(utility: &'a str, property_name: &str) -> Option<&'a str> {
    let property_prefix = format!("[{property_name}:");
    let lowercase_utility = utility.to_ascii_lowercase();
    if !lowercase_utility.starts_with(&property_prefix) || !utility.ends_with(']') {
        return None;
    }
    Some(&utility[property_prefix.len()..utility.len() - 1])
}

fn is_visible_arbitrary_display_value(value: &str) -> bool {
    matches!(
        value,
        "block"
            | "contents"
            | "flex"
            | "flow-root"
            | "grid"
            | "inline"
            | "inline block"
            | "inline flex"
            | "inline flow-root"
            | "inline grid"
            | "inline table"
            | "list-item"
            | "table"
            | "table-caption"
            | "table-cell"
            | "table-column"
            | "table-column-group"
            | "table-footer-group"
            | "table-header-group"
            | "table-row"
            | "table-row-group"
    )
}
