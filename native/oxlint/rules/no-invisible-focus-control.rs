use std::collections::HashMap;

use oxc_ast::{
    ast::{JSXChild, JSXElement, JSXElementName},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    AstNode,
    rule::Rule,
};

const MESSAGE: &str = "This native control is fully transparent, but neither it nor its proxy surface shows keyboard focus.";
const REVEAL_VARIANTS: [&str; 2] = ["focus", "focus-visible"];
const ANCESTOR_FOCUS_VARIANTS: [&str; 2] = ["focus-within", "group-focus-within"];
const PEER_FOCUS_VARIANTS: [&str; 2] = ["peer-focus", "peer-focus-visible"];

#[derive(Debug, Default, Clone)]
pub struct NoInvisibleFocusControl;

declare_oxc_lint!(
    /// Disallow fully transparent native controls without keyboard focus treatment.
    NoInvisibleFocusControl,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow invisible native controls without focus treatment.",
);

impl Rule for NoInvisibleFocusControl {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let tag_name = match &opening_element.name {
            JSXElementName::Identifier(identifier) => identifier.name.to_ascii_lowercase(),
            JSXElementName::IdentifierReference(identifier) => identifier.name.to_ascii_lowercase(),
            _ => return,
        };
        if !is_focusable_jsx_opening_element(opening_element, &tag_name, false)
            || opening_element
                .attributes
                .iter()
                .any(|attribute| {
                    matches!(attribute, oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_))
                })
        {
            return;
        }
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let effective_opacity = get_effective_tailwind_class_name_token(&tokens, |utility| {
            static_tailwind_opacity(utility).is_some()
        });
        let has_unrestored_opacity = effective_opacity
            .is_some_and(|utility| static_tailwind_opacity(utility) == Some(0.0))
            && !has_effective_variant_utility(
                &tokens,
                &REVEAL_VARIANTS,
                opacity_family,
                is_visible_opacity_utility,
            );
        let has_unrestored_visibility = get_effective_tailwind_class_name_token(&tokens, |utility| {
            matches!(utility, "visible" | "invisible" | "collapse")
        }) == Some("invisible")
            && !has_effective_variant_utility(
                &tokens,
                &REVEAL_VARIANTS,
                visibility_family,
                is_visible_visibility_utility,
            );
        if (!has_unrestored_opacity && !has_unrestored_visibility)
            || has_ancestor_focus_indicator(node, ctx)
            || has_later_peer_focus_indicator(node, &tokens, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn has_effective_variant_utility(
    tokens: &[TailwindClassNameToken<'_>],
    variants: &[&str],
    get_family: fn(&str) -> Option<&'static str>,
    is_adding_utility: fn(&str) -> bool,
) -> bool {
    let mut utilities_by_scope_and_family: HashMap<String, Vec<(bool, bool)>> = HashMap::new();
    for token in tokens {
        if !token.variants.iter().any(|variant| {
            let name = variant.split_once('/').map_or(*variant, |(name, _)| name);
            variants.contains(&name)
        }) {
            continue;
        }
        let Some(family) = get_family(token.utility) else {
            continue;
        };
        let mut sorted_variants = token.variants.clone();
        sorted_variants.sort_unstable();
        let scope_and_family = format!("{}|{family}", sorted_variants.join(":"));
        utilities_by_scope_and_family
            .entry(scope_and_family)
            .or_default()
            .push((token.is_important, is_adding_utility(token.utility)));
    }
    utilities_by_scope_and_family.values().any(|utilities| {
        let has_important_utility = utilities.iter().any(|(is_important, _)| *is_important);
        let mut effective_value = None;
        for (is_important, value) in utilities {
            if has_important_utility && !is_important {
                continue;
            }
            if effective_value.is_some_and(|effective| effective != *value) {
                return false;
            }
            effective_value = Some(*value);
        }
        effective_value == Some(true)
    })
}

fn opacity_family(utility: &str) -> Option<&'static str> {
    static_tailwind_opacity(utility).is_some().then_some("opacity")
}

fn visibility_family(utility: &str) -> Option<&'static str> {
    matches!(utility, "visible" | "invisible" | "collapse").then_some("visibility")
}

