use std::collections::HashMap;

use oxc_ast::{
    ast::{CallExpression, Expression, JSXElementName, JSXOpeningElement, StaticMemberExpression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, utils::get_jsx_element_name};

#[derive(Debug, Default, Clone)]
pub struct ForbidElements;

struct ForbiddenElement {
    message: Option<String>,
}

declare_oxc_lint!(
    /// Disallow configured JSX and React.createElement element types.
    ForbidElements,
    react_doctor_native,
    restriction,
    version = "0.1.0",
    short_description = "Disallow configured React element types.",
);

impl Rule for ForbidElements {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let forbidden_elements = resolve_forbid_elements_settings(ctx);
        if forbidden_elements.is_empty() {
            return;
        }
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::JSXOpeningElement(opening_element) => {
                    check_forbidden_jsx_element(opening_element, &forbidden_elements, ctx);
                }
                AstKind::CallExpression(call_expression) => {
                    check_forbidden_create_element_call(call_expression, &forbidden_elements, ctx);
                }
                _ => {}
            }
        }
    }
}

fn check_forbidden_jsx_element<'a>(
    opening_element: &JSXOpeningElement<'a>,
    forbidden_elements: &HashMap<String, ForbiddenElement>,
    ctx: &LintContext<'a>,
) {
    let element_name = forbid_elements_jsx_name(opening_element, ctx);
    let Some(forbidden_element) = forbidden_elements.get(&element_name) else {
        return;
    };
    report_forbidden_element(
        &element_name,
        forbidden_element,
        opening_element.name.span(),
        ctx,
    );
}

fn check_forbidden_create_element_call<'a>(
    call_expression: &CallExpression<'a>,
    forbidden_elements: &HashMap<String, ForbiddenElement>,
    ctx: &LintContext<'a>,
) {
    if !is_forbid_elements_create_element_call(call_expression) {
        return;
    }
    let Some(first_argument) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return;
    };
    let Some(element_name) = forbid_elements_create_element_name(first_argument) else {
        return;
    };
    let Some(forbidden_element) = forbidden_elements.get(&element_name) else {
        return;
    };
    report_forbidden_element(&element_name, forbidden_element, first_argument.span(), ctx);
}

fn report_forbidden_element(
    element_name: &str,
    forbidden_element: &ForbiddenElement,
    span: oxc_span::Span,
    ctx: &LintContext<'_>,
) {
    let message = match &forbidden_element.message {
        Some(custom_help) if !custom_help.is_empty() => {
            format!("Your project blocks `<{element_name}>` here. {custom_help}")
        }
        _ => format!(
            "Your project blocks `<{element_name}>` here, so code stays on the approved UI surface."
        ),
    };
    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(span));
}

fn resolve_forbid_elements_settings(ctx: &LintContext<'_>) -> HashMap<String, ForbiddenElement> {
    let Some(forbid_items) = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("forbidElements"))
        .and_then(|settings| settings.get("forbid"))
        .and_then(serde_json::Value::as_array)
    else {
        return HashMap::new();
    };
    let mut forbidden_elements = HashMap::new();
    for item in forbid_items {
        if let Some(element_name) = item.as_str() {
            forbidden_elements.insert(element_name.to_string(), ForbiddenElement { message: None });
            continue;
        }
        let Some(object) = item.as_object() else {
            continue;
        };
        let Some(element_name) = object.get("element").and_then(serde_json::Value::as_str) else {
            continue;
        };
        forbidden_elements.insert(
            element_name.to_string(),
            ForbiddenElement {
                message: object
                    .get("message")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
            },
        );
    }
    forbidden_elements
}

fn forbid_elements_jsx_name<'a>(
    opening_element: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> String {
    match &opening_element.name {
        JSXElementName::Identifier(identifier) => resolve_jsx_element_type(opening_element, ctx)
            .map_or_else(
                || identifier.name.to_string(),
                |(element_name, _)| element_name.to_string(),
            ),
        JSXElementName::IdentifierReference(identifier) => {
            resolve_jsx_element_type(opening_element, ctx).map_or_else(
                || identifier.name.to_string(),
                |(element_name, _)| element_name.to_string(),
            )
        }
        _ => get_jsx_element_name(&opening_element.name).to_string(),
    }
}

fn is_forbid_elements_create_element_call(call_expression: &CallExpression<'_>) -> bool {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name == "createElement",
        Expression::StaticMemberExpression(member_expression) => {
            member_expression.property.name == "createElement"
                && matches!(
                    member_expression.object.get_inner_expression(),
                    Expression::Identifier(identifier) if identifier.name == "React"
                )
        }
        _ => false,
    }
}

fn forbid_elements_create_element_name(expression: &Expression<'_>) -> Option<String> {
    match expression {
        Expression::StringLiteral(literal) => {
            let value = literal.value.as_str();
            if value.as_bytes().first().is_some_and(u8::is_ascii_lowercase) && !value.contains('.')
            {
                Some(value.to_string())
            } else {
                None
            }
        }
        Expression::Identifier(identifier) => identifier
            .name
            .as_bytes()
            .first()
            .is_some_and(|first_byte| first_byte.is_ascii_uppercase() || *first_byte == b'_')
            .then(|| identifier.name.to_string()),
        Expression::StaticMemberExpression(member_expression) => {
            flatten_forbid_elements_member_name(member_expression)
        }
        _ => None,
    }
}

fn flatten_forbid_elements_member_name(
    member_expression: &StaticMemberExpression<'_>,
) -> Option<String> {
    let object_name = match member_expression.object.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name.to_string(),
        Expression::StaticMemberExpression(object) => flatten_forbid_elements_member_name(object)?,
        _ => return None,
    };
    Some(format!(
        "{object_name}.{}",
        member_expression.property.name.as_str()
    ))
}
