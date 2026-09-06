use oxc_ast::{
    ast::{JSXAttributeItem, JSXAttributeName, JSXAttributeValue},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const BOOLEAN_ATTRIBUTE_NAMES: [&str; 19] = [
    "disabled",
    "checked",
    "readonly",
    "required",
    "selected",
    "multiple",
    "autofocus",
    "autoplay",
    "controls",
    "loop",
    "muted",
    "open",
    "reversed",
    "default",
    "novalidate",
    "formnovalidate",
    "playsinline",
    "itemscope",
    "allowfullscreen",
];

#[derive(Debug, Default, Clone)]
pub struct NoStringFalseOnBooleanAttribute;

declare_oxc_lint!(
    /// Disallow string true and false values on HTML boolean attributes.
    NoStringFalseOnBooleanAttribute,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow string values on HTML boolean attributes.",
);

impl Rule for NoStringFalseOnBooleanAttribute {
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
        if element_name
            .as_bytes()
            .first()
            .is_none_or(|character| !character.is_ascii_lowercase())
            || element_name.contains('-')
        {
            return;
        }
        for attribute in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                continue;
            };
            if !BOOLEAN_ATTRIBUTE_NAMES
                .iter()
                .any(|name| attribute_name.name.eq_ignore_ascii_case(name))
            {
                continue;
            }
            let Some(JSXAttributeValue::StringLiteral(value)) = &attribute.value else {
                continue;
            };
            if value.value != "false" && value.value != "true" {
                continue;
            }
            let message = if value.value == "false" {
                format!(
                    "`{}=\"false\"` passes the string \"false\", which React treats as truthy, so the attribute is applied even though you wrote \"false\". Use `{}={{false}}` (or omit the attribute) to keep it off.",
                    attribute_name.name, attribute_name.name
                )
            } else {
                format!(
                    "`{}=\"true\"` passes the string \"true\", but a boolean attribute takes a boolean, not the string \"true\". Use `{}` or `{}={{true}}`.",
                    attribute_name.name, attribute_name.name, attribute_name.name
                )
            };
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(attribute.span));
        }
    }
}
