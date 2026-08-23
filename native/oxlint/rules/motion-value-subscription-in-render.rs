use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MOTION_VALUE_HOOKS: [&str; 6] = [
    "useMotionTemplate",
    "useMotionValue",
    "useSpring",
    "useTime",
    "useTransform",
    "useVelocity",
];
const MESSAGE: &str = "This Motion value subscription is added during render, so re-renders can accumulate listeners. Use useMotionValueEvent() or subscribe inside an effect with cleanup.";

#[derive(Debug, Default, Clone)]
pub struct MotionValueSubscriptionInRender;

declare_oxc_lint!(
    /// Disallow Motion value subscriptions during render.
    MotionValueSubscriptionInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow Motion value subscriptions during render.",
);

impl Rule for MotionValueSubscriptionInRender {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(member_expression) = call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()
        else {
            return;
        };
        if member_expression.static_property_name() == Some("on")
            && is_motion_hook_result_expression(
                member_expression.object(),
                &MOTION_VALUE_HOOKS,
                ctx,
            )
            && is_render_phase_component_or_hook(node, ctx)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
        }
    }
}
