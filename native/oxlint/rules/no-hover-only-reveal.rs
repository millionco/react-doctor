use oxc_ast::{AstKind, ast::JSXChild};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::is_interactive_element,
};

const MOTION_MESSAGE: &str = "This Motion element reveals hidden content only on pointer hover. Add an equivalent whileFocus state and keep the action reachable on touch devices.";

#[derive(Clone, Copy, PartialEq, Eq)]
enum RevealKind {
    Visibility,
    Display,
    Opacity,
}

#[derive(Debug, Default, Clone)]
pub struct NoHoverOnlyReveal;

declare_oxc_lint!(
    /// Disallow content that is revealed only on pointer hover.
    NoHoverOnlyReveal,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow content revealed only on hover.",
);

impl Rule for NoHoverOnlyReveal {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if opening_element
            .attributes
            .iter()
            .any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            })
            || !can_reveal_content_or_action(node, opening_element, ctx)
        {
            return;
        }
        if has_motion_hover_only_reveal(opening_element, ctx) {
            ctx.diagnostic(OxcDiagnostic::warn(MOTION_MESSAGE).with_label(opening_element.span));
            return;
        }
        if !has_capability_or_unspecified(ctx, "tailwind") {
            return;
        }
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let Some(reveal_token) = get_hover_only_reveal(&tokens, opening_element) else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "The \"{}\" utility reveals hidden content only to pointer hover. Add a matching keyboard-focus reveal and a touch-accessible path.",
                reveal_token.raw_token
            ))
            .with_label(opening_element.span),
        );
    }
}

fn can_reveal_content_or_action(
    node: &AstNode<'_>,
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::JSXElement(element) = parent.kind() else {
        return true;
    };
    if element.children.iter().any(child_can_render_content) {
        return true;
    }
    let Some(element_name) = resolve_jsx_element_name(opening_element) else {
        return false;
    };
    is_interactive_element(&element_name.to_ascii_lowercase(), opening_element)
}

fn child_can_render_content(child: &JSXChild<'_>) -> bool {
    match child {
        JSXChild::Text(text) => !text.value.trim().is_empty(),
        JSXChild::ExpressionContainer(container) => match &container.expression {
            oxc_ast::ast::JSXExpression::EmptyExpression(_)
            | oxc_ast::ast::JSXExpression::NullLiteral(_)
            | oxc_ast::ast::JSXExpression::BooleanLiteral(_) => false,
            oxc_ast::ast::JSXExpression::StringLiteral(string) => {
                !string.value.trim().is_empty()
            }
            _ => true,
        },
        JSXChild::Fragment(fragment) => fragment.children.iter().any(child_can_render_content),
        JSXChild::Element(_) => true,
        JSXChild::Spread(_) => false,
    }
}

fn has_motion_hover_only_reveal<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let initial_opacity = static_motion_opacity(opening_element, "initial", ctx);
    let animate_object = get_static_motion_property_object(opening_element, "animate", ctx);
    if get_authoritative_jsx_attribute(opening_element, "animate", true).is_some()
        && animate_object.is_none()
    {
        return false;
    }
    let animate_opacity = animate_object.and_then(static_object_opacity);
    let hover_opacity = static_motion_opacity(opening_element, "whileHover", ctx);
    let focus_opacity = static_motion_opacity(opening_element, "whileFocus", ctx);
    let resting_opacity = if animate_object.is_some() {
        animate_opacity
    } else {
        initial_opacity
    };
    resting_opacity == Some(0.0)
        && hover_opacity.is_some_and(|opacity| opacity > 0.0)
        && !focus_opacity.is_some_and(|opacity| opacity > 0.0)
}

fn static_motion_opacity<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    property_name: &str,
    ctx: &LintContext<'a>,
) -> Option<f64> {
    get_static_motion_property_object(opening_element, property_name, ctx)
        .and_then(static_object_opacity)
}

fn static_object_opacity(
    object_expression: &oxc_ast::ast::ObjectExpression<'_>,
) -> Option<f64> {
    let property = get_effective_static_style_property(object_expression, "opacity")?;
    let oxc_ast::ast::Expression::NumericLiteral(number) = &property.value else {
        return None;
    };
    Some(number.value)
}

fn get_hover_only_reveal<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> Option<&'a TailwindClassNameToken<'a>> {
    let can_receive_keyboard_focus =
        resolve_jsx_element_name(opening_element).is_some_and(|name| {
            if name.chars().next().is_some_and(char::is_lowercase) {
                is_focusable_jsx_opening_element(opening_element, name, false)
            } else {
                true
            }
        });
    for token in tokens {
        let Some(hover_variant_index) = token.variants.iter().position(|variant| {
            matches!(variant_name(variant), "hover" | "group-hover")
        }) else {
            continue;
        };
        let Some(reveal_kind) = reveal_kind(token.utility) else {
            continue;
        };
        let hover_scope = scope_without(&token.variants, hover_variant_index);
        if effective_hidden_state(tokens, &hover_scope, reveal_kind) == Some(true)
            && effective_hidden_state(tokens, &token.variants, reveal_kind) == Some(false)
            && has_keyboard_reveal(
                tokens,
                &token.variants,
                hover_variant_index,
                reveal_kind,
                can_receive_keyboard_focus,
            ) == Some(false)
        {
            return Some(token);
        }
    }
    None
}

