use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const FINISH_MESSAGE: &str = "finish blocks the calling thread until queued GPU work completes. Synchronize outside the animation loop";
const READBACK_MESSAGE: &str = "Synchronous GPU readback can stall the frame until prior GPU work completes. Use an asynchronous or event-driven readback path";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_RENDERER_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];

#[derive(Debug, Default, Clone)]
pub struct WebglNoSyncReadbackInAnimationLoop;

impl RuleMeta for WebglNoSyncReadbackInAnimationLoop {
    const NAME: &'static str = "webgl-no-sync-readback-in-animation-loop";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow synchronous GPU readback inside animation loops.",
    };
}

impl Rule for WebglNoSyncReadbackInAnimationLoop {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut analyzed_callback_ids = rustc_hash::FxHashSet::default();

        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let callback_id = webgl_sync_readback_animation_callback_id(
                call_expression,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
            );
            let Some(callback_id) = callback_id else {
                continue;
            };
            if !analyzed_callback_ids.insert(callback_id)
                || matches!(
                    ctx.nodes().get_node(callback_id).kind(),
                    AstKind::Function(function) if function.generator
                )
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
                    let AstKind::CallExpression(readback_call) = candidate.kind() else {
                        return;
                    };
                    let Some(member_expression) = readback_call
                        .callee
                        .get_inner_expression()
                        .as_member_expression()
                    else {
                        return;
                    };
                    let message = match static_member_expression_property_name(member_expression) {
                        Some("readRenderTargetPixels")
                            if webgl_sync_readback_is_three_renderer(
                                member_expression.object(),
                                &analysis,
                                ctx,
                                &mut Vec::new(),
                            ) =>
                        {
                            READBACK_MESSAGE
                        }
                        Some("finish")
                            if is_webgl_context_reference(member_expression.object(), ctx) =>
                        {
                            FINISH_MESSAGE
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
                            READBACK_MESSAGE
                        }
                        Some("getBufferSubData")
                            if is_webgl_context_reference(member_expression.object(), ctx)
                                && readback_call
                                    .arguments
                                    .get(2)
                                    .and_then(oxc_ast::ast::Argument::as_expression)
                                    .is_some_and(|destination| {
                                        is_cpu_typed_array(destination, ctx)
                                    }) =>
                        {
                            READBACK_MESSAGE
                        }
                        _ => return,
                    };
                    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(candidate.span()));
                },
            );
        }
    }
}

fn webgl_sync_readback_animation_callback_id<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<oxc_semantic::NodeId> {
    if let Some(member_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
        && static_member_expression_property_name(member_expression) == Some("setAnimationLoop")
        && webgl_sync_readback_is_three_renderer(
            member_expression.object(),
            analysis,
            ctx,
            &mut Vec::new(),
        )
    {
        return resolve_r3f_analyzed_callback_function_id(
            call_expression.arguments.first()?.as_expression()?,
            analysis,
            ctx,
            resolution_cache,
        );
    }
    resolve_analyzed_recursive_animation_frame_callback_id(
        call_expression,
        false,
        node_index,
        ctx,
        resolution_cache,
    )
}

fn webgl_sync_readback_is_three_renderer<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(allocation) = expression {
        return THREE_RENDERER_NAMES.iter().any(|constructor_name| {
            module_api_reference_matches(
                &allocation.callee,
                constructor_name,
                &THREE_MODULES,
                analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                &allocation.callee,
                constructor_name,
                &THREE_MODULES,
                analysis,
                ctx,
            )
        });
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) && declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            webgl_sync_readback_is_three_renderer(initializer, analysis, ctx, visited_symbol_ids)
        })
}
