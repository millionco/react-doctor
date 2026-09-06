use oxc_ast::{
    AstKind,
    ast::{JSXAttributeName, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::{get_jsx_element_name, is_react_component_name},
};

use super::simple_glob_matches::simple_glob_matches;

const DEFAULT_FORBID_PROPS: [&str; 2] = ["className", "style"];

#[derive(Debug, Default, Clone)]
pub struct ForbidComponentProps;

struct ForbidEntry {
    prop_pattern: String,
    exact_prop_name: Option<String>,
    allowed_for: Vec<String>,
    allowed_for_patterns: Vec<String>,
    disallowed_for: Vec<String>,
    disallowed_for_patterns: Vec<String>,
    message: Option<String>,
}

declare_oxc_lint!(
    /// Disallow configured props on user-defined JSX components.
    ForbidComponentProps,
    react_doctor_native,
    restriction,
    version = "0.1.0",
    short_description = "Disallow configured props on components.",
);

impl Rule for ForbidComponentProps {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        let entries = resolve_forbid_component_props_settings(ctx);
        if entries.is_empty() {
            return;
        }
        for node in ctx.nodes().iter() {
            check_forbidden_component_props(node, &entries, ctx);
        }
    }
}

fn check_forbidden_component_props<'a>(
    node: &AstNode<'a>,
    entries: &[ForbidEntry],
    ctx: &LintContext<'a>,
) {
    let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
        return;
    };
    if !is_supported_forbid_component_name(&opening_element.name) {
        return;
    }
    let tag_name = get_jsx_element_name(&opening_element.name);
    let root_name = tag_name.split('.').next().unwrap_or_default();
    if !is_react_component_name(root_name) && !tag_name.contains('.') {
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
        let Some(entry) = entries.iter().find(|entry| {
            entry
                .exact_prop_name
                .as_deref()
                .is_none_or(|exact_name| exact_name == prop_name)
                && simple_glob_matches(&entry.prop_pattern, prop_name)
                && forbid_component_prop_is_forbidden_for_tag(entry, &tag_name)
        }) else {
            continue;
        };
        let message = match &entry.message {
            Some(message) => message.clone(),
            None => format!(
                "Your project blocks the `{prop_name}` prop on this component, so this bypasses the component API contract."
            ),
        };
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(attribute.span()));
    }
}

fn resolve_forbid_component_props_settings(ctx: &LintContext<'_>) -> Vec<ForbidEntry> {
    let configured_forbid = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("forbidComponentProps"))
        .and_then(|settings| settings.get("forbid"))
        .and_then(serde_json::Value::as_array);
    if let Some(configured_forbid) = configured_forbid {
        return configured_forbid
            .iter()
            .filter_map(normalize_forbid_component_prop_entry)
            .collect();
    }
    if should_use_curated_port_behavior(ctx) {
        return Vec::new();
    }
    DEFAULT_FORBID_PROPS
        .into_iter()
        .map(exact_forbid_component_prop_entry)
        .collect()
}

fn normalize_forbid_component_prop_entry(value: &serde_json::Value) -> Option<ForbidEntry> {
    if let Some(prop_name) = value.as_str() {
        return Some(exact_forbid_component_prop_entry(prop_name));
    }
    let object = value.as_object()?;
    let prop_name = object.get("propName").and_then(serde_json::Value::as_str);
    let prop_name_pattern = object
        .get("propNamePattern")
        .and_then(serde_json::Value::as_str);
    Some(ForbidEntry {
        prop_pattern: prop_name_pattern
            .or(prop_name)
            .unwrap_or_default()
            .to_string(),
        exact_prop_name: if prop_name_pattern.is_none() {
            prop_name.map(str::to_string)
        } else {
            None
        },
        allowed_for: forbid_component_prop_string_array(object, "allowedFor"),
        allowed_for_patterns: forbid_component_prop_string_array(object, "allowedForPatterns"),
        disallowed_for: forbid_component_prop_string_array(object, "disallowedFor"),
        disallowed_for_patterns: forbid_component_prop_string_array(
            object,
            "disallowedForPatterns",
        ),
        message: object
            .get("message")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    })
}

fn exact_forbid_component_prop_entry(prop_name: &str) -> ForbidEntry {
    ForbidEntry {
        prop_pattern: prop_name.to_string(),
        exact_prop_name: Some(prop_name.to_string()),
        allowed_for: Vec::new(),
        allowed_for_patterns: Vec::new(),
        disallowed_for: Vec::new(),
        disallowed_for_patterns: Vec::new(),
        message: None,
    }
}

fn forbid_component_prop_string_array(
    object: &serde_json::Map<String, serde_json::Value>,
    name: &str,
) -> Vec<String> {
    object
        .get(name)
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(str::to_string)
        .collect()
}

fn forbid_component_prop_is_forbidden_for_tag(entry: &ForbidEntry, tag_name: &str) -> bool {
    if !entry.disallowed_for.is_empty() || !entry.disallowed_for_patterns.is_empty() {
        return entry.disallowed_for.iter().any(|name| name == tag_name)
            || entry
                .disallowed_for_patterns
                .iter()
                .any(|pattern| simple_glob_matches(pattern, tag_name));
    }
    if entry.allowed_for.is_empty() && entry.allowed_for_patterns.is_empty() {
        return true;
    }
    !entry.allowed_for.iter().any(|name| name == tag_name)
        && !entry
            .allowed_for_patterns
            .iter()
            .any(|pattern| simple_glob_matches(pattern, tag_name))
}

fn is_supported_forbid_component_name(name: &JSXElementName<'_>) -> bool {
    matches!(
        name,
        JSXElementName::Identifier(_)
            | JSXElementName::IdentifierReference(_)
            | JSXElementName::MemberExpression(_)
    )
}
