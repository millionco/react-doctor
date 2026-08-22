use oxc_ast::{
    AstKind,
    ast::Argument,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str =
    "The parent can't reach this component's node because the `forwardRef` wrapper ignores `ref`.";

#[derive(Debug, Default, Clone)]
pub struct ForwardRefUsesRef;

declare_oxc_lint!(
    /// Require forwardRef callbacks to accept a ref parameter.
    ForwardRefUsesRef,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require forwardRef callbacks to accept a ref parameter.",
);

impl Rule for ForwardRefUsesRef {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !is_react_api_call(call_expression, "forwardRef", ctx) {
            return;
        }
        let Some(first_argument) = call_expression.arguments.first() else {
            return;
        };
        let (parameter_count, has_rest, span) = match first_argument {
            Argument::ArrowFunctionExpression(function) => (
                function.params.parameters_count(),
                function.params.rest.is_some(),
                function.span,
            ),
            Argument::FunctionExpression(function) => (
                function.params.parameters_count(),
                function.params.rest.is_some(),
                function.span,
            ),
            _ => return,
        };
        if parameter_count == 1 && !has_rest {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(span));
        }
    }
}
