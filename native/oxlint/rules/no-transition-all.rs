use oxc_ast::{
    AstKind,
    ast::{ObjectExpression, ObjectProperty, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use rustc_hash::FxHashMap;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const TAILWIND_MESSAGE: &str = "Your users see janky animation because `transition-all` animates every property that changes, including expensive layout ones and instant ones like focus rings. Name the properties: `transition-colors`, `transition-opacity`, or `transition-transform`.";
const INLINE_MESSAGE: &str = "This can stutter because transition: \"all\" animates every property, even slow layout ones, so list only the properties you actually change";

#[derive(Debug, Default, Clone)]
pub struct NoTransitionAll;

declare_oxc_lint!(
    /// Disallow transitions that animate every CSS property.
    NoTransitionAll,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow transition: all.",
);

impl Rule for NoTransitionAll {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let class_name_values = if has_capability_or_unspecified(ctx, "tailwind") {
            let Some(class_name_attribute) =
                get_authoritative_jsx_attribute(opening_element, "className", true)
            else {
                return no_transition_all_report_inline_only(opening_element, ctx);
            };
            let Some(values) = get_static_jsx_attribute_string_values(class_name_attribute, ctx)
            else {
                return;
            };
            values
        } else {
            vec![String::new()]
        };
        let style_attribute = get_authoritative_jsx_attribute(opening_element, "style", true);
        let style = match style_attribute {
            Some(attribute) => {
                let Some(style) = get_inline_style_object_expression_with_aliases(attribute, ctx)
                else {
                    return;
                };
                Some(style)
            }
            None => None,
        };
        if !class_name_values
            .iter()
            .any(|class_name| no_transition_all_has_merged_transition_all(class_name, style))
        {
            return;
        }
        let message = if class_name_values
            .iter()
            .any(|class_name| no_transition_all_has_transition_all_class(class_name))
        {
            TAILWIND_MESSAGE
        } else {
            INLINE_MESSAGE
        };
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.span));
    }
}

fn no_transition_all_report_inline_only<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) {
    let style_attribute = get_authoritative_jsx_attribute(opening_element, "style", true);
    let style = match style_attribute {
        Some(attribute) => {
            let Some(style) = get_inline_style_object_expression_with_aliases(attribute, ctx)
            else {
                return;
            };
            Some(style)
        }
        None => None,
    };
    if no_transition_all_has_merged_transition_all("", style) {
        ctx.diagnostic(OxcDiagnostic::warn(INLINE_MESSAGE).with_label(opening_element.span));
    }
}

#[derive(Clone)]
pub(super) struct NoTransitionAllPropertyEffect {
    pub(super) includes_all: bool,
    pub(super) includes_scale: bool,
    pub(super) includes_transform: bool,
    pub(super) property_names: Option<Vec<String>>,
}

#[derive(Clone)]
struct NoTransitionAllShorthandEvidence {
    duration_milliseconds: f64,
    property_name: String,
}

#[derive(Clone)]
pub(super) struct NoTransitionAllDurationEffect {
    pub(super) states: Option<Vec<bool>>,
    pub(super) is_explicit: bool,
}

fn no_transition_all_has_merged_transition_all(
    class_name: &str,
    style: Option<&ObjectExpression<'_>>,
) -> bool {
    let tokens = tailwind_class_name_tokens(class_name);
    let mut variant_scopes = vec![Vec::new()];
    for token in &tokens {
        if !variant_scopes.iter().any(|scope| scope == &token.variants) {
            variant_scopes.push(token.variants.clone());
        }
    }
    variant_scopes.into_iter().any(|scope| {
        let has_animation_utility = tokens.iter().any(|token| {
            let utility = token.utility;
            utility != "animate-none"
                && utility != "[animation:none]"
                && utility != "[animation-name:none]"
                && (utility.starts_with("animate-")
                    || utility.starts_with("[animation:")
                    || utility.starts_with("[animation-name:"))
                && does_tailwind_variant_scope_cover(&token.variants, &scope)
        });
        let has_property_setter = tokens.iter().any(|token| {
            no_transition_all_property_effect(token.utility).is_some()
                && does_tailwind_variant_scope_cover(&token.variants, &scope)
        });
        let transition_all_state =
            no_transition_all_resolve_boolean_state(&tokens, &scope, |utility| {
                no_transition_all_property_effect(utility).map(|effect| effect.includes_all)
            });
        let duration_state = no_transition_all_resolve_duration_state(&tokens, &scope, &["all"]);
        let property_is_important =
            no_transition_all_has_important_token(&tokens, &scope, |utility| {
                no_transition_all_property_effect(utility).is_some()
            });
        let duration_is_important = no_transition_all_has_important_token(
            &tokens,
            &scope,
            no_transition_all_is_duration_setter,
        );
        let default_property = if (!has_property_setter && !has_animation_utility)
            || transition_all_state == Some(true)
        {
            "all"
        } else {
            "opacity"
        };
        no_transition_all_effective_css_transitions(
            style,
            default_property,
            duration_state == Some(true),
            property_is_important,
            duration_is_important,
        )
        .is_some_and(|transitions| {
            transitions
                .iter()
                .any(|(property, duration)| property == "all" && *duration > 0.0)
        })
    })
}

