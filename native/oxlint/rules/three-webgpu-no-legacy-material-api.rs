use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule};

const LEGACY_SHADER_MATERIAL_NAMES: [&str; 2] = ["RawShaderMaterial", "ShaderMaterial"];

#[derive(Debug, Default, Clone)]
pub struct ThreeWebgpuNoLegacyMaterialApi;

declare_oxc_lint!(
    /// Disallow legacy shader material APIs with WebGPURenderer.
    ThreeWebgpuNoLegacyMaterialApi,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow legacy material APIs with WebGPURenderer.",
);

impl Rule for ThreeWebgpuNoLegacyMaterialApi {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let constructs_webgpu_renderer = ctx.nodes().iter().any(|node| {
            matches!(
                node.kind(),
                AstKind::NewExpression(new_expression)
                    if three_module_api_name(&new_expression.callee, ctx).as_deref()
                        == Some("WebGPURenderer")
            )
        });
        if !constructs_webgpu_renderer {
            return;
        }
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::NewExpression(new_expression) => {
                    let Some(constructor_name) = three_module_api_name(&new_expression.callee, ctx)
                    else {
                        continue;
                    };
                    if LEGACY_SHADER_MATERIAL_NAMES.contains(&constructor_name.as_str()) {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(
                                "ShaderMaterial and RawShaderMaterial are not supported by Three.js WebGPURenderer. Build this shader with a node material and TSL",
                            )
                            .with_label(node.span()),
                        );
                    }
                }
                AstKind::AssignmentExpression(assignment) => {
                    let Some(member_expression) = assignment.left.as_member_expression() else {
                        continue;
                    };
                    if member_expression.static_property_name() != Some("onBeforeCompile")
                        || three_constructor_api_name(member_expression.object(), ctx)
                            .is_none_or(|constructor_name| !constructor_name.ends_with("Material"))
                    {
                        continue;
                    }
                    ctx.diagnostic(
                        OxcDiagnostic::warn(
                            "onBeforeCompile patches WebGL shader source and is not supported by Three.js WebGPURenderer. Use a node material and TSL",
                        )
                        .with_label(node.span()),
                    );
                }
                _ => {}
            }
        }
    }
}