fn reveal_kind(utility: &str) -> Option<RevealKind> {
    if utility == "visible" {
        return Some(RevealKind::Visibility);
    }
    if matches!(
        utility,
        "block" | "flex" | "grid" | "inline" | "inline-block" | "inline-flex" | "inline-grid"
    ) {
        return Some(RevealKind::Display);
    }
    static_tailwind_opacity(utility)
        .is_some_and(|opacity| opacity > 0.0)
        .then_some(RevealKind::Opacity)
}

fn hidden_state_for_utility(utility: &str, target_reveal_kind: RevealKind) -> Option<bool> {
    match target_reveal_kind {
        RevealKind::Visibility => match utility {
            "invisible" => Some(true),
            "visible" => Some(false),
            _ => None,
        },
        RevealKind::Display => {
            if utility == "hidden" {
                Some(true)
            } else {
                (reveal_kind(utility) == Some(RevealKind::Display)).then_some(false)
            }
        }
        RevealKind::Opacity => static_tailwind_opacity(utility).map(|opacity| opacity == 0.0),
    }
}

fn effective_hidden_state(
    tokens: &[TailwindClassNameToken<'_>],
    target_scope: &[&str],
    target_reveal_kind: RevealKind,
) -> Option<bool> {
    let mut state = EffectiveTailwindBooleanState {
        is_declared: false,
        is_important: false,
        specificity: 0,
        value: None,
    };
    for token in tokens {
        let Some(value) = hidden_state_for_utility(token.utility, target_reveal_kind) else {
            continue;
        };
        if !does_tailwind_variant_scope_cover(&token.variants, target_scope) {
            continue;
        }
        state = update_effective_tailwind_boolean_state(
            state,
            value,
            token.is_important,
            token.variants.len(),
        );
    }
    state.value
}

fn has_keyboard_reveal(
    tokens: &[TailwindClassNameToken<'_>],
    hover_variants: &[&str],
    hover_variant_index: usize,
    target_reveal_kind: RevealKind,
    can_receive_keyboard_focus: bool,
) -> Option<bool> {
    let hover_variant = hover_variants[hover_variant_index];
    let mut has_unknown_keyboard_state = false;
    for token in tokens {
        let Some(keyboard_variant_index) = token
            .variants
            .iter()
            .position(|variant| equivalent_keyboard_variant(variant, hover_variant))
        else {
            continue;
        };
        if reveal_kind(token.utility) != Some(target_reveal_kind)
            || variant_name(hover_variant) == "hover"
                && (!can_receive_keyboard_focus || target_reveal_kind != RevealKind::Opacity)
        {
            continue;
        }
        let mut keyboard_scope_mapped_to_hover = token.variants.clone();
        keyboard_scope_mapped_to_hover[keyboard_variant_index] = hover_variant;
        if !does_tailwind_variant_scope_cover(&keyboard_scope_mapped_to_hover, hover_variants) {
            continue;
        }
        let keyboard_variant = token.variants[keyboard_variant_index];
        let mut keyboard_target_scope = hover_variants.to_vec();
        keyboard_target_scope[hover_variant_index] = keyboard_variant;
        match effective_hidden_state(tokens, &keyboard_target_scope, target_reveal_kind) {
            Some(false) => return Some(true),
            None => has_unknown_keyboard_state = true,
            Some(true) => {}
        }
    }
    if has_unknown_keyboard_state {
        None
    } else {
        Some(false)
    }
}

fn equivalent_keyboard_variant(keyboard_variant: &str, hover_variant: &str) -> bool {
    let keyboard_name = variant_name(keyboard_variant);
    let hover_name = variant_name(hover_variant);
    let has_equivalent_name = if hover_name == "hover" {
        matches!(keyboard_name, "focus" | "focus-visible")
    } else {
        matches!(keyboard_name, "group-focus" | "group-focus-within")
    };
    has_equivalent_name && variant_modifier(keyboard_variant) == variant_modifier(hover_variant)
}

fn variant_name(variant: &str) -> &str {
    variant.split_once('/').map_or(variant, |(name, _)| name)
}

fn variant_modifier(variant: &str) -> Option<&str> {
    variant.split_once('/').map(|(_, modifier)| modifier)
}

fn scope_without<'a>(variants: &[&'a str], removed_index: usize) -> Vec<&'a str> {
    variants
        .iter()
        .enumerate()
        .filter_map(|(index, variant)| (index != removed_index).then_some(*variant))
        .collect()
}
