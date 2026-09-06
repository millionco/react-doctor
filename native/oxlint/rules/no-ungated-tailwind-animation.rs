use oxc_ast::{AstKind, ast::JSXAttributeItem};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This Tailwind animation runs even when the user requests reduced motion. Gate it with motion-safe or add a motion-reduce animation alternative.";

#[derive(Clone, Copy)]
enum AlternativeProperty {
    Animation,
    Display,
    Visibility,
}

#[derive(Debug, Default, Clone)]
pub struct NoUngatedTailwindAnimation;

declare_oxc_lint!(
    /// Disallow Tailwind animations without a reduced-motion path.
    NoUngatedTailwindAnimation,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow ungated Tailwind animations.",
);

impl Rule for NoUngatedTailwindAnimation {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if opening_element
            .attributes
            .iter()
            .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        {
            return;
        }
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        if class_name.is_empty() || !no_ungated_tailwind_animation_has_unsafe_animation(class_name) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn no_ungated_tailwind_animation_has_unsafe_animation(class_name: &str) -> bool {
    let tokens = tailwind_class_name_tokens(class_name);
    tokens.iter().any(|animation_token| {
        if !no_ungated_tailwind_animation_is_animation_utility(animation_token.utility)
            || animation_token
                .variants
                .iter()
                .any(|variant| no_ungated_tailwind_animation_is_motion_safe_variant(variant))
        {
            return false;
        }
        let effective_animation = resolve_effective_tailwind_class_name_token(
            &tokens,
            no_ungated_tailwind_animation_sets_animation_property,
            &animation_token.variants,
        );
        if effective_animation.is_ambiguous
            || effective_animation.utility != Some(animation_token.utility)
            || effective_animation.is_important != animation_token.is_important
        {
            return false;
        }
        if animation_token
            .variants
            .iter()
            .any(|variant| no_ungated_tailwind_animation_is_reduced_motion_variant(variant))
            && !no_ungated_tailwind_animation_is_spatial_reduced_motion_utility(
                animation_token.utility,
            )
        {
            return false;
        }

        let animation_variant_scope = no_ungated_tailwind_animation_non_motion_variant_scope(
            &animation_token.variants,
        );
        let mut has_unknown_reduced_motion_alternative = false;
        let has_reduced_motion_alternative = tokens.iter().any(|candidate| {
            if !candidate
                .variants
                .iter()
                .any(|variant| no_ungated_tailwind_animation_is_reduced_motion_variant(variant))
            {
                return false;
            }
            let is_safe_animation_alternative = candidate.utility == "animate-none"
                || no_ungated_tailwind_animation_is_animation_utility(candidate.utility)
                    && !no_ungated_tailwind_animation_is_spatial_reduced_motion_utility(
                        candidate.utility,
                    );
            let is_visibility_alternative = matches!(candidate.utility, "hidden" | "invisible");
            if !is_safe_animation_alternative && !is_visibility_alternative
                || is_safe_animation_alternative
                    && animation_token.is_important
                    && !candidate.is_important
            {
                return false;
            }
            match no_ungated_tailwind_animation_is_effective_alternative(
                &tokens,
                candidate,
                &animation_variant_scope,
            ) {
                Some(is_effective) => is_effective,
                None => {
                    has_unknown_reduced_motion_alternative = true;
                    false
                }
            }
        });
        !has_reduced_motion_alternative && !has_unknown_reduced_motion_alternative
    })
}

fn no_ungated_tailwind_animation_is_effective_alternative(
    tokens: &[TailwindClassNameToken<'_>],
    candidate: &TailwindClassNameToken<'_>,
    animation_variant_scope: &[&str],
) -> Option<bool> {
    let candidate_variant_scope =
        no_ungated_tailwind_animation_non_motion_variant_scope(&candidate.variants);
    if !does_tailwind_variant_scope_cover(&candidate_variant_scope, animation_variant_scope) {
        return Some(false);
    }
    let property = if no_ungated_tailwind_animation_sets_animation_property(candidate.utility) {
        AlternativeProperty::Animation
    } else if candidate.utility == "hidden" {
        AlternativeProperty::Display
    } else {
        AlternativeProperty::Visibility
    };
    let effective_candidate = resolve_effective_tailwind_class_name_token(
        tokens,
        |utility| no_ungated_tailwind_animation_matches_property(utility, property),
        &candidate.variants,
    );
    if effective_candidate.is_ambiguous {
        return None;
    }
    if effective_candidate.utility != Some(candidate.utility) {
        return Some(false);
    }

    for other_token in tokens {
        if other_token.utility == candidate.utility
            || !no_ungated_tailwind_animation_matches_property(other_token.utility, property)
            || !other_token
                .variants
                .iter()
                .any(|variant| no_ungated_tailwind_animation_is_reduced_motion_variant(variant))
        {
            continue;
        }
        let other_variant_scope =
            no_ungated_tailwind_animation_non_motion_variant_scope(&other_token.variants);
        if !does_tailwind_variant_scope_cover(&other_variant_scope, animation_variant_scope) {
            continue;
        }
        if other_token.is_important && !candidate.is_important {
            return Some(false);
        }
        if other_token.is_important != candidate.is_important {
            continue;
        }
        if other_variant_scope.len() > candidate_variant_scope.len() {
            return Some(false);
        }
        if other_variant_scope.len() == candidate_variant_scope.len() {
            return None;
        }
    }
    Some(true)
}

fn no_ungated_tailwind_animation_matches_property(
    utility: &str,
    property: AlternativeProperty,
) -> bool {
    match property {
        AlternativeProperty::Animation => {
            no_ungated_tailwind_animation_sets_animation_property(utility)
        }
        AlternativeProperty::Display => matches!(
            utility,
            "hidden"
                | "block"
                | "flex"
                | "grid"
                | "inline"
                | "inline-block"
                | "inline-flex"
                | "inline-grid"
        ),
        AlternativeProperty::Visibility => matches!(utility, "visible" | "invisible"),
    }
}

fn no_ungated_tailwind_animation_is_animation_utility(utility: &str) -> bool {
    if utility == "animate-none" {
        return false;
    }
    if let Some(arbitrary_value) = utility
        .strip_prefix("animate-[")
        .and_then(|value| value.strip_suffix(']'))
    {
        if normalize_tailwind_arbitrary_utility_value(arbitrary_value)
            .trim()
            .eq_ignore_ascii_case("none")
        {
            return false;
        }
    }
    utility.starts_with("animate-") || utility == "animate"
}

fn no_ungated_tailwind_animation_sets_animation_property(utility: &str) -> bool {
    utility == "animate-none" || no_ungated_tailwind_animation_is_animation_utility(utility)
}

fn no_ungated_tailwind_animation_is_spatial_reduced_motion_utility(utility: &str) -> bool {
    matches!(utility, "animate-bounce" | "animate-ping" | "animate-spin")
}

fn no_ungated_tailwind_animation_is_motion_safe_variant(variant: &str) -> bool {
    variant.split('/').next() == Some("motion-safe")
}

fn no_ungated_tailwind_animation_is_reduced_motion_variant(variant: &str) -> bool {
    variant.split('/').next() == Some("motion-reduce")
}

fn no_ungated_tailwind_animation_non_motion_variant_scope<'a>(
    variants: &[&'a str],
) -> Vec<&'a str> {
    variants
        .iter()
        .copied()
        .filter(|variant| {
            !no_ungated_tailwind_animation_is_motion_safe_variant(variant)
                && !no_ungated_tailwind_animation_is_reduced_motion_variant(variant)
        })
        .collect()
}
