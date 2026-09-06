use oxc_ast::{
    ast::{Expression, JSXAttributeName, JSXAttributeValue},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const GENERIC_EVENT_SUFFIXES: [&str; 5] = ["Click", "Change", "Input", "Blur", "Focus"];

#[derive(Debug, Default, Clone)]
pub struct NoGenericHandlerNames;

declare_oxc_lint!(
    /// Disallow handler names that only repeat the event name.
    NoGenericHandlerNames,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow generic JSX handler names.",
);

impl Rule for NoGenericHandlerNames {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            return;
        };
        let Some(event_suffix) = attribute_name.name.strip_prefix("on") else {
            return;
        };
        if !GENERIC_EVENT_SUFFIXES.contains(&event_suffix) {
            return;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return;
        };
        let Some(Expression::Identifier(handler)) = container.expression.as_expression() else {
            return;
        };
        let expected_handler_name = format!("handle{event_suffix}");
        if handler.name != expected_handler_name.as_str() {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "The handler name \"{}\" says when it runs, not what it does, so name it after the action instead.",
                handler.name
            ))
            .with_label(attribute.span),
        );
    }
}
