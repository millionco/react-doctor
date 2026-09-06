use oxc_ast::{
    AstKind,
    ast::{Expression, JSXOpeningElement, ObjectExpression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use rustc_hash::FxHashMap;

use crate::{AstNode, context::LintContext, rule::Rule};

const MOTION_TARGET_PROPERTIES: [&str; 7] = [
    "animate",
    "exit",
    "whileDrag",
    "whileFocus",
    "whileHover",
    "whileInView",
    "whileTap",
];

#[derive(Debug, Default, Clone)]
pub struct NoMixedAnimationOwners;

declare_oxc_lint!(
    /// Disallow CSS and Motion ownership of the same animated property.
    NoMixedAnimationOwners,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "CSS and Motion animate the same property.",
);

impl Rule for NoMixedAnimationOwners {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening) = node.kind() else {
            return;
        };
        if has_any_jsx_spread_attribute(opening) {
            return;
        }
        let Some(ownership) = mixed_motion_owned_properties(opening, ctx) else {
            return;
        };
        if ownership.is_empty() {
            return;
        }
        let class_values = match get_authoritative_jsx_attribute(opening, "className", true) {
            Some(attribute) if has_capability_or_unspecified(ctx, "tailwind") => {
                let Some(values) = get_static_jsx_attribute_string_values(attribute, ctx) else {
                    return;
                };
                values
            }
            _ => vec![String::new()],
        };
        let style = match get_authoritative_jsx_attribute(opening, "style", true) {
            Some(attribute) => {
                let Some(style) = get_inline_style_object_expression_with_aliases(attribute, ctx)
                else {
                    return;
                };
                Some(style)
            }
            None => None,
        };
        let has_tailwind_four = has_capability(ctx, "tailwind:4");
        for class_name in class_values {
            if let Some(property) = mixed_conflicting_property(
                &class_name,
                style,
                &ownership,
                opening,
                has_tailwind_four,
                ctx,
            ) {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Motion and CSS can both animate `{property}` on this element. Keep one animation owner per property to avoid retargeting and lag."
                    ))
                    .with_label(opening.span),
                );
                return;
            }
        }
    }
}

struct MixedMotionOwnership {
    activation_variant: Option<&'static str>,
    excluded_variants: &'static [&'static str],
    property_name: String,
}

fn mixed_motion_owned_properties<'a>(
    opening: &'a JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<Vec<MixedMotionOwnership>> {
    let mut evidence = FxHashMap::default();
    for target in MOTION_TARGET_PROPERTIES {
        let attribute_exists = get_authoritative_jsx_attribute(opening, target, true).is_some();
        let Some(object) = get_static_motion_property_object(opening, target, ctx) else {
            if attribute_exists {
                return None;
            }
            continue;
        };
        let (activation_variant, excluded_variants): (
            Option<&'static str>,
            &'static [&'static str],
        ) = match target {
            "whileFocus" => (Some("focus"), &["disabled", "not-focus"]),
            "whileHover" => (Some("hover"), &["not-hover"]),
            "whileTap" => (Some("active"), &["disabled", "not-active"]),
            _ => (None, &[]),
        };
        for property_name in mixed_effective_motion_property_names(object)? {
            let Some(property_name) = mixed_normalize_motion_property(&property_name) else {
                continue;
            };
            evidence.insert(
                format!("{property_name}:{target}"),
                MixedMotionOwnership {
                    activation_variant,
                    excluded_variants,
                    property_name,
                },
            );
        }
    }
    Some(evidence.into_values().collect())
}

fn mixed_effective_motion_property_names(object: &ObjectExpression<'_>) -> Option<Vec<String>> {
    fn collect(
        object: &ObjectExpression<'_>,
        properties: &mut FxHashMap<String, ()>,
    ) -> Option<()> {
        for property in &object.properties {
            match property {
                ObjectPropertyKind::SpreadProperty(spread) => {
                    let Expression::ObjectExpression(spread_object) =
                        spread.argument.get_inner_expression()
                    else {
                        return None;
                    };
                    collect(spread_object, properties)?;
                }
                ObjectPropertyKind::ObjectProperty(property) => {
                    let name = property.key.static_name()?.to_string();
                    properties.insert(name, ());
                }
            }
        }
        Some(())
    }
    let mut properties = FxHashMap::default();
    collect(object, &mut properties)?;
    Some(properties.into_keys().collect())
}

