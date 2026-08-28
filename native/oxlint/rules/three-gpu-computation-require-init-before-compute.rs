use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "GPUComputationRenderer.compute() can run before a dominating init() call, so its variables and ping-pong render targets may be unavailable";
const THREE_GPU_COMPUTATION_RENDERER_NAMES: [&str; 1] = ["GPUComputationRenderer"];
const THREE_RENDERER_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_RENDER_METHOD_NAMES: [&str; 2] = ["render", "renderAsync"];

#[derive(Debug, Default, Clone)]
pub struct ThreeGpuComputationRequireInitBeforeCompute;

impl RuleMeta for ThreeGpuComputationRequireInitBeforeCompute {
    const NAME: &'static str = "three-gpu-computation-require-init-before-compute";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require GPU computation initialization before compute.",
    };
}

struct ThreeGpuComputationCall {
    computation_key: String,
    node_id: NodeId,
}

struct ThreeGpuComputationOperation {
    computation_key: String,
    node_id: NodeId,
    ordering_anchor_id: NodeId,
}

impl Rule for ThreeGpuComputationRequireInitBeforeCompute {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let Some(program_id) = ctx
            .nodes()
            .iter()
            .find_map(|node| matches!(node.kind(), AstKind::Program(_)).then_some(node.id()))
        else {
            return;
        };
        let call_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                matches!(node.kind(), AstKind::CallExpression(_)).then_some(node.id())
            })
            .collect::<Vec<_>>();
        if call_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut callback_renders_with_three_cache = rustc_hash::FxHashMap::default();
        let mut initializations = Vec::new();
        let mut operations = Vec::new();
        let mut nested_compute_ids = rustc_hash::FxHashSet::default();

        for call_id in call_ids {
            let AstKind::CallExpression(call_expression) = ctx.nodes().get_node(call_id).kind()
            else {
                continue;
            };
            if let Some(initialization) =
                three_gpu_computation_call(call_expression, call_id, "init", ctx)
            {
                initializations.push(initialization);
            }

            if let Some(callback_id) = three_gpu_computation_animation_callback_id(
                call_expression,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut callback_renders_with_three_cache,
            ) && !matches!(
                ctx.nodes().get_node(callback_id).kind(),
                AstKind::Function(function) if function.generator
            ) {
                for_each_analyzed_synchronous_execution_node(
                    callback_id,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                    |candidate, _, _, _| {
                        let AstKind::CallExpression(candidate_call) = candidate.kind() else {
                            return;
                        };
                        let Some(compute) = three_gpu_computation_call(
                            candidate_call,
                            candidate.id(),
                            "compute",
                            ctx,
                        ) else {
                            return;
                        };
                        if !nested_compute_ids.insert(candidate.id()) {
                            return;
                        }
                        operations.push(ThreeGpuComputationOperation {
                            computation_key: compute.computation_key,
                            node_id: compute.node_id,
                            ordering_anchor_id: call_id,
                        });
                    },
                );
            }

            if nested_compute_ids.contains(&call_id) {
                continue;
            }
            if let Some(compute) =
                three_gpu_computation_call(call_expression, call_id, "compute", ctx)
            {
                operations.push(ThreeGpuComputationOperation {
                    computation_key: compute.computation_key,
                    node_id: compute.node_id,
                    ordering_anchor_id: call_id,
                });
            }
        }

        for operation in operations {
            if initializations.iter().any(|initialization| {
                three_gpu_computation_initialization_dominates_operation(
                    initialization,
                    &operation,
                    program_id,
                    ctx,
                )
            }) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::error(MESSAGE)
                    .with_label(ctx.nodes().get_node(operation.node_id).span()),
            );
        }
    }
}

fn three_gpu_computation_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    node_id: NodeId,
    method_name: &str,
    ctx: &LintContext<'a>,
) -> Option<ThreeGpuComputationCall> {
    let member_expression = call_expression.callee.as_member_expression()?;
    if static_member_expression_property_name(member_expression) != Some(method_name)
        || three_constructor_name(
            member_expression.object(),
            &THREE_GPU_COMPUTATION_RENDERER_NAMES,
            ctx,
        ) != Some("GPUComputationRenderer")
    {
        return None;
    }
    Some(ThreeGpuComputationCall {
        computation_key: resolve_expression_key(member_expression.object(), ctx, &mut Vec::new())?,
        node_id,
    })
}

#[allow(clippy::too_many_arguments)]
fn three_gpu_computation_animation_callback_id<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    callback_renders_with_three_cache: &mut rustc_hash::FxHashMap<NodeId, bool>,
) -> Option<NodeId> {
    let callee = call_expression.callee.get_inner_expression();
    if let Some(member_expression) = callee.as_member_expression()
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
    let does_render = three_gpu_computation_callback_renders_with_three(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    callback_renders_with_three_cache.insert(callback_id, does_render);
    does_render.then_some(callback_id)
}

fn three_gpu_computation_callback_renders_with_three<'a>(
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if matches!(
        ctx.nodes().get_node(callback_id).kind(),
        AstKind::Function(function) if function.generator
    ) {
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

fn three_gpu_computation_initialization_dominates_operation(
    initialization: &ThreeGpuComputationCall,
    operation: &ThreeGpuComputationOperation,
    program_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if initialization.computation_key != operation.computation_key {
        return false;
    }
    let initialization_node = ctx.nodes().get_node(initialization.node_id);
    let ordering_anchor = ctx.nodes().get_node(operation.ordering_anchor_id);
    let initialization_owner = local_callback_nearest_function_id(initialization.node_id, ctx);
    let operation_owner = local_callback_nearest_function_id(operation.ordering_anchor_id, ctx);
    if initialization_owner != operation_owner {
        return false;
    }
    if initialization_owner.is_some() {
        return node_dominates_node(initialization_node, ordering_anchor, ctx);
    }
    initialization_node.span().start < ordering_anchor.span().start
        && !is_node_conditionally_executed(initialization_node, program_id, ctx)
}
