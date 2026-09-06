use oxc_ast::{
    AstKind,
    ast::{Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule, utils::get_parent_component};

const MESSAGE: &str = "`this.setState` keeps local class state in a project that forbids it, so state ownership becomes harder to reason about.";

#[derive(Debug, Default, Clone)]
pub struct NoSetState;

declare_oxc_lint!(
    /// Disallow this.setState calls inside React components.
    NoSetState,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow this.setState calls inside React components.",
);

impl Rule for NoSetState {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(member_expression) = call_expression.callee.as_member_expression() else {
            return;
        };
        let has_set_state_property = match member_expression {
            MemberExpression::StaticMemberExpression(member_expression) => {
                member_expression.property.name == "setState"
            }
            MemberExpression::ComputedMemberExpression(member_expression) => matches!(
                &member_expression.expression,
                Expression::Identifier(identifier) if identifier.name == "setState"
            ),
            MemberExpression::PrivateFieldExpression(_) => false,
        };
        if !has_set_state_property
            || !matches!(
                member_expression.object().get_inner_expression(),
                Expression::ThisExpression(_)
            )
            || get_parent_component(node, ctx).is_none()
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(member_expression.span()));
    }
}
