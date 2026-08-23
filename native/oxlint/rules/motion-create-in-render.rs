use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "motion.create() builds a new component type during this render, which resets identity and can break animation continuity. Hoist it or memoize the factory.";

#[derive(Debug, Default, Clone)]
pub struct MotionCreateInRender;

declare_oxc_lint!(
    /// Disallow creating Motion component types during render.
    MotionCreateInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow creating Motion component types during render.",
);

impl Rule for MotionCreateInRender {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if motion_react_api_path_matches(&call_expression.callee, &["motion", "create"], ctx)
            && is_render_phase_component_or_hook(node, ctx)
            && !is_inside_stable_react_initializer(node, ctx)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
        }
    }
}
