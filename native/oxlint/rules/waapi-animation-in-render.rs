use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This Web Animation starts during render, so React retries and re-renders can replay it. Move element.animate() to an effect or interaction handler.";

#[derive(Debug, Default, Clone)]
pub struct WaapiAnimationInRender;

declare_oxc_lint!(
    /// Disallow starting Web Animations during render.
    WaapiAnimationInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow starting Web Animations during render.",
);

impl Rule for WaapiAnimationInRender {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(member_expression) = call_expression.callee.as_member_expression() else {
            return;
        };
        if member_expression.static_property_name() == Some("animate")
            && is_proven_dom_event_target(member_expression.object(), ctx, &mut Vec::new())
            && is_render_phase_component_or_hook(node, ctx)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
        }
    }
}
