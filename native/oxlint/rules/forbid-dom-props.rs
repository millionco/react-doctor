use std::collections::{HashMap, HashSet};

use oxc_ast::{
    AstKind,
    ast::{JSXAttribute, JSXAttributeName, JSXAttributeValue, JSXElementName, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::is_react_component_name,
};

#[derive(Debug, Default, Clone)]
pub struct ForbidDomProps;

struct ForbiddenDomProp {
    disallowed_for: HashSet<String>,
    disallowed_values: Option<HashSet<String>>,
    message: Option<String>,
}

declare_oxc_lint!(
    /// Disallow configured props on plain DOM elements.
    ForbidDomProps,
    react_doctor_native,
    restriction,
    version = "0.1.0",
    short_description = "Disallow configured props on DOM elements.",
);

impl Rule for ForbidDomProps {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        let forbidden_props = resolve_forbid_dom_props_settings(ctx);
        if forbidden_props.is_empty() {
            return;
        }
        for node in ctx.nodes().iter() {
            check_forbidden_dom_props(node, &forbidden_props, ctx);
        }
    }
}

fn check_forbidden_dom_props<'a>(
    node: &AstNode<'a>,
    forbidden_props: &HashMap<String, ForbiddenDomProp>,
    ctx: &LintContext<'a>,
) {
    let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
        return;
    };
    if !matches!(
        opening_element.name,
        JSXElementName::Identifier(_) | JSXElementName::IdentifierReference(_)
    ) {
        return;
    }
    let Some((element_name, _)) = resolve_jsx_element_type(opening_element, ctx) else {
        return;
    };
    if is_react_component_name(element_name) {
        return;
    }

    for attribute in &opening_element.attributes {
        let Some(attribute) = attribute.as_attribute() else {
            continue;
        };
        let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            continue;
        };
        let prop_name = attribute_name.name.as_str();
        let Some(descriptor) = forbidden_props.get(prop_name) else {
            continue;
        };
        if !descriptor.disallowed_for.is_empty()
            && !descriptor.disallowed_for.contains(element_name)
        {
            continue;
        }
        if let Some(disallowed_values) = &descriptor.disallowed_values {
            if disallowed_values.is_empty()
                || forbid_dom_prop_static_string_value(attribute)
                    .is_none_or(|value| !disallowed_values.contains(value))
            {
                continue;
            }
        }
        let message = match &descriptor.message {
            Some(message) => message.clone(),
            None => format!(
                "Your project blocks the `{prop_name}` prop on plain HTML tags, so this bypasses the agreed DOM API contract."
            ),
        };
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(attribute_name.span));
    }
}

fn resolve_forbid_dom_props_settings(ctx: &LintContext<'_>) -> HashMap<String, ForbiddenDomProp> {
    let Some(forbid_items) = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("forbidDomProps"))
        .and_then(|settings| settings.get("forbid"))
        .and_then(serde_json::Value::as_array)
    else {
        return HashMap::new();
    };
    let mut forbidden_props = HashMap::new();
    for item in forbid_items {
        if let Some(prop_name) = item.as_str() {
            forbidden_props.insert(prop_name.to_string(), empty_forbidden_dom_prop());
            continue;
        }
        let Some(object) = item.as_object() else {
            continue;
        };
        let Some(prop_name) = object.get("propName").and_then(serde_json::Value::as_str) else {
            continue;
        };
        forbidden_props.insert(
            prop_name.to_string(),
            ForbiddenDomProp {
                disallowed_for: forbid_dom_prop_string_set(object, "disallowedFor")
                    .unwrap_or_default(),
                disallowed_values: forbid_dom_prop_string_set(object, "disallowedValues"),
                message: object
                    .get("message")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
            },
        );
    }
    forbidden_props
}

fn empty_forbidden_dom_prop() -> ForbiddenDomProp {
    ForbiddenDomProp {
        disallowed_for: HashSet::new(),
        disallowed_values: None,
        message: None,
    }
}

fn forbid_dom_prop_string_set(
    object: &serde_json::Map<String, serde_json::Value>,
    name: &str,
) -> Option<HashSet<String>> {
    object
        .get(name)
        .and_then(serde_json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect()
        })
}

fn forbid_dom_prop_static_string_value<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(value) => Some(value.value.as_str()),
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::StringLiteral(value) => Some(value.value.as_str()),
            JSXExpression::TemplateLiteral(template) if template.expressions.is_empty() => {
                let quasi = template.quasis.first()?;
                Some(
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or("", |value| value.as_str()),
                )
            }
            _ => None,
        },
        _ => None,
    }
}
