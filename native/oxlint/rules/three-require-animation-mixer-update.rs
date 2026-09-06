use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This AnimationMixer creates an action, but no proven Three.js animation callback advances it with mixer.update(deltaSeconds)";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_RENDERER_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_RENDER_METHOD_NAMES: [&str; 2] = ["render", "renderAsync"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireAnimationMixerUpdate;

impl RuleMeta for ThreeRequireAnimationMixerUpdate {
    const NAME: &'static str = "three-require-animation-mixer-update";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require AnimationMixer updates after starting mixer actions.",
    };
}

struct ThreeAnimationMixerAction {
    mixer_key: String,
    call_id: NodeId,
    owner_id: Option<NodeId>,
}

impl Rule for ThreeRequireAnimationMixerUpdate {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !ctx.nodes().iter().any(|node| {
            matches!(
                node.kind(),
                AstKind::CallExpression(call_expression)
                    if call_expression.callee.as_member_expression().is_some_and(
                        |member| static_member_expression_property_name(member)
                            == Some("clipAction")
                    )
            )
        }) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut callback_owner_by_function_id = rustc_hash::FxHashMap::default();
        let mut callback_renders_with_three_cache = rustc_hash::FxHashMap::default();
        let mut actions = Vec::new();

        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if let Some(callback_id) = three_animation_mixer_callback_id(
                call_expression,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut callback_renders_with_three_cache,
            ) {
                callback_owner_by_function_id.insert(
                    callback_id,
                    local_callback_nearest_function_id(node.id(), ctx),
                );
            }

            let Some(callee) = call_expression.callee.as_member_expression() else {
                continue;
            };
            if static_member_expression_property_name(callee) != Some("clipAction")
                || !three_animation_mixer_expression_resolves_to_constructor(
                    callee.object(),
                    &["AnimationMixer"],
                    &analysis,
                    ctx,
                    &mut Vec::new(),
                )
            {
                continue;
            }
            let Some(mixer_key) = resolve_expression_key(callee.object(), ctx, &mut Vec::new())
            else {
                continue;
            };
            actions.push(ThreeAnimationMixerAction {
                mixer_key,
                call_id: node.id(),
                owner_id: local_callback_nearest_function_id(node.id(), ctx),
            });
        }

        if callback_owner_by_function_id.is_empty() {
            return;
        }
        let mut reported_mixer_keys = rustc_hash::FxHashSet::default();
        let mut update_result_by_callback_and_key = rustc_hash::FxHashMap::default();
        for action in actions {
            let owned_callback_ids = callback_owner_by_function_id
                .iter()
                .filter_map(|(&callback_id, &owner_id)| {
                    (owner_id == action.owner_id).then_some(callback_id)
                })
                .collect::<Vec<_>>();
            if owned_callback_ids.is_empty() || reported_mixer_keys.contains(&action.mixer_key) {
                continue;
            }
            let does_any_callback_update_mixer =
                owned_callback_ids.into_iter().any(|callback_id| {
                    let cache_key = (callback_id, action.mixer_key.clone());
                    if let Some(&does_update) = update_result_by_callback_and_key.get(&cache_key) {
                        return does_update;
                    }
                    let does_update = animation_callback_updates_mixer(
                        callback_id,
                        &action.mixer_key,
                        &analysis,
                        &node_index,
                        ctx,
                        &mut resolution_cache,
                    );
                    update_result_by_callback_and_key.insert(cache_key, does_update);
                    does_update
                });
            if does_any_callback_update_mixer {
                continue;
            }
            reported_mixer_keys.insert(action.mixer_key);
            ctx.diagnostic(
                OxcDiagnostic::error(MESSAGE)
                    .with_label(ctx.nodes().get_node(action.call_id).span()),
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn three_animation_mixer_callback_id<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    callback_renders_with_three_cache: &mut rustc_hash::FxHashMap<NodeId, bool>,
) -> Option<NodeId> {
    let callee = call_expression.callee.get_inner_expression();
    if let Some(member) = callee.as_member_expression()
        && static_member_expression_property_name(member) == Some("setAnimationLoop")
        && three_animation_mixer_expression_resolves_to_constructor(
            member.object(),
            &THREE_RENDERER_NAMES,
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
    let does_render = three_animation_mixer_callback_renders_with_three(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    callback_renders_with_three_cache.insert(callback_id, does_render);
    does_render.then_some(callback_id)
}

fn three_animation_mixer_callback_renders_with_three<'a>(
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
            let Some(member) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                return;
            };
            if static_member_expression_property_name(member)
                .is_some_and(|method_name| THREE_RENDER_METHOD_NAMES.contains(&method_name))
                && three_animation_mixer_expression_resolves_to_constructor(
                    member.object(),
                    &THREE_RENDERER_NAMES,
                    analysis,
                    ctx,
                    &mut Vec::new(),
                )
            {
                does_render = true;
            }
        },
    );
    does_render
}

fn three_animation_mixer_expression_resolves_to_constructor<'a>(
    expression: &Expression<'a>,
    expected_names: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(allocation) = expression {
        return expected_names.iter().any(|constructor_name| {
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
            three_animation_mixer_expression_resolves_to_constructor(
                initializer,
                expected_names,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}
