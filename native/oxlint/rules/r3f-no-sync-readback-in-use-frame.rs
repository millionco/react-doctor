use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const CANVAS_MESSAGE: &str =
    "getImageData copies pixels to the CPU on every frame. Sample on demand or at a lower rate";
const GPU_MESSAGE: &str = "Synchronous GPU readback can stall the frame until prior GPU work completes. Use an asynchronous or event-driven readback path";
const R3F_SYNC_READBACK_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];

#[derive(Debug, Default, Clone)]
pub struct R3FNoSyncReadbackInUseFrame;

impl RuleMeta for R3FNoSyncReadbackInUseFrame {
    const NAME: &'static str = "r3f-no-sync-readback-in-use-frame";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow synchronous readback inside useFrame.",
    };
}

impl Rule for R3FNoSyncReadbackInUseFrame {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_SYNC_READBACK_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) && !type_import_module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_SYNC_READBACK_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) {
                continue;
            }
            let Some(callback_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
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
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, callback_id, is_conditionally_executed, _| {
                    if is_conditionally_executed {
                        return;
                    }
                    let AstKind::CallExpression(readback_call) = candidate.kind() else {
                        return;
                    };
                    let Some(member_expression) = readback_call.callee.as_member_expression()
                    else {
                        return;
                    };
                    let message = match static_member_expression_property_name(member_expression) {
                        Some("readRenderTargetPixels")
                            if r3f_callback_state_property_matches(
                                member_expression.object(),
                                callback_id,
                                "gl",
                                ctx,
                            ) || r3f_callback_state_property_matches(
                                member_expression.object(),
                                callback_id,
                                "renderer",
                                ctx,
                            ) =>
                        {
                            GPU_MESSAGE
                        }
                        Some("getImageData")
                            if is_context_from_get_context(
                                member_expression.object(),
                                &["2d"],
                                ctx,
                            ) =>
                        {
                            CANVAS_MESSAGE
                        }
                        Some("readPixels")
                            if is_webgl_context_reference(member_expression.object(), ctx)
                                && readback_call
                                    .arguments
                                    .get(6)
                                    .and_then(oxc_ast::ast::Argument::as_expression)
                                    .is_some_and(|destination| {
                                        is_cpu_typed_array(destination, ctx)
                                    }) =>
                        {
                            GPU_MESSAGE
                        }
                        _ => return,
                    };
                    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(candidate.span()));
                },
            );
        }
    }
}
