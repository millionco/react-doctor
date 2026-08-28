use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

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
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut reported_callback_ids = rustc_hash::FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(callback_id) = resolve_analyzed_recursive_animation_frame_callback_id(
                call_expression,
                true,
                &node_index,
                ctx,
                &mut resolution_cache,
            ) else {
                continue;
            };
            if !reported_callback_ids.insert(callback_id) {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
        }
    }
}