fn no_transition_all_has_transition_all_class(class_name: &str) -> bool {
    let tokens = tailwind_class_name_tokens(class_name);
    tokens.iter().any(|token| {
        no_transition_all_resolve_boolean_state(&tokens, &token.variants, |utility| {
            no_transition_all_property_effect(utility).map(|effect| effect.includes_all)
        }) == Some(true)
            && no_transition_all_resolve_duration_state(&tokens, &token.variants, &["all"])
                == Some(true)
    })
}

pub(super) fn no_transition_all_property_effect(
    utility: &str,
) -> Option<NoTransitionAllPropertyEffect> {
    let known = match utility {
        "transition-none" => Some((false, false, false, Some(vec!["none".to_string()]))),
        "transition" => Some((false, true, true, None)),
        "transition-all" => Some((true, true, true, Some(vec!["all".to_string()]))),
        "transition-colors" => Some((false, false, false, None)),
        "transition-opacity" => Some((false, false, false, Some(vec!["opacity".to_string()]))),
        "transition-shadow" => Some((false, false, false, Some(vec!["box-shadow".to_string()]))),
        "transition-transform" => Some((false, true, true, Some(vec!["transform".to_string()]))),
        _ => None,
    };
    if let Some((includes_all, includes_scale, includes_transform, property_names)) = known {
        return Some(NoTransitionAllPropertyEffect {
            includes_all,
            includes_scale,
            includes_transform,
            property_names,
        });
    }
    for prefix in ["transition-[", "[transition-property:"] {
        if let Some(value) = no_transition_all_arbitrary_value(utility, prefix) {
            let property_names = no_transition_all_normalize_arbitrary(value)
                .split(',')
                .map(|property| no_transition_all_trim_js_whitespace(property).to_ascii_lowercase())
                .collect::<Vec<_>>();
            return Some(NoTransitionAllPropertyEffect {
                includes_all: property_names.iter().any(|property| property == "all"),
                includes_scale: property_names
                    .iter()
                    .any(|property| matches!(property.as_str(), "all" | "scale")),
                includes_transform: property_names
                    .iter()
                    .any(|property| matches!(property.as_str(), "all" | "transform")),
                property_names: Some(property_names),
            });
        }
    }
    let value = no_transition_all_arbitrary_value(utility, "[transition:")?;
    let transitions =
        no_transition_all_parse_shorthand(&no_transition_all_normalize_arbitrary(value));
    Some(NoTransitionAllPropertyEffect {
        includes_all: transitions
            .iter()
            .any(|transition| transition.property_name == "all"),
        includes_scale: transitions
            .iter()
            .any(|transition| matches!(transition.property_name.as_str(), "all" | "scale")),
        includes_transform: transitions
            .iter()
            .any(|transition| matches!(transition.property_name.as_str(), "all" | "transform")),
        property_names: Some(
            transitions
                .into_iter()
                .map(|transition| transition.property_name)
                .collect(),
        ),
    })
}

fn no_transition_all_resolve_boolean_state<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    scope: &[&str],
    get_state: impl Fn(&str) -> Option<bool>,
) -> Option<bool> {
    let applicable = no_transition_all_highest_priority_tokens(tokens, scope, |utility| {
        get_state(utility).is_some()
    });
    let first = get_state(applicable.first()?.utility)?;
    applicable
        .iter()
        .all(|token| get_state(token.utility) == Some(first))
        .then_some(first)
}

