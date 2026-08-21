use oxc_ast::{
    AstKind,
    ast::{Argument, JSXAttributeItem, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule, utils::is_create_element_call};

const MESSAGE: &str = "`dangerouslySetInnerHTML` is an XSS hole that runs attacker-controlled HTML in your users' browsers.";

#[derive(Debug, Default, Clone)]
pub struct NoDanger;

declare_oxc_lint!(
    /// Disallow raw HTML injection through React props.
    NoDanger,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow raw HTML injection through React props.",
);

impl Rule for NoDanger {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXOpeningElement(opening_element) => {
                for attribute in &opening_element.attributes {
                    let JSXAttributeItem::Attribute(attribute) = attribute else {
                        continue;
                    };
                    if attribute
                        .name
                        .as_identifier()
                        .is_some_and(|identifier| identifier.name == "dangerouslySetInnerHTML")
                    {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(MESSAGE).with_label(attribute.name.span()),
                        );
                    }
                }
            }
            AstKind::CallExpression(call_expression) if is_create_element_call(call_expression) => {
                let Some(Argument::ObjectExpression(properties)) = call_expression.arguments.get(1)
                else {
                    return;
                };
                for property in &properties.properties {
                    let ObjectPropertyKind::ObjectProperty(property) = property else {
                        continue;
                    };
                    if property
                        .key
                        .is_specific_static_name("dangerouslySetInnerHTML")
                    {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(MESSAGE).with_label(property.key.span()),
                        );
                    }
                }
            }
            _ => {}
        }
    }
}
