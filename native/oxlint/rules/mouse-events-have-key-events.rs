use oxc_ast::{
    AstKind,
    ast::{
        JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXExpression,
        JSXOpeningElement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    globals::HTML_TAG,
    rule::Rule,
};

const DEFAULT_HOVER_IN_HANDLERS: [&str; 1] = ["onMouseOver"];
const DEFAULT_HOVER_OUT_HANDLERS: [&str; 1] = ["onMouseOut"];

#[derive(Debug, Default, Clone)]
pub struct MouseEventsHaveKeyEvents;

struct MouseEventsHaveKeyEventsSettings {
    hover_in_handlers: Vec<String>,
    hover_out_handlers: Vec<String>,
}

declare_oxc_lint!(
    /// Require mouse hover handlers to have keyboard focus equivalents.
    MouseEventsHaveKeyEvents,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require mouse handlers to have keyboard equivalents.",
);

impl Rule for MouseEventsHaveKeyEvents {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let settings = resolve_mouse_events_have_key_events_settings(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if is_local_test_scaffold_jsx(node, ctx)
                || !HTML_TAG.contains(
                    resolve_configured_jsx_element_type(opening_element, ctx).as_str(),
                )
            {
                continue;
            }
            report_missing_keyboard_handler(
                opening_element,
                &settings.hover_in_handlers,
                "onFocus",
                ctx,
            );
            report_missing_keyboard_handler(
                opening_element,
                &settings.hover_out_handlers,
                "onBlur",
                ctx,
            );
        }
    }
}

fn resolve_mouse_events_have_key_events_settings(
    ctx: &LintContext<'_>,
) -> MouseEventsHaveKeyEventsSettings {
    let rule_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("mouseEventsHaveKeyEvents"));
    let string_array = |name| {
        rule_settings
            .and_then(|settings| settings.get(name))
            .and_then(serde_json::Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
    };
    MouseEventsHaveKeyEventsSettings {
        hover_in_handlers: string_array("hoverInHandlers").unwrap_or_else(|| {
            DEFAULT_HOVER_IN_HANDLERS
                .iter()
                .map(|handler| (*handler).to_string())
                .collect()
        }),
        hover_out_handlers: string_array("hoverOutHandlers").unwrap_or_else(|| {
            DEFAULT_HOVER_OUT_HANDLERS
                .iter()
                .map(|handler| (*handler).to_string())
                .collect()
        }),
    }
}

fn report_missing_keyboard_handler<'a>(
    opening_element: &JSXOpeningElement<'a>,
    hover_handlers: &[String],
    keyboard_handler: &str,
    ctx: &LintContext<'a>,
) {
    for hover_handler in hover_handlers {
        let Some(hover_attribute) = jsx_attribute_exact(opening_element, hover_handler) else {
            continue;
        };
        let Some(hover_value) = hover_attribute.value.as_ref() else {
            continue;
        };
        if is_explicit_undefined_expression(hover_value) {
            continue;
        }
        let keyboard_attribute = jsx_attribute_exact(opening_element, keyboard_handler);
        if keyboard_attribute.is_none_or(|attribute| {
            attribute
                .value
                .as_ref()
                .is_some_and(is_explicit_undefined_expression)
        }) {
            let message = format!(
                "Keyboard users miss this `{hover_handler}` because it only fires with a mouse, so add an `{keyboard_handler}` handler too."
            );
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(hover_attribute.span));
        }
        break;
    }
}

fn jsx_attribute_exact<'a, 'b>(
    opening_element: &'b JSXOpeningElement<'a>,
    name: &str,
) -> Option<&'b JSXAttribute<'a>> {
    opening_element
        .attributes
        .iter()
        .find_map(|attribute| match attribute {
            JSXAttributeItem::Attribute(attribute)
                if matches!(
                    &attribute.name,
                    JSXAttributeName::Identifier(identifier) if identifier.name == name
                ) =>
            {
                Some(&**attribute)
            }
            _ => None,
        })
}

fn is_explicit_undefined_expression(value: &JSXAttributeValue<'_>) -> bool {
    matches!(
        value,
        JSXAttributeValue::ExpressionContainer(container)
            if matches!(
                &container.expression,
                JSXExpression::Identifier(identifier) if identifier.name == "undefined"
            )
    )
}
