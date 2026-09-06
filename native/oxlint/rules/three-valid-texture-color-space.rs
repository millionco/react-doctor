use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    context::LintContext,
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
pub struct ThreeValidTextureColorSpace;

impl RuleMeta for ThreeValidTextureColorSpace {
    const NAME: &'static str = "three-valid-texture-color-space";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Validate Three.js material texture color spaces.",
    };
}

struct ThreeTextureColorSpaceFact {
    color_space_name: &'static str,
    assignment_count: usize,
}

impl Rule for ThreeValidTextureColorSpace {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut assignments_by_texture_key = rustc_hash::FxHashMap::default();
        let mut material_node_ids = Vec::new();
        let mut render_target_keys = rustc_hash::FxHashSet::default();

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::AssignmentExpression(assignment) => {
                    if let Some(target_expression) = assignment.left.get_expression() {
                        three_texture_record_render_target(
                            target_expression,
                            &assignment.right,
                            ctx,
                            &mut render_target_keys,
                        );
                    }
                    let Some((texture_key, color_space_name)) =
                        three_texture_explicit_color_space_assignment(assignment, &analysis, ctx)
                    else {
                        continue;
                    };
                    let fact = assignments_by_texture_key.entry(texture_key).or_insert(
                        ThreeTextureColorSpaceFact {
                            color_space_name,
                            assignment_count: 0,
                        },
                    );
                    fact.color_space_name = color_space_name;
                    fact.assignment_count += 1;
                }
                AstKind::NewExpression(allocation) => {
                    if three_module_api_name(&allocation.callee, ctx)
                        .is_some_and(|constructor_name| constructor_name.ends_with("Material"))
                    {
                        material_node_ids.push(node.id());
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let Some(initializer) = declarator.init.as_ref() else {
                        continue;
                    };
                    let Some(binding) = declarator.id.get_binding_identifier() else {
                        continue;
                    };
                    if three_constructor_api_name(initializer, ctx)
                        .is_some_and(|constructor_name| constructor_name.ends_with("RenderTarget"))
                    {
                        render_target_keys
                            .insert(format!("symbol:{}", binding.symbol_id().index()));
                    }
                }
                _ => {}
            }
        }

        for material_node_id in material_node_ids {
            let AstKind::NewExpression(material) = ctx.nodes().get_node(material_node_id).kind()
            else {
                continue;
            };
            let Some(parameters) = material
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            for property_name in MATERIAL_TEXTURE_PROPERTY_NAMES {
                let Some(texture_expression) =
                    get_static_object_property_value(parameters, property_name)
                else {
                    continue;
                };
                if three_texture_is_render_target_texture(
                    texture_expression,
                    &render_target_keys,
                    ctx,
                ) {
                    continue;
                }
                let Some(texture_key) =
                    resolve_expression_key(texture_expression, ctx, &mut Vec::new())
                else {
                    continue;
                };
                let Some(assignment) = assignments_by_texture_key.get(&texture_key) else {
                    continue;
                };
                let Some(expected_color_space) = three_expected_texture_color_space(property_name)
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

fn three_texture_record_render_target<'a>(
    target: &Expression<'a>,
    value: &Expression<'a>,
    ctx: &LintContext<'a>,
    render_target_keys: &mut rustc_hash::FxHashSet<String>,
) {
    if !three_constructor_api_name(value, ctx)
        .is_some_and(|constructor_name| constructor_name.ends_with("RenderTarget"))
    {
        return;
    }
    if let Some(target_key) = resolve_expression_key(target, ctx, &mut Vec::new()) {
        render_target_keys.insert(target_key);
    }
}

fn three_texture_is_render_target_texture(
    expression: &Expression<'_>,
    render_target_keys: &rustc_hash::FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member_expression) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    static_member_expression_property_name(member_expression) == Some("texture")
        && resolve_expression_key(member_expression.object(), ctx, &mut Vec::new())
            .is_some_and(|target_key| render_target_keys.contains(&target_key))
}

fn three_texture_explicit_color_space_assignment<'a>(
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

fn three_expected_texture_color_space(property_name: &str) -> Option<&'static str> {
    if COLOR_TEXTURE_PROPERTY_NAMES.contains(&property_name) {
        return Some("SRGBColorSpace");
    }
    DATA_TEXTURE_PROPERTY_NAMES
        .contains(&property_name)
        .then_some("NoColorSpace")
}
