use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::UnaryOperator;

use crate::{context::LintContext, rule::Rule, AstNode};

#[derive(Debug, Default, Clone)]
pub struct ThreeGpuComputationHandleInitError;

declare_oxc_lint!(
    /// Require callers to handle GPUComputationRenderer initialization errors.
    ThreeGpuComputationHandleInitError,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require GPU computation initialization error handling.",
);

impl Rule for ThreeGpuComputationHandleInitError {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(member_expression) = call_expression.callee.as_member_expression() else {
            return;
        };
        if member_expression.static_property_name() != Some("init")
            || three_constructor_api_name(member_expression.object(), ctx).as_deref()
                != Some("GPUComputationRenderer")
        {
            return;
        }
        let expression_root = transparent_expression_root(node, ctx);
        let parent = ctx.nodes().parent_node(expression_root.id());
        let is_discarded = matches!(parent.kind(), AstKind::ExpressionStatement(_))
            || matches!(
                parent.kind(),
                AstKind::UnaryExpression(unary_expression)
                    if unary_expression.operator == UnaryOperator::Void
            );
        if !is_discarded {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(
                "GPUComputationRenderer.init() returns null on success or an error string on failure, but this result is discarded",
            )
            .with_label(node.span()),
        );
    }
}
