use oxc_ast::{
    AstKind,
    ast::{
        ArrowFunctionExpression, ComputedMemberExpression, Expression, JSXAttributeValue,
        JSXExpression, Statement, StaticMemberExpression,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::get_jsx_attribute_name,
};

use super::simple_glob_matches::simple_glob_matches;

const DEFAULT_HANDLER_PREFIX: &str = "handle";
const DEFAULT_HANDLER_PROP_PREFIX: &str = "on";

#[derive(Debug, Default, Clone)]
pub struct JsxHandlerNames;

struct JsxHandlerNamesSettings {
    check_inline_function: bool,
    check_local_variables: bool,
    handler_prefix: String,
    handler_prop_prefix: String,
    handler_prefixes: Vec<String>,
    handler_prop_prefixes: Vec<String>,
    ignore_component_names: Vec<String>,
}

declare_oxc_lint!(
    /// Enforce consistent event-handler prop and function names.
    JsxHandlerNames,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Enforce consistent event-handler names.",
);

impl Rule for JsxHandlerNames {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let settings = resolve_jsx_handler_names_settings(ctx);
        for node in ctx.nodes().iter() {
            check_jsx_handler_name(node, &settings, ctx);
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }
}

fn check_jsx_handler_name<'a>(
    node: &AstNode<'a>,
    settings: &JsxHandlerNamesSettings,
    ctx: &LintContext<'a>,
) {
    let AstKind::JSXAttribute(attribute) = node.kind() else {
        return;
    };
    if !settings.ignore_component_names.is_empty() {
        let AstKind::JSXOpeningElement(opening_element) = ctx.nodes().parent_node(node.id()).kind()
        else {
            return;
        };
        let Some(component_name) = opening_element.name.get_identifier_name() else {
            return;
        };
        if settings
            .ignore_component_names
            .iter()
            .any(|pattern| simple_glob_matches(pattern, component_name.as_str()))
        {
            return;
        }
    }

    let prop_name = get_jsx_attribute_name(&attribute.name);
    if prop_name == "ref" {
        return;
    }
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return;
    };
    let Some((handler_name, is_props_handler)) =
        resolve_handler_name(&container.expression, settings)
    else {
        return;
    };
    let prop_is_event_handler = handler_prop_name_matches(&prop_name, settings);
    let handler_name_is_correct = handler_name.as_ref().map_or(Some(false), |handler_name| {
        if is_props_handler && handler_prop_name_matches(handler_name, settings) == Some(true) {
            return Some(true);
        }
        handler_name_matches(handler_name, settings)
    });

    match (prop_is_event_handler, handler_name_is_correct) {
        (Some(true), Some(false)) => {
            let handler_name = handler_name.as_deref().unwrap_or_default();
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "The handler \"{handler_name}\" does not match the \"{prop_name}\" event prop convention, so readers cannot trace event flow quickly."
                ))
                .with_label(attribute.span),
            );
        }
        (Some(false), Some(true)) => {
            let handler_name = handler_name.as_deref().unwrap_or_default();
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "The prop \"{prop_name}\" passes handler \"{handler_name}\" but is not named like an event prop, so callers cannot tell it fires an event."
                ))
                .with_label(attribute.span),
            );
        }
        _ => {}
    }
}

fn resolve_handler_name(
    expression: &JSXExpression<'_>,
    settings: &JsxHandlerNamesSettings,
) -> Option<(Option<String>, bool)> {
    match expression {
        JSXExpression::EmptyExpression(_) => None,
        JSXExpression::StaticMemberExpression(member_expression) => {
            let (handler_name, is_props_handler) =
                handler_name_from_static_member_expression(member_expression);
            Some((Some(handler_name.to_string()), is_props_handler))
        }
        JSXExpression::ComputedMemberExpression(member_expression) => Some(
            match handler_name_from_computed_member_expression(member_expression) {
                Some((handler_name, is_props_handler)) => {
                    (Some(handler_name.to_string()), is_props_handler)
                }
                None => (None, false),
            },
        ),
        expression if expression.is_member_expression() => Some((None, false)),
        JSXExpression::Identifier(identifier) => settings
            .check_local_variables
            .then(|| (Some(identifier.name.to_string()), false)),
        JSXExpression::ArrowFunctionExpression(arrow_function) => {
            if !settings.check_inline_function
                || (!settings.check_local_variables && !is_member_expression_callee(arrow_function))
            {
                return None;
            }
            let handler = handler_name_from_arrow_function(arrow_function);
            Some(match handler {
                Some((handler_name, is_props_handler)) => {
                    (Some(handler_name.to_string()), is_props_handler)
                }
                None => (None, false),
            })
        }
        _ if settings.check_local_variables => Some((Some(String::new()), false)),
        _ => None,
    }
}

fn handler_name_from_static_member_expression<'a>(
    member_expression: &'a StaticMemberExpression<'a>,
) -> (&'a str, bool) {
    (
        member_expression.property.name.as_str(),
        is_props_handler_object(&member_expression.object),
    )
}

