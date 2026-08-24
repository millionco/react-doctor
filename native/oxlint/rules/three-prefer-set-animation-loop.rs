use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str = "This continuous Three.js animation loop is driven by requestAnimationFrame. Use renderer.setAnimationLoop(callback) for renderer-managed timing and compatibility";

#[derive(Debug, Default, Clone)]
pub struct ThreePreferSetAnimationLoop;

declare_oxc_lint!(
    /// Prefer renderer-managed Three.js animation loops.
    ThreePreferSetAnimationLoop,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prefer renderer-managed Three.js animation loops.",
);

impl Rule for ThreePreferSetAnimationLoop {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut reported_callback_spans = Vec::new();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some((_, callback_span)) =
                resolve_recursive_animation_frame_callback(call_expression, true, ctx)
            else {
                continue;
            };
            if reported_callback_spans.contains(&callback_span) {
                continue;
            }
            reported_callback_spans.push(callback_span);
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
        }
    }
}
