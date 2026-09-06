use oxc_ast::{ast::MemberExpression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "`setNativeProps` is a silent no-op under the New Architecture (Fabric), so this imperative update won't change the view. Drive the prop via state, an Animated.Value, or a Reanimated shared value.";

#[derive(Debug, Default, Clone)]
pub struct RnNoSetNativeProps;

declare_oxc_lint!(
    /// Disallow setNativeProps calls through React Native refs.
    RnNoSetNativeProps,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow setNativeProps calls through React Native refs.",
);

impl Rule for RnNoSetNativeProps {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(MemberExpression::StaticMemberExpression(callee)) =
            call_expression.callee.get_member_expr()
        else {
            return;
        };
        if callee.property.name != "setNativeProps" {
            return;
        }
        let Some(MemberExpression::StaticMemberExpression(receiver)) =
            callee.object.get_inner_expression().get_member_expr()
        else {
            return;
        };
        if receiver.property.name != "current" {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span()));
    }
}
