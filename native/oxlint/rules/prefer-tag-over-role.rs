use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXChild, JSXOpeningElement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::{
        get_string_literal_prop_value, get_tags_for_role, has_jsx_prop_ignore_case,
        is_interactive_element,
    },
};

const ROLES_WITHOUT_CLEAN_TAG: [&str; 8] = [
    "listbox", "combobox", "option", "group", "region", "img", "dialog", "status",
];
const TABLE_STRUCTURE_ROLES: [&str; 6] = [
    "row",
    "rowgroup",
    "columnheader",
    "rowheader",
    "gridcell",
    "cell",
];
const VALUED_WIDGET_ROLES: [&str; 3] = ["separator", "slider", "spinbutton"];
const VALUED_WIDGET_SIGNAL_ATTRIBUTES: [&str; 8] = [
    "tabindex",
    "aria-valuenow",
    "aria-valuemin",
    "aria-valuemax",
    "aria-orientation",
    "onmousedown",
    "onpointerdown",
    "ontouchstart",
];
const CHILD_REJECTING_TAGS: [&str; 3] = ["hr", "input", "progress"];
const NON_PHRASING_TAGS: [&str; 32] = [
    "address",
    "article",
    "aside",
    "blockquote",
    "dd",
    "details",
    "dialog",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "ul",
];

#[derive(Debug, Default, Clone)]
pub struct PreferTagOverRole;

declare_oxc_lint!(
    /// Prefer native semantic HTML over generic elements with ARIA roles.
    PreferTagOverRole,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prefer semantic HTML tags over ARIA roles.",
);

impl Rule for PreferTagOverRole {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        let mut button_incompatible_spans = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                    return None;
                };
                is_button_incompatible_element(opening_element, ctx).then_some(opening_element.span)
            })
            .collect::<Vec<_>>();
        button_incompatible_spans.sort_unstable_by_key(|span| span.start);
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            prefer_tag_over_role_check(node, opening_element, &button_incompatible_spans, ctx);
        }
    }
}

fn prefer_tag_over_role_check<'a>(
    node: &AstNode<'a>,
    opening_element: &'a JSXOpeningElement<'a>,
    button_incompatible_spans: &[oxc_span::Span],
    ctx: &LintContext<'a>,
) {
    let element_type = resolve_configured_jsx_element_type(opening_element, ctx);
    let is_generic_container = matches!(element_type.as_str(), "div" | "span");
    if !is_generic_container && element_type != "a" {
        return;
    }
    let Some(role_item) = has_jsx_prop_ignore_case(opening_element, "role") else {
        return;
    };
    let Some(role) = get_string_literal_prop_value(role_item) else {
        return;
    };
    let JSXAttributeItem::Attribute(role_attribute) = role_item else {
        return;
    };
    if role.is_empty()
        || (!is_generic_container
            && (role != "button"
                || has_jsx_prop_ignore_case(opening_element, "href").is_some()
                || has_any_jsx_spread_attribute(opening_element)))
        || ROLES_WITHOUT_CLEAN_TAG.contains(&role)
        || TABLE_STRUCTURE_ROLES.contains(&role)
        || (VALUED_WIDGET_ROLES.contains(&role)
            && VALUED_WIDGET_SIGNAL_ATTRIBUTES
                .iter()
                .any(|attribute_name| {
                    has_jsx_prop_ignore_case(opening_element, attribute_name).is_some()
                }))
        || is_statically_hidden_from_screen_reader(opening_element, ctx)
        || has_jsx_prop_ignore_case(opening_element, "contenteditable").is_some()
    {
        return;
    }
    let matching_tags = get_tags_for_role(role);
    let Some(preferred_tag) = (role == "list")
        .then_some("ul")
        .or_else(|| matching_tags.first().copied())
    else {
        return;
    };
    let parent = ctx.nodes().parent_node(node.id());
    let enclosing_element = match parent.kind() {
        AstKind::JSXElement(element) => Some(element),
        _ => None,
    };
    if CHILD_REJECTING_TAGS.contains(&preferred_tag)
        && enclosing_element.is_some_and(|element| element.children.iter().any(is_meaningful_child))
    {
        return;
    }
    if matches!(preferred_tag, "button" | "a") {
        if enclosing_element.is_some_and(|element| {
            has_button_incompatible_descendant(element, button_incompatible_spans)
        }) || ctx.nodes().ancestors(node.id()).skip(1).any(|ancestor| {
            let AstKind::JSXElement(element) = ancestor.kind() else {
                return false;
            };
            let ancestor_type = resolve_configured_jsx_element_type(&element.opening_element, ctx);
            is_interactive_element(&ancestor_type, &element.opening_element)
        }) {
            return;
        }
    }
    let message = format!(
        "Screen reader users get more reliable semantics from `<{preferred_tag}>` than `role=\"{role}\"`, so use `<{preferred_tag}>` instead."
    );
    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(role_attribute.span));
}

fn has_button_incompatible_descendant(
    element: &oxc_ast::ast::JSXElement<'_>,
    button_incompatible_spans: &[oxc_span::Span],
) -> bool {
    let first_child = button_incompatible_spans
        .partition_point(|span| span.start < element.opening_element.span.end);
    button_incompatible_spans[first_child..]
        .iter()
        .take_while(|span| span.start < element.span.end)
        .any(|span| element.span.contains_inclusive(*span))
}

fn is_button_incompatible_element<'a>(
    opening_element: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let element_type = resolve_configured_jsx_element_type(opening_element, ctx);
    is_interactive_element(&element_type, opening_element)
        || element_type == "label"
        || NON_PHRASING_TAGS.contains(&element_type.as_str())
}

fn is_meaningful_child(child: &JSXChild<'_>) -> bool {
    match child {
        JSXChild::Text(text) => !text.value.trim().is_empty() || !text.value.contains('\n'),
        JSXChild::ExpressionContainer(container) => {
            let Some(expression) = container.expression.as_expression() else {
                return false;
            };
            !is_static_nullish_expression(expression.get_inner_expression())
        }
        _ => true,
    }
}

fn is_static_nullish_expression(expression: &Expression<'_>) -> bool {
    matches!(expression, Expression::NullLiteral(_))
        || matches!(expression, Expression::Identifier(identifier) if identifier.name == "undefined")
        || matches!(expression, Expression::UnaryExpression(unary) if unary.operator.is_void())
}
