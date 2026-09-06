use oxc_ast::{
    AstKind,
    ast::{
        Argument, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
        MemberExpression, ObjectExpression, ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::Span;

use crate::{
    AstNode,
    context::LintContext,
    rule::Rule,
};

const MISSING_MESSAGE: &str =
    "Your users can't toggle this input because `checked` has no `onChange`.";
const EXCLUSIVE_MESSAGE: &str = "This input mixes `checked` with `defaultChecked`, so React can't tell whether it is controlled or uncontrolled.";

#[derive(Debug, Default, Clone)]
pub struct CheckedRequiresOnchangeOrReadonly;

#[derive(Debug, Default)]
struct AttributePresence {
    checked_span: Option<Span>,
    checked_forwarded: bool,
    default_checked_span: Option<Span>,
    default_checked_forwarded: bool,
    has_on_change_or_read_only: bool,
    has_spread: bool,
    has_truthy_disabled: bool,
}

declare_oxc_lint!(
    /// Require controlled checked inputs to be editable or explicitly read-only.
    CheckedRequiresOnchangeOrReadonly,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require checked inputs to declare their control behavior.",
);

impl Rule for CheckedRequiresOnchangeOrReadonly {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXOpeningElement(opening_element) => {
                if resolve_jsx_element_type(opening_element, ctx)
                    .is_none_or(|(element_type, _)| element_type != "input")
                {
                    return;
                }
                report_presence(collect_jsx_presence(opening_element), ctx);
            }
            AstKind::CallExpression(call_expression)
                if is_create_element_call(call_expression) =>
            {
                let Some(Argument::StringLiteral(element_type)) =
                    call_expression.arguments.first()
                else {
                    return;
                };
                if element_type.value != "input" {
                    return;
                }
                let Some(Argument::ObjectExpression(properties)) =
                    call_expression.arguments.get(1)
                else {
                    return;
                };
                report_presence(collect_object_presence(properties), ctx);
            }
            _ => {}
        }
    }
}

fn report_presence(presence: AttributePresence, ctx: &LintContext<'_>) {
    let Some(checked_span) = presence.checked_span else {
        return;
    };
    if presence.default_checked_span.is_some()
        && !(presence.checked_forwarded && presence.default_checked_forwarded)
        && !configured_checked_setting("ignoreExclusiveCheckedAttribute", ctx)
    {
        ctx.diagnostic(OxcDiagnostic::warn(EXCLUSIVE_MESSAGE).with_label(checked_span));
    }
    if !presence.has_on_change_or_read_only
        && !presence.has_spread
        && !presence.has_truthy_disabled
        && !configured_checked_setting("ignoreMissingProperties", ctx)
    {
        ctx.diagnostic(OxcDiagnostic::warn(MISSING_MESSAGE).with_label(checked_span));
    }
}

fn configured_checked_setting(setting_name: &str, ctx: &LintContext<'_>) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("checkedRequiresOnchangeOrReadonly"))
        .and_then(|settings| settings.get(setting_name))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn collect_jsx_presence(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> AttributePresence {
    let mut presence = AttributePresence::default();
    for attribute_item in &opening_element.attributes {
        let JSXAttributeItem::Attribute(attribute) = attribute_item else {
            presence.has_spread = true;
            continue;
        };
        let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            continue;
        };
        match attribute_name.name.as_str() {
            "checked" => {
                presence.checked_span = Some(attribute.span);
                presence.checked_forwarded = jsx_attribute_forwards_value(attribute);
            }
            "defaultChecked" if presence.default_checked_span.is_none() => {
                presence.default_checked_span = Some(attribute.span);
                presence.default_checked_forwarded = jsx_attribute_forwards_value(attribute);
            }
            "onChange" | "readOnly" => presence.has_on_change_or_read_only = true,
            "disabled" if is_truthy_disabled_jsx_value(attribute) => {
                presence.has_truthy_disabled = true;
            }
            _ => {}
        }
    }
    presence
}

fn collect_object_presence(object: &ObjectExpression<'_>) -> AttributePresence {
    let mut presence = AttributePresence::default();
    for property_kind in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property_kind else {
            presence.has_spread = true;
            continue;
        };
        if property_key_matches_name(&property.key, "checked") {
            presence.checked_span = Some(property.span);
            presence.checked_forwarded = is_forwarded_value_expression(&property.value);
        } else if property_key_matches_name(&property.key, "defaultChecked")
            && presence.default_checked_span.is_none()
        {
            presence.default_checked_span = Some(property.span);
            presence.default_checked_forwarded = is_forwarded_value_expression(&property.value);
        } else if property_key_matches_name(&property.key, "onChange")
            || property_key_matches_name(&property.key, "readOnly")
        {
            presence.has_on_change_or_read_only = true;
        } else if property_key_matches_name(&property.key, "disabled")
            && matches!(&property.value, Expression::BooleanLiteral(value) if value.value)
        {
            presence.has_truthy_disabled = true;
        }
    }
    presence
}

fn jsx_attribute_forwards_value(attribute: &JSXAttribute<'_>) -> bool {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return false;
    };
    container
        .expression
        .as_expression()
        .is_some_and(is_forwarded_value_expression)
}

fn is_forwarded_value_expression(expression: &Expression<'_>) -> bool {
    matches!(expression, Expression::Identifier(_))
        || matches!(
            expression.as_member_expression(),
            Some(MemberExpression::StaticMemberExpression(_))
        )
}

fn is_truthy_disabled_jsx_value(attribute: &JSXAttribute<'_>) -> bool {
    match &attribute.value {
        None => true,
        Some(JSXAttributeValue::ExpressionContainer(container)) => matches!(
            container.expression.as_expression(),
            Some(Expression::BooleanLiteral(value)) if value.value
        ),
        _ => false,
    }
}