fn mixed_normalize_motion_property(property: &str) -> Option<String> {
    if matches!(
        property,
        "transition"
            | "transitionEnd"
            | "attrScale"
            | "attrX"
            | "attrY"
            | "d"
            | "pathLength"
            | "pathOffset"
            | "pathSpacing"
            | "points"
            | "viewBox"
    ) {
        return None;
    }
    if matches!(
        property,
        "originX"
            | "originY"
            | "originZ"
            | "rotate"
            | "rotateX"
            | "rotateY"
            | "rotateZ"
            | "scale"
            | "scaleX"
            | "scaleY"
            | "scaleZ"
            | "skew"
            | "skewX"
            | "skewY"
            | "transform"
            | "transformPerspective"
            | "translateX"
            | "translateY"
            | "translateZ"
            | "x"
            | "y"
            | "z"
    ) {
        return Some(if property.starts_with("origin") {
            "transform-origin".to_string()
        } else {
            "transform".to_string()
        });
    }
    if property.starts_with("--") {
        return Some(property.to_string());
    }
    let mut normalized = String::new();
    let property = property
        .strip_prefix("Webkit")
        .map(|suffix| format!("-webkit{suffix}"))
        .or_else(|| {
            property
                .strip_prefix("Moz")
                .map(|suffix| format!("-moz{suffix}"))
        })
        .or_else(|| {
            property
                .strip_prefix("ms")
                .map(|suffix| format!("-ms{suffix}"))
        })
        .unwrap_or_else(|| property.to_string());
    for character in property.chars() {
        if character.is_ascii_uppercase() {
            normalized.push('-');
            normalized.push(character.to_ascii_lowercase());
        } else {
            normalized.push(character.to_ascii_lowercase());
        }
    }
    (!normalized.is_empty()
        && normalized
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_')))
    .then_some(normalized)
}

fn mixed_conflicting_property<'ast>(
    class_name: &str,
    style: Option<&ObjectExpression<'ast>>,
    ownership: &[MixedMotionOwnership],
    opening: &JSXOpeningElement<'ast>,
    has_tailwind_four: bool,
    ctx: &LintContext<'ast>,
) -> Option<String> {
    let tokens = tailwind_class_name_tokens(class_name);
    let mut scopes = vec![Vec::new()];
    for token in &tokens {
        if !scopes.iter().any(|scope| scope == &token.variants) {
            scopes.push(token.variants.clone());
        }
    }
    for scope in scopes {
        if mixed_scope_is_unsupported(&scope, opening, ctx) {
            continue;
        }
        let property_token = mixed_effective_token(&tokens, &scope, |utility| {
            super::no_transition_all::no_transition_all_property_effect(utility).is_some()
        });
        let duration_token = mixed_effective_token(&tokens, &scope, |utility| {
            super::no_transition_all::no_transition_all_is_duration_setter(utility)
        });
        let property_names = property_token.and_then(|token| {
            mixed_tailwind_transition_properties(token.utility, has_tailwind_four)
        });
        let available_hover = tokens.iter().any(|token| token.variants.contains(&"hover"));
        for owner in ownership {
            if owner
                .excluded_variants
                .iter()
                .any(|variant| scope.contains(variant))
                || scope.is_empty() && owner.activation_variant == Some("hover") && available_hover
            {
                continue;
            }
            let class_owns_property = property_names.as_ref().is_some_and(|properties| {
                properties
                    .iter()
                    .any(|property| property == &owner.property_name)
            });
            let default_property = if class_owns_property {
                owner.property_name.as_str()
            } else {
                "all"
            };
            let default_duration = property_token
                .is_some_and(|token| token.utility != "transition-none" && class_owns_property);
            let duration_positive = duration_token
                .and_then(|token| {
                    super::no_transition_all::no_transition_all_duration_effect(
                        token.utility,
                        &[default_property],
                    )
                })
                .and_then(|effect| effect.states)
                .and_then(|states| states.first().copied())
                .unwrap_or(default_duration);
            let property_important =
                property_token.is_some_and(|token| token.is_important && class_owns_property);
            let duration_important = duration_token.is_some_and(|token| token.is_important);
            let transitions =
                super::no_transition_all::no_transition_all_effective_css_transitions(
                    style,
                    default_property,
                    duration_positive,
                    property_important,
                    duration_important,
                )?;
            if transitions.iter().any(|(property, duration)| {
                *duration > 0.0
                    && property != "all"
                    && !property.starts_with("--")
                    && !matches!(
                        property.as_str(),
                        "content-visibility" | "display" | "overlay" | "pointer-events"
                    )
                    && property == &owner.property_name
            }) {
                return Some(owner.property_name.clone());
            }
        }
    }
    None
}