fn no_transition_all_highest_priority_tokens<'a, 'b>(
    tokens: &'b [TailwindClassNameToken<'a>],
    scope: &[&str],
    predicate: impl Fn(&str) -> bool,
) -> Vec<&'b TailwindClassNameToken<'a>> {
    let applicable = tokens
        .iter()
        .filter(|token| {
            predicate(token.utility) && does_tailwind_variant_scope_cover(&token.variants, scope)
        })
        .collect::<Vec<_>>();
    let has_important = applicable.iter().any(|token| token.is_important);
    let most_specific = applicable
        .iter()
        .filter(|token| !has_important || token.is_important)
        .map(|token| token.variants.len())
        .max();
    applicable
        .into_iter()
        .filter(|token| {
            (!has_important || token.is_important) && Some(token.variants.len()) == most_specific
        })
        .collect()
}

fn no_transition_all_has_important_token<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    scope: &[&str],
    predicate: impl Fn(&str) -> bool,
) -> bool {
    no_transition_all_highest_priority_tokens(tokens, scope, predicate)
        .iter()
        .any(|token| token.is_important)
}

pub(super) fn no_transition_all_is_duration_setter(utility: &str) -> bool {
    !utility.starts_with("[transition-property:")
        && (utility.starts_with("duration-")
            || utility.starts_with("[transition-duration:")
            || utility.starts_with("[transition:")
            || no_transition_all_property_effect(utility).is_some())
}

fn no_transition_all_resolve_duration_state<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    scope: &[&str],
    targets: &[&str],
) -> Option<bool> {
    let applicable = no_transition_all_highest_priority_tokens(tokens, scope, |utility| {
        no_transition_all_duration_effect(utility, targets).is_some()
    });
    let effects = applicable
        .iter()
        .filter_map(|token| no_transition_all_duration_effect(token.utility, targets))
        .collect::<Vec<_>>();
    let has_explicit = effects.iter().any(|effect| effect.is_explicit);
    let property_names = no_transition_all_effective_property_names(tokens, scope);
    let states = effects
        .iter()
        .filter(|effect| !has_explicit || effect.is_explicit)
        .map(|effect| {
            no_transition_all_duration_effect_state(effect, property_names.as_deref(), targets)
        })
        .collect::<Vec<_>>();
    let first = *states.first()?;
    states
        .iter()
        .all(|state| *state == first)
        .then_some(first)
        .flatten()
}

pub(super) fn no_transition_all_duration_effect(
    utility: &str,
    targets: &[&str],
) -> Option<NoTransitionAllDurationEffect> {
    if let Some(value) = utility.strip_prefix("duration-") {
        let states = if let Some(value) = value
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
        {
            no_transition_all_parse_duration_states(&no_transition_all_normalize_arbitrary(value))
        } else if let Some(duration) = no_transition_all_parse_decimal(value, false, false) {
            Some(vec![duration > 0.0])
        } else {
            None
        };
        return Some(NoTransitionAllDurationEffect {
            states,
            is_explicit: true,
        });
    }
    if let Some(value) = no_transition_all_arbitrary_value(utility, "[transition-duration:") {
        return Some(NoTransitionAllDurationEffect {
            states: no_transition_all_parse_duration_states(
                &no_transition_all_normalize_arbitrary(value),
            ),
            is_explicit: true,
        });
    }
    if let Some(value) = no_transition_all_arbitrary_value(utility, "[transition:") {
        let transitions =
            no_transition_all_parse_shorthand(&no_transition_all_normalize_arbitrary(value));
        if transitions.is_empty() {
            return Some(NoTransitionAllDurationEffect {
                states: None,
                is_explicit: false,
            });
        }
        let states = transitions
            .into_iter()
            .filter(|transition| {
                transition.property_name == "all"
                    || targets.contains(&transition.property_name.as_str())
            })
            .map(|transition| transition.duration_milliseconds > 0.0)
            .collect::<Vec<_>>();
        return (!states.is_empty()).then_some(NoTransitionAllDurationEffect {
            states: Some(states),
            is_explicit: false,
        });
    }
    if utility.starts_with("[transition-property:") {
        return None;
    }
    let effect = no_transition_all_property_effect(utility)?;
    let targets_requested = targets.contains(&"all") && effect.includes_all
        || targets.contains(&"scale") && effect.includes_scale
        || targets.contains(&"transform") && effect.includes_transform;
    targets_requested.then_some(NoTransitionAllDurationEffect {
        states: Some(vec![true]),
        is_explicit: false,
    })
}

