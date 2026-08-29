use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};
use oxc_ast::{AstKind, ast::JSXAttributeItem};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

#[derive(Debug, Default, Clone)]
pub struct NoSmoothScrollWithoutReducedMotion;
declare_oxc_lint!(
    /// Require reduced-motion handling for smooth scrolling.
    NoSmoothScrollWithoutReducedMotion,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require reduced-motion handling for smooth scrolling."
);

impl Rule for NoSmoothScrollWithoutReducedMotion {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening) = node.kind() else {
            return;
        };
        if opening
            .attributes
            .iter()
            .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        {
            return;
        }
        let class_name = get_static_class_name(opening);
        let has_tailwind = has_capability_or_unspecified(ctx, "tailwind");
        if has_tailwind && class_name.is_some_and(no_smooth_scroll_has_unsafe_class) {
            ctx.diagnostic(OxcDiagnostic::warn("This scroll-smooth utility also applies to users who request reduced motion. Gate it with motion-safe or add a motion-reduce scroll-auto fallback.").with_label(opening.span));
            return;
        }
        let inline_smooth_property = opening.attributes.iter().find_map(|attribute| {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                return None;
            };
            let style = get_inline_style_object_expression(attribute)?;
            let property = get_effective_static_style_property(style, "scrollBehavior")?;
            (get_object_property_string_value(property) == Some("smooth")).then_some(property)
        });
        if let Some(property) = inline_smooth_property {
            if has_tailwind && class_name.is_some_and(no_smooth_scroll_important_fallback) {
                return;
            }
            ctx.diagnostic(OxcDiagnostic::warn("This inline smooth scrolling cannot adapt to the user's reduced-motion preference. Choose smooth or auto from that preference instead.").with_label(property.span));
        }
    }
}
fn no_smooth_scroll_is_motion_safe(variant: &str) -> bool {
    variant == "motion-safe"
}
fn no_smooth_scroll_is_motion_reduce(variant: &str) -> bool {
    variant == "motion-reduce"
}
fn no_smooth_scroll_non_motion_scope<'a>(variants: &[&'a str]) -> Vec<&'a str> {
    variants
        .iter()
        .copied()
        .filter(|variant| {
            !no_smooth_scroll_is_motion_safe(variant) && !no_smooth_scroll_is_motion_reduce(variant)
        })
        .collect()
}
fn no_smooth_scroll_state(utility: &str) -> Option<bool> {
    match utility {
        "scroll-smooth" => Some(true),
        "scroll-auto" => Some(false),
        _ => None,
    }
}
fn no_smooth_scroll_effective_state(
    tokens: &[TailwindClassNameToken<'_>],
    variants: &[&str],
) -> Option<bool> {
    let resolution = resolve_effective_tailwind_class_name_token(
        tokens,
        |utility| no_smooth_scroll_state(utility).is_some(),
        variants,
    );
    resolution
        .utility
        .and_then(no_smooth_scroll_state)
        .filter(|_| !resolution.is_ambiguous)
}
fn no_smooth_scroll_fallback(
    tokens: &[TailwindClassNameToken<'_>],
    candidate: &TailwindClassNameToken<'_>,
    smooth: &TailwindClassNameToken<'_>,
) -> Option<bool> {
    let candidate_scope = no_smooth_scroll_non_motion_scope(&candidate.variants);
    let smooth_scope = no_smooth_scroll_non_motion_scope(&smooth.variants);
    if !does_tailwind_variant_scope_cover(&candidate_scope, &smooth_scope)
        || smooth.is_important && !candidate.is_important
    {
        return Some(false);
    }
    match no_smooth_scroll_effective_state(tokens, &candidate.variants) {
        Some(false) => {}
        Some(true) => return Some(false),
        None => return None,
    }
    for other in tokens {
        if other.utility != "scroll-smooth"
            || !other
                .variants
                .iter()
                .any(|variant| no_smooth_scroll_is_motion_reduce(variant))
        {
            continue;
        }
        let other_scope = no_smooth_scroll_non_motion_scope(&other.variants);
        if !does_tailwind_variant_scope_cover(&other_scope, &smooth_scope) {
            continue;
        }
        if other.is_important && !candidate.is_important {
            return Some(false);
        }
        if other.is_important != candidate.is_important {
            continue;
        }
        if other_scope.len() > candidate_scope.len() {
            return Some(false);
        }
        if other_scope.len() == candidate_scope.len() {
            return None;
        }
    }
    Some(true)
}
fn no_smooth_scroll_has_unsafe_class(class_name: &str) -> bool {
    let tokens = tailwind_class_name_tokens(class_name);
    tokens.iter().any(|smooth| {
        smooth.utility == "scroll-smooth"
            && !smooth
                .variants
                .iter()
                .any(|variant| no_smooth_scroll_is_motion_safe(variant))
            && no_smooth_scroll_effective_state(&tokens, &smooth.variants) == Some(true)
            && {
                let mut unknown = false;
                let found = tokens.iter().any(|candidate| {
                    if candidate.utility != "scroll-auto"
                        || !candidate
                            .variants
                            .iter()
                            .any(|variant| no_smooth_scroll_is_motion_reduce(variant))
                    {
                        return false;
                    }
                    match no_smooth_scroll_fallback(&tokens, candidate, smooth) {
                        Some(true) => true,
                        None => {
                            unknown = true;
                            false
                        }
                        _ => false,
                    }
                });
                !found && !unknown
            }
    })
}
fn no_smooth_scroll_important_fallback(class_name: &str) -> bool {
    let tokens = tailwind_class_name_tokens(class_name);
    let base = resolve_effective_tailwind_class_name_token(
        &tokens,
        |utility| no_smooth_scroll_state(utility).is_some(),
        &[],
    );
    if base.is_important && base.utility == Some("scroll-auto") {
        return true;
    }
    let inline = TailwindClassNameToken {
        raw_token: "scroll-smooth",
        is_important: false,
        utility: "scroll-smooth",
        variants: Vec::new(),
    };
    tokens.iter().any(|candidate| {
        candidate.is_important
            && candidate.utility == "scroll-auto"
            && candidate
                .variants
                .iter()
                .any(|variant| no_smooth_scroll_is_motion_reduce(variant))
            && no_smooth_scroll_fallback(&tokens, candidate, &inline) == Some(true)
    })
}
