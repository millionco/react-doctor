use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeValue, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::LintContext,
    globals::{HTML_TAG, VALID_ARIA_ROLES},
    rule::Rule,
    utils::{get_element_type, has_jsx_prop_ignore_case},
};

const BASE_MESSAGE: &str = "This `role` is not a valid ARIA role, so assistive tech cannot expose it correctly. Use a real, non-abstract role.";

#[derive(Debug, Default, Clone)]
pub struct AriaRole;

declare_oxc_lint!(
    /// Require valid, non-abstract ARIA roles.
    AriaRole,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require valid, non-abstract ARIA roles.",
);

impl Rule for AriaRole {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(JSXAttributeItem::Attribute(role_attribute)) =
            has_jsx_prop_ignore_case(opening_element, "role")
        else {
            return;
        };
        if ignore_non_dom(ctx)
            && !HTML_TAG.contains(get_element_type(ctx, opening_element).as_ref())
        {
            return;
        }
        match role_attribute.value.as_ref() {
            None => report_invalid_role(role_attribute.span, None, ctx),
            Some(JSXAttributeValue::StringLiteral(string_literal)) => {
                report_first_invalid_candidate(
                    &[string_literal.value.to_string()],
                    role_attribute.span,
                    ctx,
                );
            }
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                if matches!(container.expression, JSXExpression::NullLiteral(_))
                    || container.expression.is_undefined()
                {
                    report_invalid_role(role_attribute.span, None, ctx);
                    return;
                }
                if let Some(candidates) =
                    get_static_jsx_attribute_string_values(role_attribute, ctx)
                {
                    report_first_invalid_candidate(&candidates, role_attribute.span, ctx);
                }
            }
            Some(_) => report_invalid_role(role_attribute.span, None, ctx),
        }
    }
}

fn report_first_invalid_candidate(candidates: &[String], span: oxc_span::Span, ctx: &LintContext) {
    let allowed_invalid_roles = allowed_invalid_roles(ctx);
    for candidate in candidates {
        if candidate.trim().is_empty() {
            report_invalid_role(span, None, ctx);
            return;
        }
        if let Some(invalid_role) = candidate.split_whitespace().find(|role| {
            !VALID_ARIA_ROLES.contains(*role)
                && !allowed_invalid_roles.iter().any(|allowed| allowed == role)
        }) {
            report_invalid_role(span, Some(invalid_role), ctx);
            return;
        }
    }
}

fn report_invalid_role(span: oxc_span::Span, invalid_role: Option<&str>, ctx: &LintContext) {
    let message = invalid_role.map_or_else(
        || BASE_MESSAGE.to_string(),
        |role| format!("{BASE_MESSAGE} `{role}` is not one."),
    );
    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(span));
}

fn react_doctor_settings<'a>(
    ctx: &'a LintContext<'_>,
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
}

fn ignore_non_dom(ctx: &LintContext) -> bool {
    react_doctor_settings(ctx)
        .and_then(|settings| settings.get("ariaRole"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("ignoreNonDOM"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or_else(|| {
            react_doctor_settings(ctx)
                .and_then(|settings| settings.get("portedRuleMode"))
                .and_then(serde_json::Value::as_str)
                == Some("curated")
        })
}

fn allowed_invalid_roles<'a>(ctx: &'a LintContext<'_>) -> Vec<&'a str> {
    react_doctor_settings(ctx)
        .and_then(|settings| settings.get("ariaRole"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("allowedInvalidRoles"))
        .and_then(serde_json::Value::as_array)
        .map(|roles| roles.iter().filter_map(serde_json::Value::as_str).collect())
        .unwrap_or_default()
}