fn no_transition_all_effective_property_names<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    scope: &[&str],
) -> Option<Vec<String>> {
    let applicable = no_transition_all_highest_priority_tokens(tokens, scope, |utility| {
        no_transition_all_property_effect(utility).is_some()
    });
    if applicable.is_empty() {
        return Some(vec!["all".to_string()]);
    }
    let first = no_transition_all_property_effect(applicable[0].utility)?.property_names?;
    applicable
        .iter()
        .skip(1)
        .all(|token| {
            no_transition_all_property_effect(token.utility)
                .and_then(|effect| effect.property_names)
                .as_ref()
                == Some(&first)
        })
        .then_some(first)
}

pub(super) fn no_transition_all_duration_effect_state(
    effect: &NoTransitionAllDurationEffect,
    property_names: Option<&[String]>,
    targets: &[&str],
) -> Option<bool> {
    let states = effect.states.as_ref()?;
    let first = *states.first()?;
    if states.iter().all(|state| *state == first) {
        return Some(first);
    }
    if !effect.is_explicit {
        return None;
    }
    let property_names = property_names?;
    let paired = property_names
        .iter()
        .enumerate()
        .filter(|(_, property)| property.as_str() == "all" || targets.contains(&property.as_str()))
        .map(|(index, _)| states[index % states.len()])
        .collect::<Vec<_>>();
    let first = *paired.first()?;
    paired.iter().all(|state| *state == first).then_some(first)
}

fn no_transition_all_parse_duration_states(value: &str) -> Option<Vec<bool>> {
    let states = value
        .split(',')
        .map(|duration| {
            let number = no_transition_all_parse_time_value(
                no_transition_all_trim_js_whitespace(duration),
                true,
                true,
            )?;
            (number >= 0.0).then_some(number > 0.0)
        })
        .collect::<Option<Vec<_>>>()?;
    (!states.is_empty()).then_some(states)
}

pub(super) fn no_transition_all_effective_css_transitions(
    style: Option<&ObjectExpression<'_>>,
    default_property: &str,
    default_positive_duration: bool,
    protect_property: bool,
    protect_duration: bool,
) -> Option<Vec<(String, f64)>> {
    let mut property_names = vec![default_property.to_string()];
    let mut durations = vec![if default_positive_duration { 1.0 } else { 0.0 }];
    if let Some(style) = style {
        for property in no_transition_all_effective_style_properties(style)? {
            let property_name = no_transition_all_static_style_property_name(property)?;
            if !matches!(
                property_name,
                "transition" | "transitionProperty" | "transitionDuration"
            ) {
                continue;
            }
            let oxc_ast::ast::Expression::StringLiteral(value) = &property.value else {
                return None;
            };
            match property_name {
                "transition" => {
                    let transitions = no_transition_all_parse_shorthand(value.value.as_str());
                    if transitions.is_empty() {
                        return None;
                    }
                    if !protect_property {
                        property_names = transitions
                            .iter()
                            .map(|transition| transition.property_name.clone())
                            .collect();
                    }
                    if !protect_duration {
                        durations = transitions
                            .iter()
                            .map(|transition| transition.duration_milliseconds)
                            .collect();
                    }
                }
                "transitionProperty" if !protect_property => {
                    property_names = no_transition_all_parse_property_list(value.value.as_str())?;
                }
                "transitionDuration" if !protect_duration => {
                    durations = no_transition_all_parse_duration_list(value.value.as_str())?;
                }
                _ => {}
            }
        }
    }
    if property_names.iter().any(|property| property == "none") {
        return Some(Vec::new());
    }
    Some(
        property_names
            .into_iter()
            .enumerate()
            .map(|(index, property)| {
                let duration = durations[index % durations.len()];
                (property, duration)
            })
            .collect(),
    )
}

fn no_transition_all_effective_style_properties<'a>(
    style: &'a ObjectExpression<'a>,
) -> Option<Vec<&'a ObjectProperty<'a>>> {
    fn collect<'a>(
        properties: &'a [ObjectPropertyKind<'a>],
        effective: &mut Vec<(String, &'a ObjectProperty<'a>)>,
        property_indices: &mut FxHashMap<String, usize>,
    ) -> Option<()> {
        for property in properties {
            match property {
                ObjectPropertyKind::SpreadProperty(spread) => {
                    let oxc_ast::ast::Expression::ObjectExpression(object) =
                        spread.argument.get_inner_expression()
                    else {
                        return None;
                    };
                    collect(&object.properties, effective, property_indices)?;
                }
                ObjectPropertyKind::ObjectProperty(property) => {
                    let name = no_transition_all_static_style_property_name(property)?.to_string();
                    if let Some(index) = property_indices.get(&name) {
                        effective[*index].1 = property;
                    } else {
                        property_indices.insert(name.clone(), effective.len());
                        effective.push((name, property));
                    }
                }
            }
        }
        Some(())
    }
    let mut effective = Vec::new();
    collect(&style.properties, &mut effective, &mut FxHashMap::default())?;
    Some(
        effective
            .into_iter()
            .map(|(_, property)| property)
            .collect(),
    )
}

