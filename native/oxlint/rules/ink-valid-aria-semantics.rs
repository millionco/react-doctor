use oxc_ast::{ast::JSXAttributeValue, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const INK_ARIA_ROLES: [&str; 18] = [
    "button",
    "checkbox",
    "combobox",
    "list",
    "listbox",
    "listitem",
    "menu",
    "menuitem",
    "option",
    "progressbar",
    "radio",
    "radiogroup",
    "tab",
    "tablist",
    "table",
    "textbox",
    "timer",
    "toolbar",
];
const INK_ARIA_STATE_NAMES: [&str; 9] = [
    "busy",
    "checked",
    "disabled",
    "expanded",
    "multiline",
    "multiselectable",
    "readonly",
    "required",
    "selected",
];

#[derive(Debug, Default, Clone)]
pub struct InkValidAriaSemantics;

declare_oxc_lint!(
    /// Validate Ink accessibility roles, states, and hidden labels.
    InkValidAriaSemantics,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Ink accessibility semantics.",
);

impl Rule for InkValidAriaSemantics {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(element_name) = resolve_imported_jsx_component_name(opening_element, "ink", ctx)
        else {
            return;
        };
        if let Some(role_attribute) = find_jsx_attribute(opening_element, "aria-role") {
            if element_name != "Box" {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Ink `<{element_name}>` does not support `aria-role`; put semantics on a `<Box>`."
                    ))
                    .with_label(role_attribute.span),
                );
            } else if let Some(role) = role_attribute
                .value
                .as_ref()
                .and_then(|value| get_direct_string_literal_attribute_value(value))
            {
                if !INK_ARIA_ROLES.contains(&role) {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(format!(
                            "Ink does not expose the ARIA role `{role}` to screen readers."
                        ))
                        .with_label(role_attribute.span),
                    );
                }
            }
        }
        if let Some(state_attribute) = find_jsx_attribute(opening_element, "aria-state") {
            if element_name != "Box" {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Ink `<{element_name}>` does not support `aria-state`; put semantics on a `<Box>`."
                    ))
                    .with_label(state_attribute.span),
                );
            } else if let Some((state_name, state_span)) = invalid_ink_aria_state(state_attribute) {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Ink does not expose the ARIA state `{state_name}` to screen readers."
                    ))
                    .with_label(state_span),
                );
            }
        }
        let Some(label_attribute) = find_jsx_attribute(opening_element, "aria-label") else {
            return;
        };
        let Some(hidden_attribute) = find_jsx_attribute(opening_element, "aria-hidden") else {
            return;
        };
        if is_statically_hidden_ink_attribute(hidden_attribute) {
            ctx.diagnostic(
                OxcDiagnostic::warn(
                    "`aria-label` has no effect when the Ink element is `aria-hidden`.",
                )
                .with_label(label_attribute.span),
            );
        }
    }
}

fn invalid_ink_aria_state(
    attribute: &oxc_ast::ast::JSXAttribute<'_>,
) -> Option<(String, oxc_span::Span)> {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return None;
    };
    let oxc_ast::ast::JSXExpression::ObjectExpression(object_expression) = &container.expression
    else {
        return None;
    };
    object_expression.properties.iter().find_map(|property| {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        let state_name = property.key.static_name()?.to_string();
        (!INK_ARIA_STATE_NAMES.contains(&state_name.as_str()))
            .then_some((state_name, property.span))
    })
}

fn is_statically_hidden_ink_attribute(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> bool {
    match &attribute.value {
        None => true,
        Some(JSXAttributeValue::ExpressionContainer(container)) => matches!(
            &container.expression,
            oxc_ast::ast::JSXExpression::BooleanLiteral(boolean_literal) if boolean_literal.value
        ),
        _ => false,
    }
}
