use oxc_ast::{AstKind, ast::JSXAttributeValue};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::LintContext,
    globals::HTML_TAG,
    rule::Rule,
    utils::{
        get_element_type, has_jsx_prop_ignore_case, is_interactive_element, is_non_interactive_role,
    },
};

#[derive(Debug, Default, Clone)]
pub struct NoInteractiveElementToNoninteractiveRole;

declare_oxc_lint!(
    /// Prevent interactive elements from receiving noninteractive roles.
    NoInteractiveElementToNoninteractiveRole,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prevent interactive elements from receiving noninteractive roles.",
);

impl Rule for NoInteractiveElementToNoninteractiveRole {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let element_type = get_element_type(ctx, opening_element);
        if !HTML_TAG.contains(element_type.as_ref())
            || (element_type != "input" && !is_interactive_element(&element_type, opening_element))
        {
            return;
        }
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
        if is_allowed_role(ctx, element_type.as_ref(), role)
            || (!is_non_interactive_role(role) && !matches!(role, "presentation" | "none"))
        {
            return;
        }
        let message = format!(
            "Screen reader users can't operate this interactive `<{element_type}>` because role `{role}` says it isn't, so remove the role or use a different element."
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
        .and_then(|settings| settings.get("noInteractiveElementToNoninteractiveRole"));
    if let Some(rule_settings) = rule_settings {
        return rule_settings
            .as_object()
            .and_then(|settings| settings.get(element_type))
            .and_then(serde_json::Value::as_array)
            .is_some_and(|roles| roles.iter().any(|allowed| allowed.as_str() == Some(role)));
    }
    matches!(
        (element_type, role),
        ("tr", "none" | "presentation") | ("canvas", "img")
    )
}