pub(super) fn no_transition_all_get_effective_static_style_property<'a>(
    object_expression: &'a ObjectExpression<'a>,
    target_name: &str,
) -> Option<&'a ObjectProperty<'a>> {
    for property in object_expression.properties.iter().rev() {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        let property_name = no_transition_all_static_style_property_name(property)?;
        if property_name == target_name {
            return Some(property);
        }
    }
    None
}

fn no_transition_all_static_style_property_name<'a>(
    property: &'a ObjectProperty<'a>,
) -> Option<&'a str> {
    let property_name = match &property.key {
        oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) if !property.computed => {
            identifier.name.as_str()
        }
        oxc_ast::ast::PropertyKey::StringLiteral(literal) => literal.value.as_str(),
        oxc_ast::ast::PropertyKey::TemplateLiteral(template)
            if property.computed && template.expressions.is_empty() =>
        {
            let quasi = template.quasis.first()?;
            quasi
                .value
                .cooked
                .as_ref()
                .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
        }
        _ => return None,
    };
    (!property_name.is_empty()).then_some(property_name)
}

fn no_transition_all_parse_property_list(value: &str) -> Option<Vec<String>> {
    let properties = value
        .split(',')
        .map(|property| no_transition_all_trim_js_whitespace(property).to_ascii_lowercase())
        .collect::<Vec<_>>();
    if properties.is_empty()
        || properties
            .iter()
            .any(|property| !no_transition_all_is_valid_property_name(property))
        || properties.len() > 1 && properties.iter().any(|property| property == "none")
    {
        return None;
    }
    Some(properties)
}

fn no_transition_all_is_valid_property_name(property: &str) -> bool {
    if matches!(property, "all" | "none") {
        return true;
    }
    if let Some(custom_property_name) = property.strip_prefix("--") {
        return !custom_property_name.is_empty()
            && custom_property_name.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            });
    }
    let property_name = property.strip_prefix('-').unwrap_or(property);
    property_name
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic())
        && property_name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn no_transition_all_parse_duration_list(value: &str) -> Option<Vec<f64>> {
    let durations = value
        .split(',')
        .map(|duration| {
            no_transition_all_parse_time_value(
                no_transition_all_trim_js_whitespace(duration),
                false,
                false,
            )
        })
        .collect::<Option<Vec<_>>>()?;
    (!durations.is_empty() && durations.iter().all(|duration| *duration >= 0.0))
        .then_some(durations)
}

fn no_transition_all_parse_shorthand(value: &str) -> Vec<NoTransitionAllShorthandEvidence> {
    let segments = no_transition_all_split_top_level(value, ',');
    let transitions = segments
        .iter()
        .map(|segment| no_transition_all_parse_shorthand_segment(segment))
        .collect::<Option<Vec<_>>>();
    transitions.unwrap_or_default()
}

fn no_transition_all_parse_shorthand_segment(
    value: &str,
) -> Option<NoTransitionAllShorthandEvidence> {
    let tokens = no_transition_all_split_top_level_whitespace(
        &no_transition_all_trim_js_whitespace(value).to_ascii_lowercase(),
    );
    if tokens.is_empty()
        || tokens.iter().any(|token| {
            matches!(
                token.as_str(),
                "inherit" | "initial" | "revert" | "revert-layer" | "unset"
            )
        })
    {
        return None;
    }
    if tokens.len() == 1 && tokens[0] == "none" {
        return Some(NoTransitionAllShorthandEvidence {
            duration_milliseconds: 0.0,
            property_name: "none".to_string(),
        });
    }
    if tokens.iter().any(|token| token == "none") {
        return None;
    }
    let mut property_name = "all".to_string();
    let mut duration = 0.0;
    let mut time_count = 0;
    let mut timing_count = 0;
    let mut behavior_count = 0;
    let mut property_count = 0;
    for token in tokens {
        if let Some(milliseconds) = no_transition_all_parse_time(&token) {
            time_count += 1;
            if time_count > 2 {
                return None;
            }
            if time_count == 1 {
                if milliseconds < 0.0 {
                    return None;
                }
                duration = milliseconds;
            }
            continue;
        }
        if matches!(
            token.as_str(),
            "ease" | "ease-in" | "ease-in-out" | "ease-out" | "linear" | "step-end" | "step-start"
        ) || no_transition_all_is_timing_function(&token)
        {
            timing_count += 1;
            if timing_count > 1 {
                return None;
            }
            continue;
        }
        if matches!(token.as_str(), "allow-discrete" | "normal") {
            behavior_count += 1;
            if behavior_count > 1 {
                return None;
            }
            continue;
        }
        property_count += 1;
        if property_count > 1 {
            return None;
        }
        property_name = token;
    }
    Some(NoTransitionAllShorthandEvidence {
        duration_milliseconds: duration,
        property_name,
    })
}