fn mixed_tailwind_transition_properties(
    utility: &str,
    has_tailwind_four: bool,
) -> Option<Vec<String>> {
    let mut properties = match utility {
        "transition" => [
            "backdrop-filter",
            "background-color",
            "border-color",
            "box-shadow",
            "color",
            "fill",
            "filter",
            "opacity",
            "rotate",
            "scale",
            "stroke",
            "text-decoration-color",
            "transform",
            "translate",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
        "transition-colors" => [
            "background-color",
            "border-color",
            "color",
            "fill",
            "stroke",
            "text-decoration-color",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
        "transition-opacity" => vec!["opacity".to_string()],
        "transition-shadow" => vec!["box-shadow".to_string()],
        "transition-transform" if has_tailwind_four => {
            ["rotate", "scale", "transform", "translate"]
                .into_iter()
                .map(str::to_string)
                .collect()
        }
        "transition-transform" => vec!["transform".to_string()],
        _ => super::no_transition_all::no_transition_all_property_effect(utility)?.property_names?,
    };
    if has_tailwind_four && matches!(utility, "transition" | "transition-colors") {
        properties.push("outline-color".to_string());
    }
    Some(properties)
}

fn mixed_effective_token<'a, 'b>(
    tokens: &'b [TailwindClassNameToken<'a>],
    scope: &[&str],
    predicate: impl Fn(&str) -> bool,
) -> Option<&'b TailwindClassNameToken<'a>> {
    let applicable = tokens
        .iter()
        .filter(|token| {
            predicate(token.utility) && does_tailwind_variant_scope_cover(&token.variants, scope)
        })
        .collect::<Vec<_>>();
    let has_important = applicable.iter().any(|token| token.is_important);
    applicable
        .into_iter()
        .filter(|token| !has_important || token.is_important)
        .max_by_key(|token| token.variants.len())
}

fn mixed_scope_is_unsupported<'ast>(
    scope: &[&str],
    opening: &JSXOpeningElement<'ast>,
    ctx: &LintContext<'ast>,
) -> bool {
    scope.iter().any(|variant| {
        matches!(
            *variant,
            "after"
                | "backdrop"
                | "before"
                | "details-content"
                | "file"
                | "first-letter"
                | "first-line"
                | "marker"
                | "placeholder"
                | "selection"
                | "*"
                | "**"
        ) || variant.starts_with("group-")
            || variant.starts_with("peer-")
            || variant.starts_with("has-")
            || variant.starts_with("in-[")
            || variant.starts_with("data-") && !mixed_local_attribute_matches(variant, opening, ctx)
            || variant.starts_with("aria-") && !mixed_local_attribute_matches(variant, opening, ctx)
            || variant.starts_with('[') && *variant != "[&]"
    })
}

fn mixed_local_attribute_matches<'ast>(
    variant: &str,
    opening: &JSXOpeningElement<'ast>,
    ctx: &LintContext<'ast>,
) -> bool {
    let Some((family, remainder)) = variant.split_once('-') else {
        return false;
    };
    let (key, expected) = if let Some(inner) = remainder
        .strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'))
    {
        inner.split_once('=').map_or((inner, None), |(key, value)| {
            (key, Some(value.trim_matches(['\'', '"'])))
        })
    } else {
        (remainder, (family == "aria").then_some("true"))
    };
    let attribute_name = format!("{family}-{key}");
    let Some(attribute) = get_authoritative_jsx_attribute(opening, &attribute_name, false) else {
        return false;
    };
    let Some(expected) = expected else {
        return true;
    };
    if get_static_jsx_attribute_string_values(attribute, ctx)
        .is_some_and(|values| values.iter().any(|value| value == expected))
    {
        return true;
    }
    matches!(
        attribute.value.as_ref(),
        Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container))
            if matches!(&container.expression,
                oxc_ast::ast::JSXExpression::BooleanLiteral(literal)
                    if expected == if literal.value { "true" } else { "false" })
    )
}
