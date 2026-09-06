use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::Span;
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule};

const GLSL_KEYWORD_NAMES: [&str; 54] = [
    "attribute",
    "bool",
    "break",
    "buffer",
    "case",
    "centroid",
    "coherent",
    "const",
    "continue",
    "default",
    "discard",
    "do",
    "double",
    "else",
    "flat",
    "float",
    "for",
    "highp",
    "if",
    "in",
    "inout",
    "int",
    "invariant",
    "layout",
    "lowp",
    "mat2",
    "mat3",
    "mat4",
    "mediump",
    "noperspective",
    "out",
    "patch",
    "precision",
    "readonly",
    "restrict",
    "return",
    "sample",
    "sampler2D",
    "samplerCube",
    "shared",
    "smooth",
    "struct",
    "subroutine",
    "switch",
    "uniform",
    "uint",
    "varying",
    "vec2",
    "vec3",
    "vec4",
    "void",
    "volatile",
    "while",
    "writeonly",
];
const THREE_RESERVED_SHADER_NAMES: [&str; 51] = [
    "ambientLightColor",
    "bindMatrix",
    "bindMatrixInverse",
    "boneTexture",
    "boneTextureSize",
    "cameraPosition",
    "clippingPlanes",
    "directionalLights",
    "directionalLightShadows",
    "directionalShadowMap",
    "directionalShadowMatrix",
    "fogColor",
    "fogDensity",
    "fogFar",
    "fogNear",
    "hemisphereLights",
    "isOrthographic",
    "lightProbe",
    "logDepthBufFC",
    "ltc_1",
    "ltc_2",
    "modelMatrix",
    "modelViewMatrix",
    "morphTargetBaseInfluence",
    "morphTargetInfluences",
    "morphTargetsTexture",
    "morphTargetsTextureSize",
    "normal",
    "normalMatrix",
    "pointLights",
    "pointLightShadows",
    "pointShadowMap",
    "pointShadowMatrix",
    "position",
    "probesMax",
    "probesMin",
    "probesResolution",
    "probesSH",
    "projectionMatrix",
    "receiveShadow",
    "rectAreaLights",
    "spotLightMap",
    "spotLightMatrix",
    "spotLights",
    "spotLightShadows",
    "spotShadowMap",
    "toneMappingExposure",
    "transmissionSamplerMap",
    "transmissionSamplerSize",
    "uv",
    "viewMatrix",
];

#[derive(Debug, Default, Clone)]
pub struct ThreeGpuComputationValidVariableName;

declare_oxc_lint!(
    /// Require safe and unique GPU computation shader variable names.
    ThreeGpuComputationValidVariableName,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate GPU computation shader variable names.",
);

impl Rule for ThreeGpuComputationValidVariableName {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut variables: Vec<(oxc_semantic::SymbolId, String, Span)> = Vec::new();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                continue;
            };
            if member_expression.static_property_name() != Some("addVariable")
                || three_constructor_api_name(member_expression.object(), ctx).as_deref()
                    != Some("GPUComputationRenderer")
            {
                continue;
            }
            let Some(renderer_symbol_id) =
                resolve_stable_identifier_symbol(member_expression.object(), ctx)
            else {
                continue;
            };
            let Some(oxc_ast::ast::Argument::StringLiteral(name_argument)) =
                call_expression.arguments.first()
            else {
                continue;
            };
            let variable_name = name_argument.value.as_str();
            if is_invalid_gpu_computation_variable_name(variable_name) {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "GPU computation variable name {variable_name} is not a safe user-defined GLSL identifier"
                    ))
                    .with_label(name_argument.span),
                );
            }
            variables.push((
                renderer_symbol_id,
                variable_name.to_string(),
                name_argument.span,
            ));
        }
        let mut first_variable_keys = FxHashSet::default();
        for (renderer_symbol_id, variable_name, name_argument_span) in variables {
            if !first_variable_keys.insert((renderer_symbol_id, variable_name.clone())) {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "GPU computation variable name {variable_name} is added more than once to the same renderer"
                    ))
                    .with_label(name_argument_span),
                );
            }
        }
    }
}

fn is_invalid_gpu_computation_variable_name(variable_name: &str) -> bool {
    let mut characters = variable_name.chars();
    let Some(first_character) = characters.next() else {
        return true;
    };
    if !(first_character.is_ascii_alphabetic() || first_character == '_')
        || characters.any(|character| !(character.is_ascii_alphanumeric() || character == '_'))
    {
        return true;
    }
    variable_name.starts_with("gl_")
        || variable_name.contains("__")
        || GLSL_KEYWORD_NAMES.contains(&variable_name)
        || THREE_RESERVED_SHADER_NAMES.contains(&variable_name)
}
