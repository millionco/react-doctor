use oxc_ast::{AstKind, ast::ArrayExpressionElement};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct MotionUseTransformRangeLength;

declare_oxc_lint!(
    /// Require equal static input and output ranges for Motion transforms.
    MotionUseTransformRangeLength,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require equal static input and output ranges for Motion transforms.",
);

impl Rule for MotionUseTransformRangeLength {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !motion_react_api_path_matches(&call_expression.callee, &["useTransform"], ctx) {
            return;
        }
        let Some(input_length) = static_array_argument_length(call_expression.arguments.get(1))
        else {
            return;
        };
        let Some(output_length) = static_array_argument_length(call_expression.arguments.get(2))
        else {
            return;
        };
        if input_length == output_length {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "useTransform receives {input_length} input stops but {output_length} output values. These ranges must have equal lengths."
            ))
            .with_label(call_expression.span),
        );
    }
}

fn static_array_argument_length(argument: Option<&oxc_ast::ast::Argument<'_>>) -> Option<usize> {
    let oxc_ast::ast::Argument::ArrayExpression(array_expression) = argument? else {
        return None;
    };
    array_expression
        .elements
        .iter()
        .all(|element| {
            !matches!(
                element,
                ArrayExpressionElement::SpreadElement(_) | ArrayExpressionElement::Elision(_)
            )
        })
        .then_some(array_expression.elements.len())
}
