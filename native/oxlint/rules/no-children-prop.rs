use oxc_ast::{
    AstKind,
    ast::{Argument, JSXAttributeName, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule, utils::is_create_element_call};

const MESSAGE: &str = "A `children` prop can override or hide nested children, so the component may render different content than the JSX shows.";

#[derive(Debug, Default, Clone)]
pub struct NoChildrenProp;

declare_oxc_lint!(
    /// Disallow passing React children through a prop.
    NoChildrenProp,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow passing React children through a prop.",
);

impl Rule for NoChildrenProp {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => {
                let JSXAttributeName::Identifier(identifier) = &attribute.name else {
                    return;
                };
                if identifier.name == "children" {
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(identifier.span));
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
                    if property.key.is_specific_static_name("children") {
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
