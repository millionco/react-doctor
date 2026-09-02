use oxc_ast::{
    ast::{ArrayExpressionElement, Expression, JSXAttributeName, JSXAttributeValue},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

#[derive(Debug, Default, Clone)]
pub struct RnNoSingleElementStyleArray;

declare_oxc_lint!(
    /// Disallow React Native style arrays that wrap one value.
    RnNoSingleElementStyleArray,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow React Native style arrays that wrap one value.",
);

impl Rule for RnNoSingleElementStyleArray {
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
        if attribute_name.name != "style" && !attribute_name.name.ends_with("Style") {
            return;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return;
        };
        let Some(Expression::ArrayExpression(array_expression)) =
            container.expression.as_expression()
        else {
            return;
        };
        if array_expression.elements.len() != 1
            || matches!(
                array_expression.elements[0],
                ArrayExpressionElement::SpreadElement(_) | ArrayExpressionElement::Elision(_)
            )
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users pay for an extra array allocation when \"{}\" wraps a single value for nothing.",
                attribute_name.name
            ))
            .with_label(array_expression.span),
        );
    }
}
