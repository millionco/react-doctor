use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const STYLE_MESSAGE: &str = "This boolean prop style disagrees with the project setting, so equivalent true props are harder to scan consistently.";

#[derive(Debug, Default, Clone)]
pub struct JsxBooleanValue;

declare_oxc_lint!(
    /// Enforce consistent boolean prop notation.
    JsxBooleanValue,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Enforce consistent boolean prop notation.",
);

impl Rule for JsxBooleanValue {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let settings = ctx
            .settings()
            .json
            .as_ref()
            .and_then(|settings| settings.get("react-doctor"))
            .and_then(|settings| settings.get("jsxBooleanValue"));
        let mode = settings
            .and_then(|settings| settings.get("mode"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("never");
        let always = settings
            .and_then(|settings| settings.get("always"))
            .and_then(serde_json::Value::as_array);
        let never = settings
            .and_then(|settings| settings.get("never"))
            .and_then(serde_json::Value::as_array);
        let assume_undefined_is_false = settings
            .and_then(|settings| settings.get("assumeUndefinedIsFalse"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);

        for attribute in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                continue;
            };
            let is_always_exception = setting_contains(always, attribute_name.name.as_str());
            let is_never_exception = setting_contains(never, attribute_name.name.as_str());
            if mode == "never" && attribute.value.is_none() && is_always_exception {
                ctx.diagnostic(OxcDiagnostic::warn(STYLE_MESSAGE).with_label(attribute.span));
                continue;
            }
            if mode == "always" && attribute.value.is_none() && !is_never_exception {
                ctx.diagnostic(OxcDiagnostic::warn(STYLE_MESSAGE).with_label(attribute.span));
                continue;
            }
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(Expression::BooleanLiteral(boolean_literal)) =
                container.expression.as_expression()
            else {
                continue;
            };
            if mode == "never"
                && !is_always_exception
                && (boolean_literal.value || assume_undefined_is_false)
            {
                let message = if boolean_literal.value {
                    STYLE_MESSAGE.to_string()
                } else {
                    format!(
                        "`{}={{false}}` does nothing, so the explicit false value adds noise without changing output.",
                        attribute_name.name
                    )
                };
                ctx.diagnostic(OxcDiagnostic::warn(message).with_label(attribute.span));
            } else if mode == "always" && is_never_exception {
                ctx.diagnostic(OxcDiagnostic::warn(STYLE_MESSAGE).with_label(attribute.span));
            }
        }
    }
}

fn setting_contains(settings: Option<&Vec<serde_json::Value>>, attribute_name: &str) -> bool {
    settings.is_some_and(|settings| {
        settings
            .iter()
            .any(|setting| setting.as_str() == Some(attribute_name))
    })
}
