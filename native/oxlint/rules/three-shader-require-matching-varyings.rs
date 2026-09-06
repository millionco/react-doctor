use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use rustc_hash::FxHashMap;

use super::three_shader_require_matching_uniforms::{
    GlslGlobalDeclaration, for_each_static_matching_shader_material, has_array_dimension_mismatch,
};
use crate::{context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct ThreeShaderRequireMatchingVaryings;

declare_oxc_lint!(
    /// Require compatible vertex outputs and fragment inputs.
    ThreeShaderRequireMatchingVaryings,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Shader stage interface does not match.",
);

impl Rule for ThreeShaderRequireMatchingVaryings {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for_each_static_matching_shader_material(
            ctx,
            |_vertex_shader, fragment_shader, vertex_declarations, fragment_declarations, ctx| {
                let vertex_outputs = vertex_declarations
                    .iter()
                    .filter(|declaration| is_vertex_output(declaration))
                    .map(|declaration| (declaration.name.as_str(), declaration))
                    .collect::<FxHashMap<_, _>>();
                let fragment_inputs = fragment_declarations.iter().filter(|declaration| {
                    is_fragment_input(declaration)
                        && declaration.is_statically_used
                        && !declaration.name.starts_with("gl_")
                        && !declaration.has_layout_qualifier
                });
                for fragment_input in fragment_inputs {
                    let mismatch = match vertex_outputs.get(fragment_input.name.as_str()) {
                        None => Some("no matching vertex output".to_string()),
                        Some(vertex_output)
                            if vertex_output.type_name != fragment_input.type_name =>
                        {
                            Some(format!(
                                "type {} in the vertex shader but {} in the fragment shader",
                                vertex_output.type_name, fragment_input.type_name
                            ))
                        }
                        Some(vertex_output)
                            if has_array_dimension_mismatch(
                                vertex_output.array_size,
                                fragment_input.array_size,
                            ) =>
                        {
                            Some("different array dimensions".to_string())
                        }
                        Some(vertex_output)
                            if vertex_output.interpolation != fragment_input.interpolation =>
                        {
                            Some(format!(
                                "interpolation {} in the vertex shader but {} in the fragment shader",
                                vertex_output.interpolation, fragment_input.interpolation
                            ))
                        }
                        Some(_) => None,
                    };
                    let Some(mismatch) = mismatch else {
                        continue;
                    };
                    let utf16_offset = fragment_shader.text[..fragment_input.byte_offset]
                        .encode_utf16()
                        .count();
                    ctx.diagnostic(
                    OxcDiagnostic::error(format!(
                        "Fragment input {} has {mismatch}, so the shader program cannot link with a defined value",
                        fragment_input.name
                    ))
                    .with_label(fragment_shader.origin_span(utf16_offset)),
                );
                }
            },
        );
    }
}

fn is_vertex_output(declaration: &GlslGlobalDeclaration) -> bool {
    declaration.qualifiers.contains("out") || declaration.qualifiers.contains("varying")
}

fn is_fragment_input(declaration: &GlslGlobalDeclaration) -> bool {
    declaration.qualifiers.contains("in") || declaration.qualifiers.contains("varying")
}
