use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode, context::LintContext, globals::HTML_TAG, rule::Rule, utils::has_jsx_prop_ignore_case,
};

const ROLE_REQUIRED_PROPS: &[(&str, &[&str])] = &[
    ("checkbox", &["aria-checked"]),
    ("combobox", &["aria-controls", "aria-expanded"]),
    ("heading", &["aria-level"]),
    ("menuitemcheckbox", &["aria-checked"]),
    ("menuitemradio", &["aria-checked"]),
    ("meter", &["aria-valuenow"]),
    ("option", &["aria-selected"]),
    ("radio", &["aria-checked"]),
    ("scrollbar", &["aria-controls", "aria-valuenow"]),
    ("slider", &["aria-valuenow"]),
    ("switch", &["aria-checked"]),
];

#[derive(Debug, Default, Clone)]
pub struct RoleHasRequiredAriaProps;

declare_oxc_lint!(
    /// Require every ARIA property required by an explicit role.
    RoleHasRequiredAriaProps,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require every ARIA property required by an explicit role.",
);

impl Rule for RoleHasRequiredAriaProps {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let should_use_curated_behavior = should_use_curated_port_behavior(ctx);
        if should_use_curated_behavior && is_local_test_scaffold_jsx(node, ctx) {
            return;
        }
        let element_type = resolve_configured_jsx_element_type(opening_element, ctx);
        if !HTML_TAG.contains(element_type.as_str()) {
            return;
        }
        let Some(JSXAttributeItem::Attribute(role_attribute)) =
            has_jsx_prop_ignore_case(opening_element, "role")
        else {
            return;
        };
        let Some(role_candidates) = get_static_jsx_attribute_string_values(role_attribute, ctx)
        else {
            return;
        };
        let mut roles = Vec::new();
        for candidate in role_candidates {
            for role in candidate.split_whitespace() {
                if !roles.iter().any(|existing_role| existing_role == role) {
                    roles.push(role.to_string());
                }
            }
        }
        for role in roles {
            let Some((_, required_properties)) = ROLE_REQUIRED_PROPS
                .iter()
                .find(|(required_role, _)| *required_role == role.as_str())
            else {
                continue;
            };
            let missing_properties = required_properties
                .iter()
                .copied()
                .filter(|property| {
                    !(should_use_curated_behavior
                        && supplies_native_aria_property(opening_element, &element_type, property))
                        && has_jsx_prop_ignore_case(opening_element, property).is_none()
                })
                .collect::<Vec<_>>();
            if missing_properties.is_empty() {
                continue;
            }
            let message = format!(
                "Screen reader users can't tell the state of this `{role}` without its required ARIA props, so add `{}`.",
                missing_properties.join("`, `")
            );
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(role_attribute.span));
        }
    }
}

fn supplies_native_aria_property(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    element_type: &str,
    property: &str,
) -> bool {
    if property == "aria-level" && matches!(element_type, "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
        return true;
    }
    if element_type == "select" {
        return matches!(property, "aria-controls" | "aria-expanded");
    }
    if property == "aria-selected" && element_type == "option" {
        return true;
    }
    if element_type != "input" {
        return false;
    }
    let input_type = has_jsx_prop_ignore_case(opening_element, "type")
        .and_then(|attribute| match attribute {
            JSXAttributeItem::Attribute(attribute) => attribute.value.as_ref(),
            JSXAttributeItem::SpreadAttribute(_) => None,
        })
        .and_then(|value| match value {
            JSXAttributeValue::StringLiteral(string_literal) => Some(string_literal.value.as_str()),
            _ => None,
        });
    if property == "aria-checked" {
        return matches!(input_type, Some("checkbox" | "radio"));
    }
    matches!(
        (input_type, property),
        (
            Some("range"),
            "aria-valuenow" | "aria-valuemin" | "aria-valuemax"
        )
    )
}
