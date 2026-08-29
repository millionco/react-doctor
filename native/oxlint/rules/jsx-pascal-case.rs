use oxc_ast::{
    AstKind,
    ast::{JSXElementName, JSXMemberExpression, JSXMemberExpressionObject},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct JsxPascalCase;

#[derive(Default)]
struct JsxPascalCaseOptions {
    allow_all_caps: bool,
    allow_namespace: bool,
    allow_leading_underscore: bool,
    ignore: Vec<String>,
}

declare_oxc_lint!(
    /// Enforce PascalCase for user-defined JSX component names.
    JsxPascalCase,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Enforce PascalCase for JSX component names.",
);

impl Rule for JsxPascalCase {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let options = jsx_pascal_case_options(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let Some((full_name, separator)) = jsx_pascal_case_full_name(&opening_element.name)
            else {
                continue;
            };
            if full_name
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_lowercase)
            {
                continue;
            }
            for segment in full_name.split(separator) {
                if segment.encode_utf16().count() <= 1
                    || options
                        .ignore
                        .iter()
                        .any(|pattern| jsx_pascal_case_pattern_matches(pattern, segment))
                {
                    continue;
                }
                let checked_name = if options.allow_leading_underscore {
                    segment.strip_prefix('_').unwrap_or(segment)
                } else {
                    segment
                };
                if !jsx_pascal_case_is_pascal(checked_name)
                    && !(options.allow_all_caps && jsx_pascal_case_is_all_caps(checked_name))
                {
                    let message = if options.allow_all_caps {
                        format!(
                            "React can mistake `{segment}` for an HTML tag unless it's PascalCase or SCREAMING_SNAKE_CASE."
                        )
                    } else {
                        format!(
                            "React can mistake `{segment}` for an HTML tag unless it's PascalCase."
                        )
                    };
                    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.span));
                    break;
                }
                if options.allow_namespace {
                    break;
                }
            }
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }
}

fn jsx_pascal_case_options(ctx: &LintContext<'_>) -> JsxPascalCaseOptions {
    let settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"));
    let rule_settings = settings.and_then(|settings| settings.get("jsxPascalCase"));
    JsxPascalCaseOptions {
        allow_all_caps: rule_settings
            .and_then(|settings| settings.get("allowAllCaps"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        allow_namespace: rule_settings
            .and_then(|settings| settings.get("allowNamespace"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        allow_leading_underscore: rule_settings
            .and_then(|settings| settings.get("allowLeadingUnderscore"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or_else(|| should_use_curated_port_behavior(ctx)),
        ignore: rule_settings
            .and_then(|settings| settings.get("ignore"))
            .and_then(serde_json::Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn jsx_pascal_case_full_name(name: &JSXElementName<'_>) -> Option<(String, char)> {
    match name {
        JSXElementName::Identifier(identifier) => Some((identifier.name.to_string(), '.')),
        JSXElementName::IdentifierReference(identifier) => Some((identifier.name.to_string(), '.')),
        JSXElementName::NamespacedName(name) => {
            Some((format!("{}:{}", name.namespace.name, name.name.name), ':'))
        }
        JSXElementName::MemberExpression(member) => {
            Some((jsx_pascal_case_flatten_member(member), '.'))
        }
        _ => None,
    }
}

fn jsx_pascal_case_flatten_member(member: &JSXMemberExpression<'_>) -> String {
    let object = match &member.object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => identifier.name.to_string(),
        JSXMemberExpressionObject::MemberExpression(parent) => {
            jsx_pascal_case_flatten_member(parent)
        }
        JSXMemberExpressionObject::ThisExpression(_) => "this".to_string(),
    };
    format!("{object}.{}", member.property.name)
}

fn jsx_pascal_case_is_pascal(name: &str) -> bool {
    if name.chars().any(|character| character.len_utf16() > 1) {
        return false;
    }
    let mut characters = name.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    if !first.is_uppercase() {
        return false;
    }
    let mut has_lower_or_digit = false;
    for character in characters {
        if !character.is_alphanumeric() {
            return false;
        }
        has_lower_or_digit |= character.is_lowercase() || character.is_ascii_digit();
    }
    has_lower_or_digit
}

fn jsx_pascal_case_is_all_caps(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    bytes.iter().enumerate().all(|(index, byte)| {
        let edge = index == 0 || index + 1 == bytes.len();
        byte.is_ascii_uppercase() || byte.is_ascii_digit() || (!edge && *byte == b'_')
    })
}

fn jsx_pascal_case_pattern_matches(pattern: &str, value: &str) -> bool {
    if !pattern.contains('*') {
        return pattern == value;
    }
    let pattern: Vec<u16> = pattern.encode_utf16().collect();
    let value: Vec<u16> = value.encode_utf16().collect();
    let mut pattern_index = 0;
    let mut value_index = 0;
    let mut star = None;
    let mut star_value_index = 0;
    while value_index < value.len() {
        if pattern.get(pattern_index) == Some(&(b'[' as u16)) {
            if let Some(relative_end) = pattern[pattern_index + 1..]
                .iter()
                .position(|character| *character == b']' as u16)
            {
                let end = pattern_index + relative_end + 1;
                if jsx_pascal_case_character_class_matches(
                    &pattern[pattern_index + 1..end],
                    value[value_index],
                ) {
                    pattern_index = end + 1;
                    value_index += 1;
                    continue;
                }
            } else if pattern.get(pattern_index) == value.get(value_index) {
                pattern_index += 1;
                value_index += 1;
                continue;
            }
        } else if pattern.get(pattern_index) == Some(&(b'?' as u16))
            || pattern.get(pattern_index) == value.get(value_index)
        {
            pattern_index += 1;
            value_index += 1;
            continue;
        } else if pattern.get(pattern_index) == Some(&(b'*' as u16)) {
            star = Some(pattern_index);
            pattern_index += 1;
            star_value_index = value_index;
            continue;
        }
        let Some(star_index) = star else {
            return false;
        };
        pattern_index = star_index + 1;
        star_value_index += 1;
        value_index = star_value_index;
    }
    while pattern.get(pattern_index) == Some(&(b'*' as u16)) {
        pattern_index += 1;
    }
    pattern_index == pattern.len()
}

fn jsx_pascal_case_character_class_matches(class: &[u16], value: u16) -> bool {
    let mut class_index = 0;
    let is_negated = class.first() == Some(&(b'^' as u16));
    if is_negated {
        class_index += 1;
    }
    let mut did_match = false;
    while class_index < class.len() {
        if class[class_index] == b',' as u16 {
            class_index += 1;
            continue;
        }
        let start = class[class_index];
        if class.get(class_index + 1) == Some(&(b'-' as u16))
            && let Some(end) = class.get(class_index + 2)
        {
            did_match |= start <= value && value <= *end;
            class_index += 3;
        } else {
            did_match |= start == value;
            class_index += 1;
        }
    }
    did_match != is_negated
}
