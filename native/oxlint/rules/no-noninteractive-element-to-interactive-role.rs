use oxc_ast::{AstKind, ast::JSXAttributeValue};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::LintContext,
    globals::HTML_TAG,
    rule::Rule,
    utils::{
        get_element_type, has_jsx_prop_ignore_case, is_interactive_role, is_non_interactive_element,
    },
};

#[derive(Debug, Default, Clone)]
pub struct NoNoninteractiveElementToInteractiveRole;

declare_oxc_lint!(
    /// Prevent noninteractive elements from receiving interactive roles.
    NoNoninteractiveElementToInteractiveRole,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prevent noninteractive elements from receiving interactive roles.",
);

impl Rule for NoNoninteractiveElementToInteractiveRole {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(oxc_ast::ast::JSXAttributeItem::Attribute(role_attribute)) =
            has_jsx_prop_ignore_case(opening_element, "role")
        else {
            return;
        };
        let Some(JSXAttributeValue::StringLiteral(role_value)) = role_attribute.value.as_ref()
        else {
            return;
        };
        let Some(role) = role_value.value.trim().split_whitespace().next() else {
            return;
        };
        let element_type = get_element_type(ctx, opening_element);
        if !HTML_TAG.contains(element_type.as_ref())
            || is_allowed_role(ctx, element_type.as_ref(), role)
            || !is_non_interactive_element(&element_type, opening_element)
            || !is_interactive_role(role)
            || (role == "separator"
                && has_jsx_prop_ignore_case(opening_element, "tabindex").is_none())
        {
            return;
        }
        let message = format!(
            "Role `{role}` gives `<{element_type}>` interactive semantics even though the element is noninteractive, so screen reader users get the wrong controls."
        );
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(role_attribute.span));
    }
}

fn is_allowed_role(ctx: &LintContext, element_type: &str, role: &str) -> bool {
    let rule_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("noNoninteractiveElementToInteractiveRole"));
    if let Some(rule_settings) = rule_settings {
        return rule_settings
            .as_object()
            .and_then(|settings| settings.get(element_type))
            .and_then(serde_json::Value::as_array)
            .is_some_and(|roles| roles.iter().any(|allowed| allowed.as_str() == Some(role)));
    }
    match element_type {
        "ul" | "ol" => matches!(
            role,
            "listbox" | "menu" | "menubar" | "radiogroup" | "tablist" | "tree" | "treegrid"
        ),
        "li" => matches!(
            role,
            "menuitem"
                | "menuitemcheckbox"
                | "menuitemradio"
                | "option"
                | "row"
                | "tab"
                | "treeitem"
        ),
        "table" => role == "grid",
        "td" => role == "gridcell",
        "nav" => role == "tablist",
        "fieldset" => matches!(role, "radiogroup" | "presentation"),
        _ => false,
    }
}