fn no_transition_all_parse_time(value: &str) -> Option<f64> {
    no_transition_all_parse_time_value(value, false, true)
}

fn no_transition_all_parse_time_value(
    value: &str,
    allow_plus: bool,
    allow_minus: bool,
) -> Option<f64> {
    let lower_value = value.to_ascii_lowercase();
    if let Some(number) = lower_value.strip_suffix("ms") {
        no_transition_all_parse_decimal(number, allow_plus, allow_minus)
    } else {
        lower_value
            .strip_suffix('s')
            .and_then(|number| no_transition_all_parse_decimal(number, allow_plus, allow_minus))
            .map(|number| number * 1000.0)
    }
}

fn no_transition_all_parse_decimal(
    value: &str,
    allow_plus: bool,
    allow_minus: bool,
) -> Option<f64> {
    let unsigned_value = if let Some(value) = value.strip_prefix('+') {
        allow_plus.then_some(value)?
    } else if let Some(value) = value.strip_prefix('-') {
        allow_minus.then_some(value)?
    } else {
        value
    };
    let mut components = unsigned_value.split('.');
    let integer = components.next()?;
    let fraction = components.next();
    if components.next().is_some()
        || integer.chars().any(|character| !character.is_ascii_digit())
        || fraction.is_some_and(|fraction| {
            fraction.is_empty()
                || fraction
                    .chars()
                    .any(|character| !character.is_ascii_digit())
        })
        || integer.is_empty() && fraction.is_none()
    {
        return None;
    }
    value.parse::<f64>().ok()
}

fn no_transition_all_is_timing_function(value: &str) -> bool {
    ["cubic-bezier(", "linear(", "steps("].iter().any(|prefix| {
        value
            .strip_prefix(prefix)
            .and_then(|arguments| arguments.strip_suffix(')'))
            .is_some_and(|arguments| !arguments.contains(')'))
    })
}

fn no_transition_all_trim_js_whitespace(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

fn no_transition_all_split_top_level(value: &str, separator: char) -> Vec<String> {
    let mut segments = Vec::new();
    let mut depth = 0_u32;
    let mut start = 0;
    for (index, character) in value.char_indices() {
        match character {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ => {}
        }
        if character == separator && depth == 0 {
            segments.push(value[start..index].to_string());
            start = index + character.len_utf8();
        }
    }
    segments.push(value[start..].to_string());
    segments
}

fn no_transition_all_split_top_level_whitespace(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut depth = 0_u32;
    let mut start = None;
    for (index, character) in value.char_indices() {
        match character {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ => {}
        }
        if is_js_whitespace(character) && depth == 0 {
            if let Some(token_start) = start.take() {
                tokens.push(value[token_start..index].to_string());
            }
        } else if start.is_none() {
            start = Some(index);
        }
    }
    if let Some(token_start) = start {
        tokens.push(value[token_start..].to_string());
    }
    tokens
}

pub(super) fn no_transition_all_arbitrary_value<'a>(
    utility: &'a str,
    prefix: &str,
) -> Option<&'a str> {
    utility.strip_prefix(prefix)?.strip_suffix(']')
}

pub(super) fn no_transition_all_normalize_arbitrary(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut previous_was_backslash = false;
    for character in value.chars() {
        if character == '_' && !previous_was_backslash {
            normalized.push(' ');
        } else {
            normalized.push(character);
        }
        previous_was_backslash = character == '\\';
    }
    normalized
}
