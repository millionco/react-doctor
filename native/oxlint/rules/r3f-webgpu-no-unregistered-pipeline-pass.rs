use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "Direct assignment does not register this WebGPU pipeline pass and is discarded after the callback. Return the pass in an object instead";
const R3F_WEBGPU_MODULES: [&str; 1] = ["@react-three/fiber/webgpu"];
const WEBGPU_PIPELINE_HOOKS: [&str; 2] = ["usePostProcessing", "useRenderPipeline"];

#[derive(Debug, Default, Clone)]
pub struct R3FWebgpuNoUnregisteredPipelinePass;

impl RuleMeta for R3FWebgpuNoUnregisteredPipelinePass {
    const NAME: &'static str = "r3f-webgpu-no-unregistered-pipeline-pass";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow unregistered R3F WebGPU pipeline passes.",
    };
}

impl Rule for R3FWebgpuNoUnregisteredPipelinePass {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !program_references_r3f(ctx) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut node_index = None;
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !WEBGPU_PIPELINE_HOOKS.iter().any(|hook_name| {
                module_api_reference_matches(
                    &call_expression.callee,
                    hook_name,
                    &R3F_WEBGPU_MODULES,
                    &analysis,
                    ctx,
                ) || type_import_module_api_reference_matches(
                    &call_expression.callee,
                    hook_name,
                    &R3F_WEBGPU_MODULES,
                    &analysis,
                    ctx,
                )
            }) {
                continue;
            }
            for callback_argument in call_expression.arguments.iter().take(2) {
                let Some(callback_expression) = callback_argument.as_expression() else {
                    continue;
                };
                let Some(callback_id) = resolve_r3f_analyzed_callback_function_id(
                    callback_expression,
                    &analysis,
                    ctx,
                    &mut resolution_cache,
                ) else {
                    continue;
                };
                if matches!(
                    ctx.nodes().get_node(callback_id).kind(),
                    AstKind::Function(function) if function.generator
                ) {
                    continue;
                }
                let node_index = node_index
                    .get_or_insert_with(|| build_local_callback_nearest_function_node_index(ctx));
                for_each_analyzed_synchronous_execution_node(
                    callback_id,
                    &analysis,
                    node_index,
                    ctx,
                    &mut resolution_cache,
                    |candidate, root_callback_id, _, _| {
                        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                            return;
                        };
                        let Some(target) = assignment.left.as_member_expression() else {
                            return;
                        };
                        if !r3f_callback_state_property_matches(
                            target.object(),
                            root_callback_id,
                            "passes",
                            ctx,
                        ) {
                            return;
                        }
                        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(target.span()));
                    },
                );
            }
        }
    }
}
