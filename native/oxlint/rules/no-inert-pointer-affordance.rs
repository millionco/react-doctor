use oxc_ast::{AstKind, ast::JSXAttributeItem};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    globals::HTML_TAG,
    rule::Rule,
    utils::{has_jsx_prop_ignore_case, is_interactive_element, is_interactive_role},
};

const MESSAGE: &str = "This pointer cursor promises an interaction, but neither this element nor its wrapping surface handles one.";
const POINTER_HANDLER_PREFIXES: [&str; 5] =
    ["onclick", "onpointer", "onmouse", "ontouch", "ondrag"];

#[derive(Debug, Default, Clone)]
pub struct NoInertPointerAffordance;

declare_oxc_lint!(
    /// Disallow pointer cursors on inert native elements.
    NoInertPointerAffordance,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow pointer cursors without interaction.",
);

impl Rule for NoInertPointerAffordance {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let element_type = resolve_jsx_element_type_name(opening_element, ctx);
        if !HTML_TAG.contains(element_type.as_ref())
            || is_interactive_element(&element_type, opening_element)
        {
            return;
        }
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        if get_effective_tailwind_class_name_token(&tokens, |utility| {
            utility.starts_with("cursor-")
        }) != Some("cursor-pointer")
            || element_type == "label"
            || has_pointer_behavior_signal(opening_element)
            || has_wrapping_interaction_boundary(node, ctx)
            || has_nested_interaction_boundary(node, opening_element, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn has_pointer_behavior_signal(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    if opening_element
        .attributes
        .iter()
        .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        || ["tabindex", "ref", "draggable", "contenteditable"]
            .iter()
            .any(|name| has_jsx_prop_ignore_case(opening_element, name).is_some())
    {
        return true;
    }
    if opening_element.attributes.iter().any(|attribute| {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            return false;
        };
        let oxc_ast::ast::JSXAttributeName::Identifier(identifier) = &attribute.name else {
            return false;
        };
        let attribute_name = identifier.name.as_str();
        POINTER_HANDLER_PREFIXES.iter().any(|prefix| {
            attribute_name
                .get(..prefix.len())
                .is_some_and(|candidate| candidate.eq_ignore_ascii_case(prefix))
        })
    }) {
        return true;
    }
    let Some(JSXAttributeItem::Attribute(role_attribute)) =
        has_jsx_prop_ignore_case(opening_element, "role")
    else {
        return false;
    };
    let Some(role_value) = get_string_literal_attribute_value(role_attribute) else {
        return true;
    };
    role_value
        .trim()
        .split_whitespace()
        .next()
        .is_some_and(|role| is_interactive_role(&role.to_ascii_lowercase()))
}

fn is_interaction_boundary<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let element_type = resolve_jsx_element_type_name(opening_element, ctx);
    !HTML_TAG.contains(element_type.as_ref())
        || element_type == "label"
        || is_interactive_element(&element_type, opening_element)
        || has_pointer_behavior_signal(opening_element)
}

fn has_wrapping_interaction_boundary(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .skip(1)
        .any(|ancestor| match ancestor.kind() {
            AstKind::JSXAttribute(_) => true,
            AstKind::JSXElement(element) => is_interaction_boundary(&element.opening_element, ctx),
            _ => false,
        })
}

fn has_nested_interaction_boundary<'a>(
    node: &AstNode<'a>,
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::JSXElement(element) = parent.kind() else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        let AstKind::JSXOpeningElement(descendant) = candidate.kind() else {
            return false;
        };
        descendant.span.start >= opening_element.span.end
            && descendant.span.end <= element.span.end
            && is_interaction_boundary(descendant, ctx)
    })
}
