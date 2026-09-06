use oxc_ast::{AstKind, ast::JSXAttributeName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, globals::VALID_ARIA_ROLES, rule::Rule};

const PRESENTATIONAL_CHILD_ROLES: [&str; 15] = [
    "button",
    "checkbox",
    "img",
    "math",
    "menuitemcheckbox",
    "menuitemradio",
    "meter",
    "option",
    "progressbar",
    "radio",
    "scrollbar",
    "separator",
    "slider",
    "switch",
    "tab",
];

#[derive(Debug, Default, Clone)]
pub struct HtmlNoNestedInteractive;

declare_oxc_lint!(
    /// Disallow focusable controls inside interactive ancestors that flatten descendant semantics.
    HtmlNoNestedInteractive,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow nested interactive controls.",
);

impl Rule for HtmlNoNestedInteractive {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let element_type = resolve_jsx_element_type_name(opening_element, ctx);
        if element_type
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_uppercase)
        {
            return;
        }
        let Some(is_ancestor_native_button) =
            enclosing_interactive_control_is_native_button(node, ctx)
        else {
            return;
        };
        let is_nested_native_button = element_type == "button" && is_ancestor_native_button;
        if !is_nested_native_button
            && !is_focusable_jsx_opening_element(opening_element, &element_type, true)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This focusable `<{element_type}>` is nested inside an interactive ancestor whose descendants lose their own semantics. Move the inner control outside."
            ))
            .with_label(opening_element.name.span()),
        );
    }
}

fn enclosing_interactive_control_is_native_button<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let opening_element = match node.kind() {
        AstKind::JSXOpeningElement(opening_element) => opening_element,
        _ => return None,
    };
    let element_type = resolve_jsx_element_type_name(opening_element, ctx);
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        match ancestor.kind() {
            AstKind::JSXAttribute(attribute) => {
                if !matches!(
                    &attribute.name,
                    JSXAttributeName::Identifier(identifier) if identifier.name == "children"
                ) {
                    return None;
                }
            }
            AstKind::JSXElement(element) => {
                let ancestor_opening_element = &element.opening_element;
                let ancestor_type = resolve_jsx_element_type_name(ancestor_opening_element, ctx);
                if ancestor_type
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_uppercase)
                {
                    continue;
                }
                if ancestor_type == "a" && element_type == "a" {
                    return Some(false);
                }
                if has_presentational_child_role(ancestor_opening_element, &ancestor_type, ctx) {
                    return Some(ancestor_type == "button");
                }
            }
            _ => {}
        }
    }
    None
}

fn has_presentational_child_role<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    element_type: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(role_attribute) = get_authoritative_jsx_attribute(opening_element, "role", false)
    else {
        return get_implicit_role(opening_element, element_type, ctx)
            .is_some_and(|role| PRESENTATIONAL_CHILD_ROLES.contains(&role));
    };
    let Some(static_role_value) = get_string_literal_attribute_value(role_attribute) else {
        return false;
    };
    let explicit_role = static_role_value
        .split(|character| is_js_whitespace(character))
        .filter(|role_token| !role_token.is_empty())
        .find_map(|role_token| {
            VALID_ARIA_ROLES
                .iter()
                .find(|valid_role| valid_role.eq_ignore_ascii_case(role_token))
        });
    explicit_role.map_or_else(
        || {
            get_implicit_role(opening_element, element_type, ctx)
                .is_some_and(|role| PRESENTATIONAL_CHILD_ROLES.contains(&role))
        },
        |role| PRESENTATIONAL_CHILD_ROLES.contains(role),
    )
}
