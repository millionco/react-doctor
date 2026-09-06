use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const EFFECT_COMPOSER_MODULE_SOURCES: [&str; 4] = [
    "three/addons",
    "three/addons/postprocessing/EffectComposer.js",
    "three/examples/jsm/postprocessing/EffectComposer",
    "three/examples/jsm/postprocessing/EffectComposer.js",
];
const WEBGPU_RENDERER_MODULE_SOURCES: [&str; 2] = ["three", "three/webgpu"];
const MESSAGE: &str = "Legacy EffectComposer does not support Three.js WebGPURenderer. Build post-processing with the renderer's node-based pipeline";

#[derive(Debug, Default, Clone)]
pub struct ThreeWebgpuNoLegacyEffectComposer;

declare_oxc_lint!(
    /// Disallow legacy EffectComposer with WebGPURenderer.
    ThreeWebgpuNoLegacyEffectComposer,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow legacy EffectComposer with WebGPURenderer.",
);

impl Rule for ThreeWebgpuNoLegacyEffectComposer {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::NewExpression(new_expression) = node.kind() else {
            return;
        };
        if !module_api_path_matches(
            &new_expression.callee,
            &["EffectComposer"],
            &EFFECT_COMPOSER_MODULE_SOURCES,
            false,
            ctx,
        ) || !ctx.nodes().iter().any(|candidate| {
            matches!(
                candidate.kind(),
                AstKind::NewExpression(renderer)
                    if module_api_path_matches(
                        &renderer.callee,
                        &["WebGPURenderer"],
                        &WEBGPU_RENDERER_MODULE_SOURCES,
                        false,
                        ctx,
                    )
            )
        }) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(new_expression.span));
    }
}