fn handler_name_from_computed_member_expression<'a>(
    member_expression: &'a ComputedMemberExpression<'a>,
) -> Option<(&'a str, bool)> {
    let Expression::Identifier(identifier) = &member_expression.expression else {
        return None;
    };
    Some((
        identifier.name.as_str(),
        is_props_handler_object(&member_expression.object),
    ))
}

fn is_props_handler_object(object: &Expression<'_>) -> bool {
    match object {
        Expression::Identifier(identifier) => identifier.name == "props",
        Expression::StaticMemberExpression(object_member_expression) => {
            matches!(
                object_member_expression.object,
                Expression::ThisExpression(_)
            ) && object_member_expression.property.name == "props"
        }
        _ => false,
    }
}

fn handler_name_from_arrow_function<'a>(
    arrow_function: &'a ArrowFunctionExpression<'a>,
) -> Option<(&'a str, bool)> {
    let Expression::CallExpression(call_expression) = arrow_function.get_expression()? else {
        return None;
    };
    match &call_expression.callee {
        Expression::Identifier(identifier) => Some((identifier.name.as_str(), false)),
        Expression::StaticMemberExpression(member_expression) => Some(
            handler_name_from_static_member_expression(member_expression),
        ),
        Expression::ComputedMemberExpression(member_expression) => {
            handler_name_from_computed_member_expression(member_expression)
        }
        _ => None,
    }
}

fn is_member_expression_callee(arrow_function: &ArrowFunctionExpression<'_>) -> bool {
    let call_expression = if let Some(Expression::CallExpression(call_expression)) =
        arrow_function.get_expression()
    {
        Some(call_expression.as_ref())
    } else {
        arrow_function
            .get_function_body()
            .and_then(|body| body.statements.first())
            .and_then(|statement| match statement {
                Statement::ExpressionStatement(statement) => match &statement.expression {
                    Expression::CallExpression(call_expression) => Some(call_expression.as_ref()),
                    _ => None,
                },
                _ => None,
            })
    };
    call_expression.is_some_and(|call_expression| call_expression.callee.is_member_expression())
}

fn handler_name_matches(name: &str, settings: &JsxHandlerNamesSettings) -> Option<bool> {
    if settings.handler_prefix.is_empty()
        || settings.handler_prop_prefix.is_empty()
        || settings.handler_prefixes.is_empty()
    {
        return None;
    }
    Some(settings.handler_prefixes.iter().any(|prefix| {
        handler_name_candidate_starts(name, prefix)
            || name
                .match_indices('.')
                .any(|(index, _)| handler_name_candidate_starts(&name[index + 1..], prefix))
    }))
}

fn handler_name_candidate_starts(candidate: &str, prefix: &str) -> bool {
    let Some(remainder) = candidate.strip_prefix(prefix) else {
        return false;
    };
    remainder
        .trim_start_matches(|character: char| character.is_ascii_digit())
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_uppercase)
}

fn handler_prop_name_matches(name: &str, settings: &JsxHandlerNamesSettings) -> Option<bool> {
    if settings.handler_prop_prefix.is_empty() || settings.handler_prop_prefixes.is_empty() {
        return None;
    }
    Some(settings.handler_prop_prefixes.iter().any(|prefix| {
        name.strip_prefix(prefix)
            .and_then(|remainder| remainder.as_bytes().first())
            .is_some_and(u8::is_ascii_uppercase)
    }))
}

fn resolve_jsx_handler_names_settings(ctx: &LintContext<'_>) -> JsxHandlerNamesSettings {
    let settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("jsxHandlerNames"))
        .and_then(serde_json::Value::as_object);
    let handler_prefix = configured_handler_prefix(
        settings.and_then(|settings| settings.get("eventHandlerPrefix")),
        DEFAULT_HANDLER_PREFIX,
    );
    let handler_prop_prefix = configured_handler_prefix(
        settings.and_then(|settings| settings.get("eventHandlerPropPrefix")),
        DEFAULT_HANDLER_PROP_PREFIX,
    );
    JsxHandlerNamesSettings {
        check_inline_function: configured_boolean(settings, "checkInlineFunction"),
        check_local_variables: configured_boolean(settings, "checkLocalVariables"),
        handler_prefixes: split_handler_prefixes(&handler_prefix),
        handler_prop_prefixes: split_handler_prefixes(&handler_prop_prefix),
        handler_prefix,
        handler_prop_prefix,
        ignore_component_names: settings
            .and_then(|settings| settings.get("ignoreComponentNames"))
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(serde_json::Value::as_str)
            .map(str::to_string)
            .collect(),
    }
}

fn configured_boolean(
    settings: Option<&serde_json::Map<String, serde_json::Value>>,
    name: &str,
) -> bool {
    settings
        .and_then(|settings| settings.get(name))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn configured_handler_prefix(value: Option<&serde_json::Value>, default_prefix: &str) -> String {
    match value {
        Some(serde_json::Value::Bool(false)) => String::new(),
        Some(serde_json::Value::String(prefix)) => prefix.clone(),
        _ => default_prefix.to_string(),
    }
}

fn split_handler_prefixes(prefixes: &str) -> Vec<String> {
    prefixes
        .split('|')
        .map(str::trim)
        .filter(|prefix| !prefix.is_empty())
        .map(str::to_string)
        .collect()
}
