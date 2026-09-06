use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_ANIMATION_MIXER_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const R3F_ANIMATION_MIXER_THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const MESSAGE: &str = "This AnimationMixer creates an action, but no proven useFrame callback advances it with mixer.update(delta)";

#[derive(Debug, Default, Clone)]
pub struct R3FRequireAnimationMixerUpdate;

impl RuleMeta for R3FRequireAnimationMixerUpdate {
    const NAME: &'static str = "r3f-require-animation-mixer-update";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require AnimationMixer updates after starting mixer actions.",
    };
}

struct R3fAnimationMixerAction {
    mixer_key: String,
    call_id: oxc_semantic::NodeId,
    owner_id: Option<oxc_semantic::NodeId>,
}

impl Rule for R3FRequireAnimationMixerUpdate {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let has_clip_action_call = ctx.nodes().iter().any(|node| {
            matches!(
                node.kind(),
                AstKind::CallExpression(call_expression)
                    if strip_parenthesized_expression(&call_expression.callee)
                        .as_member_expression()
                        .is_some_and(|member| member.static_property_name() == Some("clipAction"))
            )
        });
        if !has_clip_action_call {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut callback_owner_by_function_id = rustc_hash::FxHashMap::default();
        let mut actions = Vec::new();

        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if (module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_ANIMATION_MIXER_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_ANIMATION_MIXER_PUBLIC_MODULES,
                &analysis,
                ctx,
            )) && let Some(callback_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                && let Some(callback_function_id) = resolve_r3f_analyzed_callback_function_id(
                    callback_expression,
                    &analysis,
                    ctx,
                    &mut resolution_cache,
                )
            {
                callback_owner_by_function_id.insert(
                    callback_function_id,
                    local_callback_nearest_function_id(node.id(), ctx),
                );
            }

            let Some(member_expression) =
                strip_parenthesized_expression(&call_expression.callee).as_member_expression()
            else {
                continue;
            };
            if member_expression.static_property_name() != Some("clipAction")
                || !r3f_animation_mixer_expression_resolves_to_constructor(
                    member_expression.object(),
                    &analysis,
                    ctx,
                    &mut Vec::new(),
                )
            {
                continue;
            }
            let Some(mixer_key) =
                resolve_expression_key(member_expression.object(), ctx, &mut Vec::new())
            else {
                continue;
            };
            actions.push(R3fAnimationMixerAction {
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
                .filter_map(|(callback_function_id, owner_id)| {
                    (*owner_id == action.owner_id).then_some(*callback_function_id)
                })
                .collect::<Vec<_>>();
            if owned_callback_ids.is_empty() || reported_mixer_keys.contains(&action.mixer_key) {
                continue;
            }
            let mut does_any_callback_update_mixer = false;
            for callback_function_id in owned_callback_ids {
                let cache_key = (callback_function_id, action.mixer_key.clone());
                let does_update_mixer = if let Some(cached_result) =
                    update_result_by_callback_and_key.get(&cache_key)
                {
                    *cached_result
                } else {
                    let result = animation_callback_updates_mixer(
                        callback_function_id,
                        &action.mixer_key,
                        &analysis,
                        &node_index,
                        ctx,
                        &mut resolution_cache,
                    );
                    update_result_by_callback_and_key.insert(cache_key, result);
                    result
                };
                if does_update_mixer {
                    does_any_callback_update_mixer = true;
                    break;
                }
            }
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

fn r3f_animation_mixer_expression_resolves_to_constructor<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::NewExpression(new_expression) = expression {
        return module_api_reference_matches(
            &new_expression.callee,
            "AnimationMixer",
            &R3F_ANIMATION_MIXER_THREE_MODULES,
            analysis,
            ctx,
        ) || type_import_module_api_reference_matches(
            &new_expression.callee,
            "AnimationMixer",
            &R3F_ANIMATION_MIXER_THREE_MODULES,
            analysis,
            ctx,
        );
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
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
            r3f_animation_mixer_expression_resolves_to_constructor(
                initializer,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}
