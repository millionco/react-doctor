use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This Three.js setAnimationLoop callback has no reachable render call, so its updates are never presented. Render the scene or a composer from the loop";
const THREE_RENDERER_CONSTRUCTOR_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireRenderInAnimationLoop;

impl RuleMeta for ThreeRequireRenderInAnimationLoop {
    const NAME: &'static str = "three-require-render-in-animation-loop";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require Three.js animation loops to render.",
    };
}

impl Rule for ThreeRequireRenderInAnimationLoop {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let animation_loop_call_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(call_expression) = node.kind() else {
                    return None;
                };
                let member_expression = call_expression.callee.as_member_expression()?;
                (static_member_expression_property_name(member_expression)
                    == Some("setAnimationLoop")
                    && three_constructor_name(
                        member_expression.object(),
                        &THREE_RENDERER_CONSTRUCTOR_NAMES,
                        ctx,
                    )
                    .is_some()
                    && call_expression
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression)
                        .is_some())
                .then_some(node.id())
            })
            .collect::<Vec<_>>();
        if animation_loop_call_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut callback_may_render_cache = rustc_hash::FxHashMap::default();

        for call_id in animation_loop_call_ids {
            let AstKind::CallExpression(call_expression) = ctx.nodes().get_node(call_id).kind()
            else {
                continue;
            };
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
            let callback_may_render =
                if let Some(&may_render) = callback_may_render_cache.get(&callback_id) {
                    may_render
                } else {
                    let may_render = three_animation_loop_callback_may_render(
                        callback_id,
                        &analysis,
                        &node_index,
                        ctx,
                        &mut resolution_cache,
                    );
                    callback_may_render_cache.insert(callback_id, may_render);
                    may_render
                };
            if callback_may_render {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(call_expression.span));
        }
    }
}

fn three_animation_loop_callback_may_render<'a>(
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
    let mut may_render = false;
    for_each_analyzed_synchronous_execution_node(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, execution_resolution_cache| {
            if may_render {
                return;
            }
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return;
            };
            if call_expression
                .callee
                .as_member_expression()
                .is_some_and(|member_expression| {
                    static_member_expression_property_name(member_expression) == Some("render")
                })
            {
                may_render = true;
                return;
            }
            if is_imported_or_stable_parameter_call(
                call_expression,
                ctx,
                execution_resolution_cache,
            ) {
                may_render = true;
                return;
            }
            may_render = matches!(
                &call_expression.callee,
                Expression::Identifier(identifier)
                    if ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_none()
            );
        },
    );
    may_render
}
