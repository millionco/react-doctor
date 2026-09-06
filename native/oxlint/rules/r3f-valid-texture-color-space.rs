use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const COLOR_TEXTURE_PROPERTY_NAMES: [&str; 4] =
    ["emissiveMap", "map", "sheenColorMap", "specularColorMap"];
const DATA_TEXTURE_PROPERTY_NAMES: [&str; 14] = [
    "alphaMap",
    "aoMap",
    "bumpMap",
    "clearcoatMap",
    "clearcoatNormalMap",
    "clearcoatRoughnessMap",
    "displacementMap",
    "metalnessMap",
    "normalMap",
    "roughnessMap",
    "sheenRoughnessMap",
    "specularIntensityMap",
    "thicknessMap",
    "transmissionMap",
];
const MATERIAL_TEXTURE_PROPERTY_NAMES: [&str; 18] = [
    "alphaMap",
    "aoMap",
    "bumpMap",
    "clearcoatMap",
    "clearcoatNormalMap",
    "clearcoatRoughnessMap",
    "displacementMap",
    "emissiveMap",
    "map",
    "metalnessMap",
    "normalMap",
    "roughnessMap",
    "sheenColorMap",
    "sheenRoughnessMap",
    "specularColorMap",
    "specularIntensityMap",
    "thicknessMap",
    "transmissionMap",
];
const THREE_TEXTURE_COLOR_SPACE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct R3FValidTextureColorSpace;

impl RuleMeta for R3FValidTextureColorSpace {
    const NAME: &'static str = "r3f-valid-texture-color-space";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Validate R3F material texture color spaces.",
    };
}

struct R3fTextureColorSpaceFact {
    color_space_name: &'static str,
    assignment_count: usize,
}

impl Rule for R3FValidTextureColorSpace {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        let material_node_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                    return None;
                };
                (is_r3f_host_intrinsic(opening_element, ctx)
                    && resolve_jsx_element_type(opening_element, ctx)
                        .is_some_and(|(element_type, _)| element_type.ends_with("Material")))
                .then_some(node.id())
            })
            .collect::<Vec<_>>();
        if material_node_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut assignments_by_texture_key = rustc_hash::FxHashMap::default();
        for node in ctx.nodes().iter() {
            let AstKind::AssignmentExpression(assignment) = node.kind() else {
                continue;
            };
            let Some((texture_key, color_space_name)) =
                r3f_explicit_texture_color_space_assignment(assignment, &analysis, ctx)
            else {
                continue;
            };
            let fact =
                assignments_by_texture_key
                    .entry(texture_key)
                    .or_insert(R3fTextureColorSpaceFact {
                        color_space_name,
                        assignment_count: 0,
                    });
            fact.color_space_name = color_space_name;
            fact.assignment_count += 1;
        }

        for material_node_id in material_node_ids {
            let AstKind::JSXOpeningElement(opening_element) =
                ctx.nodes().get_node(material_node_id).kind()
            else {
                continue;
            };
            for property_name in MATERIAL_TEXTURE_PROPERTY_NAMES {
                let Some(texture_expression) =
                    get_authoritative_jsx_attribute(opening_element, property_name, true)
                        .and_then(jsx_attribute_expression)
                else {
                    continue;
                };
                let Some(texture_key) =
                    resolve_expression_key(texture_expression, ctx, &mut Vec::new())
                else {
                    continue;
                };
                let Some(assignment) = assignments_by_texture_key.get(&texture_key) else {
                    continue;
                };
                let Some(expected_color_space) = r3f_expected_texture_color_space(property_name)
                else {
                    continue;
                };
                if assignment.assignment_count != 1
                    || assignment.color_space_name == expected_color_space
                {
                    continue;
                }
                let data_kind = if expected_color_space == "SRGBColorSpace" {
                    "color"
                } else {
                    "non-color data"
                };
                ctx.diagnostic(
                    OxcDiagnostic::error(format!(
                        "{property_name} stores {data_kind}, but this texture is explicitly tagged {}; use {expected_color_space}",
                        assignment.color_space_name,
                    ))
                    .with_label(texture_expression.span()),
                );
            }
        }
    }
}

fn r3f_explicit_texture_color_space_assignment<'a>(
    assignment: &oxc_ast::ast::AssignmentExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<(String, &'static str)> {
    if assignment.operator != AssignmentOperator::Assign {
        return None;
    }
    let target = assignment.left.as_member_expression().or_else(|| {
        assignment
            .left
            .get_expression()?
            .get_inner_expression()
            .as_member_expression()
    })?;
    if static_member_expression_property_name(target) != Some("colorSpace") {
        return None;
    }
    let color_space_name =
        ["NoColorSpace", "SRGBColorSpace"]
            .into_iter()
            .find(|color_space_name| {
                module_api_reference_matches(
                    &assignment.right,
                    color_space_name,
                    &THREE_TEXTURE_COLOR_SPACE_MODULES,
                    analysis,
                    ctx,
                ) || type_import_module_api_reference_matches(
                    &assignment.right,
                    color_space_name,
                    &THREE_TEXTURE_COLOR_SPACE_MODULES,
                    analysis,
                    ctx,
                )
            })?;
    let texture_key = resolve_expression_key(target.object(), ctx, &mut Vec::new())?;
    Some((texture_key, color_space_name))
}

fn r3f_expected_texture_color_space(property_name: &str) -> Option<&'static str> {
    if COLOR_TEXTURE_PROPERTY_NAMES.contains(&property_name) {
        return Some("SRGBColorSpace");
    }
    DATA_TEXTURE_PROPERTY_NAMES
        .contains(&property_name)
        .then_some("NoColorSpace")
}
