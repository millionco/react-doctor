use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This animation loop recomputes instance matrices on the CPU every frame. Encode repeated transform motion in instanced attributes, a vertex shader, or GPU simulation";
const THREE_INSTANCED_MESH_NAMES: [&str; 1] = ["InstancedMesh"];
const THREE_RENDERER_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_RENDER_METHOD_NAMES: [&str; 2] = ["render", "renderAsync"];

#[derive(Debug, Default, Clone)]
pub struct ThreePreferGpuInstancedAnimation;

impl RuleMeta for ThreePreferGpuInstancedAnimation {
    const NAME: &'static str = "three-prefer-gpu-instanced-animation";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Prefer GPU-backed animation for Three.js instanced meshes.",
    };
}

impl Rule for ThreePreferGpuInstancedAnimation {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let animation_call_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(call_expression) = node.kind() else {
                    return None;
                };
                (call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .is_some_and(|member| {
                        static_member_expression_property_name(member) == Some("setAnimationLoop")
                    })
                    || is_global_request_animation_frame_call(call_expression, ctx))
                .then_some(node.id())
            })
            .collect::<Vec<_>>();
        if animation_call_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut analyzed_callback_ids = rustc_hash::FxHashSet::default();
        let mut callback_renders_with_three_cache = rustc_hash::FxHashMap::default();
        for call_id in animation_call_ids {
            let AstKind::CallExpression(call_expression) = ctx.nodes().get_node(call_id).kind()
            else {
                continue;
            };
            let Some(callback_id) = three_instanced_animation_callback_id(
                call_expression,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut callback_renders_with_three_cache,
            ) else {
                continue;
            };
            if !analyzed_callback_ids.insert(callback_id)
                || matches!(ctx.nodes().get_node(callback_id).kind(),
                    AstKind::Function(function) if function.generator)
            {
                continue;
            }
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, _, is_conditionally_executed, _| {
                    if is_conditionally_executed {
                        return;
                    }
                    let AstKind::CallExpression(call_expression) = candidate.kind() else {
                        return;
                    };
                    let Some(member_expression) = call_expression.callee.as_member_expression()
                    else {
                        return;
                    };
                    if static_member_expression_property_name(member_expression)
                        != Some("setMatrixAt")
                        || !node_is_inside_repeated_execution(candidate, ctx)
                        || three_constructor_name(
                            member_expression.object(),
                            &THREE_INSTANCED_MESH_NAMES,
                            ctx,
                        )
                        .is_none()
                    {
                        return;
                    }
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
                },
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn three_instanced_animation_callback_id<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    callback_renders_with_three_cache: &mut rustc_hash::FxHashMap<NodeId, bool>,
) -> Option<NodeId> {
    if let Some(member_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
        && static_member_expression_property_name(member_expression) == Some("setAnimationLoop")
        && three_constructor_name(member_expression.object(), &THREE_RENDERER_NAMES, ctx).is_some()
    {
        return resolve_r3f_analyzed_callback_function_id(
            call_expression.arguments.first()?.as_expression()?,
            analysis,
            ctx,
            resolution_cache,
        );
    }
    let callback_id = resolve_analyzed_recursive_animation_frame_callback_id(
        call_expression,
        false,
        node_index,
        ctx,
        resolution_cache,
    )?;
    if let Some(&does_render) = callback_renders_with_three_cache.get(&callback_id) {
        return does_render.then_some(callback_id);
    }
    let does_render = three_instanced_animation_callback_renders_with_three(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    callback_renders_with_three_cache.insert(callback_id, does_render);
    does_render.then_some(callback_id)
}

fn three_instanced_animation_callback_renders_with_three<'a>(
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if matches!(ctx.nodes().get_node(callback_id).kind(),
        AstKind::Function(function) if function.generator)
    {
        return false;
    }
    let mut does_render = false;
    for_each_analyzed_synchronous_execution_node(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, _| {
            if does_render {
                return;
            }
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return;
            };
            let Some(member_expression) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                return;
            };
            if static_member_expression_property_name(member_expression)
                .is_some_and(|method_name| THREE_RENDER_METHOD_NAMES.contains(&method_name))
                && three_constructor_name(member_expression.object(), &THREE_RENDERER_NAMES, ctx)
                    .is_some()
            {
                does_render = true;
            }
        },
    );
    does_render
}