fn is_visible_opacity_utility(utility: &str) -> bool {
    static_tailwind_opacity(utility).is_some_and(|opacity| opacity > 0.0)
}

fn is_visible_visibility_utility(utility: &str) -> bool {
    utility == "visible"
}

fn get_focus_indicator_family(utility: &str) -> Option<&'static str> {
    for family in ["border", "outline", "ring"] {
        if utility == family {
            return Some(family);
        }
        let Some(modifier) = utility
            .strip_prefix(family)
            .and_then(|suffix| suffix.strip_prefix('-'))
        else {
            continue;
        };
        if modifier.is_empty() || is_indicator_adjustment_modifier(modifier) {
            return None;
        }
        return Some(family);
    }
    None
}

fn is_visible_focus_indicator_utility(utility: &str) -> bool {
    let Some(family) = get_focus_indicator_family(utility) else {
        return false;
    };
    if utility == family {
        return true;
    }
    let modifier = &utility[family.len() + 1..];
    !["0", "none", "transparent"]
        .iter()
        .any(|prefix| modifier_has_prefix(modifier, prefix, true))
}

fn is_indicator_adjustment_modifier(modifier: &str) -> bool {
    ["offset", "opacity", "spacing"]
        .iter()
        .any(|prefix| modifier_has_prefix(modifier, prefix, false))
}

fn modifier_has_prefix(modifier: &str, prefix: &str, allow_slash: bool) -> bool {
    modifier == prefix
        || modifier
            .strip_prefix(prefix)
            .is_some_and(|suffix| suffix.starts_with('-') || allow_slash && suffix.starts_with('/'))
}

fn has_ancestor_focus_indicator(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node.id()).skip(1).any(|ancestor| {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            return false;
        };
        get_static_class_name(&element.opening_element).is_some_and(|class_name| {
            has_effective_variant_utility(
                &tailwind_class_name_tokens(class_name),
                &ANCESTOR_FOCUS_VARIANTS,
                get_focus_indicator_family,
                is_visible_focus_indicator_utility,
            )
        })
    })
}

fn has_later_peer_focus_indicator<'a>(
    node: &AstNode<'a>,
    tokens: &[TailwindClassNameToken<'_>],
    ctx: &LintContext<'a>,
) -> bool {
    if !tokens
        .iter()
        .any(|token| token.raw_token == "peer" || token.raw_token.starts_with("peer/"))
    {
        return false;
    }
    let control_node = ctx.nodes().parent_node(node.id());
    let AstKind::JSXElement(control_element) = control_node.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(control_node.id());
    let children = if let AstKind::JSXElement(element) = parent.kind() {
        &element.children
    } else if let AstKind::JSXFragment(fragment) = parent.kind() {
        &fragment.children
    } else {
        return false;
    };
    later_siblings(children, control_element).any(|sibling| {
        get_static_class_name(&sibling.opening_element).is_some_and(|class_name| {
            has_effective_variant_utility(
                &tailwind_class_name_tokens(class_name),
                &PEER_FOCUS_VARIANTS,
                get_focus_indicator_family,
                is_visible_focus_indicator_utility,
            )
        })
    })
}

fn later_siblings<'a>(
    children: &'a [JSXChild<'a>],
    control_element: &JSXElement<'a>,
) -> impl Iterator<Item = &'a JSXElement<'a>> {
    children
        .iter()
        .skip_while(move |child| {
            !matches!(child, JSXChild::Element(element) if std::ptr::eq(element.as_ref(), control_element))
        })
        .skip(1)
        .filter_map(|child| match child {
            JSXChild::Element(element) => Some(element.as_ref()),
            _ => None,
        })
}
