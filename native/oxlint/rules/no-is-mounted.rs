use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule, utils::get_parent_component};

const MESSAGE: &str =
    "`isMounted` is unreliable in modern React, so async callbacks can update state after unmount.";

#[derive(Debug, Default, Clone)]
pub struct NoIsMounted;

declare_oxc_lint!(
    /// Disallow `this.isMounted()` inside React components.
    NoIsMounted,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow this.isMounted calls inside React components.",
);

impl Rule for NoIsMounted {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Expression::StaticMemberExpression(member_expression) =
            call_expression.callee.get_inner_expression()
        else {
            return;
        };
        if member_expression.property.name != "isMounted"
            || !matches!(
                member_expression.object.get_inner_expression(),
                Expression::ThisExpression(_)
            )
            || get_parent_component(node, ctx).is_none()
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span()));
    }
}
