use oxc_ast::{
    ast::{JSXAttributeItem, JSXAttributeName, JSXAttributeValue},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "A `javascript:` URL is an XSS hole that runs injected input as code.";

#[derive(Debug, Default, Clone)]
pub struct JsxNoScriptUrl;

declare_oxc_lint!(
    /// Disallow javascript protocol URLs in JSX links.
    JsxNoScriptUrl,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow javascript protocol URLs in JSX links.",
);

impl Rule for JsxNoScriptUrl {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !matches!(
            &opening_element.name,
            oxc_ast::ast::JSXElementName::Identifier(_)
                | oxc_ast::ast::JSXElementName::IdentifierReference(_)
        ) {
            return;
        }
        let Some((element_name, _)) = resolve_jsx_element_type(opening_element, ctx) else {
            return;
        };
        for attribute in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                continue;
            };
            if !is_link_prop_for_element(element_name, attribute_name.name.as_str(), ctx) {
                continue;
            }
            let Some(JSXAttributeValue::StringLiteral(value)) = &attribute.value else {
                continue;
            };
            if is_javascript_url(value.value.as_str()) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
            }
        }
    }
}

fn is_link_prop_for_element(element_name: &str, attribute_name: &str, ctx: &LintContext) -> bool {
    if element_name == "a" && attribute_name == "href" {
        return true;
    }
    let Some(options) = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("jsxNoScriptUrl"))
    else {
        return false;
    };
    if configured_link_prop(options, "components", element_name, attribute_name) {
        return true;
    }
    options
        .get("includeFromSettings")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
        && configured_link_prop(options, "linkComponents", element_name, attribute_name)
}

fn configured_link_prop(
    options: &serde_json::Value,
    map_name: &str,
    element_name: &str,
    attribute_name: &str,
) -> bool {
    options
        .get(map_name)
        .and_then(|components| components.get(element_name))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|attribute_names| {
            attribute_names
                .iter()
                .any(|name| name.as_str() == Some(attribute_name))
        })
}

fn is_javascript_url(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0;
    while bytes
        .get(index)
        .is_some_and(|byte| *byte <= 0x1f || *byte == b' ')
    {
        index += 1;
    }
    for (letter_index, expected_letter) in b"javascript".iter().enumerate() {
        if bytes
            .get(index)
            .is_none_or(|byte| !byte.eq_ignore_ascii_case(expected_letter))
        {
            return false;
        }
        index += 1;
        if letter_index + 1 < b"javascript".len() {
            while bytes
                .get(index)
                .is_some_and(|byte| matches!(byte, b'\r' | b'\n' | b'\t'))
            {
                index += 1;
            }
        }
    }
    bytes.get(index) == Some(&b':')
}
