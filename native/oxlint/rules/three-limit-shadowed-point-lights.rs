use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::AssignmentOperator;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{context::LintContext, rule::Rule, AstNode};

const MAX_SHADOWED_POINT_LIGHT_COUNT: u32 = 2;
const MESSAGE: &str = "This is the third or later shadow-casting point light added to the same scene. Each point-light shadow renders six cube faces, multiplying shadow passes";

#[derive(Debug, Default, Clone)]
pub struct ThreeLimitShadowedPointLights;

declare_oxc_lint!(
    /// Limit shadow-casting point lights in one scene.
    ThreeLimitShadowedPointLights,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Limit shadow-casting point lights in one scene.",
);

impl Rule for ThreeLimitShadowedPointLights {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut scene_light_facts = Vec::new();
        let mut shadowed_point_lights = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::CallExpression(call_expression) => {
                    let Some(member_expression) = call_expression.callee.as_member_expression()
                    else {
                        continue;
                    };
                    if member_expression.static_property_name() != Some("add")
                        || three_constructor_api_name(member_expression.object(), ctx).as_deref()
                            != Some("Scene")
                    {
                        continue;
                    }
                    let owner_node_id = execution_owner_node_id(node, ctx);
                    if is_node_conditionally_executed(node, owner_node_id, ctx) {
                        continue;
                    }
                    let Some(scene_symbol_id) =
                        resolve_stable_identifier_symbol(member_expression.object(), ctx)
                    else {
                        continue;
                    };
                    for argument in &call_expression.arguments {
                        let Some(light_expression) = argument.as_expression() else {
                            continue;
                        };
                        if three_constructor_api_name(light_expression, ctx).as_deref()
                            != Some("PointLight")
                        {
                            continue;
                        }
                        let Some(light_symbol_id) =
                            resolve_stable_identifier_symbol(light_expression, ctx)
                        else {
                            continue;
                        };
                        scene_light_facts.push((owner_node_id, scene_symbol_id, light_symbol_id));
                    }
                }
                AstKind::AssignmentExpression(assignment)
                    if assignment.operator == AssignmentOperator::Assign =>
                {
                    let Some(member_expression) = assignment.left.as_member_expression() else {
                        continue;
                    };
                    if member_expression.static_property_name() != Some("castShadow")
                        || !matches!(
                            assignment.right.get_inner_expression(),
                            oxc_ast::ast::Expression::BooleanLiteral(value) if value.value
                        )
                        || three_constructor_api_name(member_expression.object(), ctx).as_deref()
                            != Some("PointLight")
                    {
                        continue;
                    }
                    let owner_node_id = execution_owner_node_id(node, ctx);
                    if is_node_conditionally_executed(node, owner_node_id, ctx) {
                        continue;
                    }
                    let Some(light_symbol_id) =
                        resolve_stable_identifier_symbol(member_expression.object(), ctx)
                    else {
                        continue;
                    };
                    shadowed_point_lights.push((owner_node_id, light_symbol_id, node.span()));
                }
                _ => {}
            }
        }
        report_excess_shadowed_point_lights(&scene_light_facts, &shadowed_point_lights, ctx);
    }
}

fn execution_owner_node_id<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> NodeId {
    crate::ast_util::get_enclosing_function(node, ctx)
        .map(AstNode::id)
        .unwrap_or(NodeId::ROOT)
}

fn report_excess_shadowed_point_lights(
    scene_light_facts: &[(NodeId, SymbolId, SymbolId)],
    shadowed_point_lights: &[(NodeId, SymbolId, Span)],
    ctx: &LintContext<'_>,
) {
    let mut light_counts = FxHashMap::<(NodeId, SymbolId), u32>::default();
    let mut counted_lights = FxHashMap::<(NodeId, SymbolId), FxHashSet<SymbolId>>::default();
    for (owner_node_id, light_symbol_id, assignment_span) in shadowed_point_lights {
        let Some((_, scene_symbol_id, _)) =
            scene_light_facts
                .iter()
                .find(|(scene_owner_node_id, _, scene_light_symbol_id)| {
                    scene_owner_node_id == owner_node_id && scene_light_symbol_id == light_symbol_id
                })
        else {
            continue;
        };
        let scene_key = (*owner_node_id, *scene_symbol_id);
        if !counted_lights
            .entry(scene_key)
            .or_default()
            .insert(*light_symbol_id)
        {
            continue;
        }
        let light_count = light_counts.entry(scene_key).or_default();
        *light_count += 1;
        if *light_count > MAX_SHADOWED_POINT_LIGHT_COUNT {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(*assignment_span));
        }
    }
}
