use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "These controls enable damping or auto-rotation, but no animation callback owned by the same setup calls controls.update";
const R3F_CONTROLS_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const THREE_CONTROLS_CONSTRUCTOR_NAMES: [&str; 2] = ["MapControls", "OrbitControls"];
const THREE_CONTROLS_MODULES: [&str; 3] = [
    "three-stdlib",
    "three/addons/controls/",
    "three/examples/jsm/controls/",
];
const THREE_CONTROLS_UPDATE_PROPERTY_NAMES: [&str; 2] = ["autoRotate", "enableDamping"];
const THREE_RENDERER_CONSTRUCTOR_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_RENDERER_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_RENDER_METHOD_NAMES: [&str; 2] = ["render", "renderAsync"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireControlsUpdate;

impl RuleMeta for ThreeRequireControlsUpdate {
    const NAME: &'static str = "three-require-controls-update";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require per-frame updates for active Three.js controls.",
    };
}

struct ThreeControlsConstruction {
    binding_symbol_id: SymbolId,
    key: String,
    node_id: NodeId,
    owner_id: Option<NodeId>,
}

struct ThreeControlsAnimationCallback {
    callback_id: NodeId,
    owner_id: Option<NodeId>,
}

impl Rule for ThreeRequireControlsUpdate {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let construction_candidate_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::NewExpression(_) = node.kind() else {
                    return None;
                };
                let declarator_node = ctx.nodes().parent_node(node.id());
                let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
                    return None;
                };
                (declarator.id.get_binding_identifier().is_some()
                    && matches!(
                        ctx.nodes().parent_node(declarator_node.id()).kind(),
                        AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
                    ))
                .then_some(node.id())
            })
            .collect::<Vec<_>>();
        if construction_candidate_ids.is_empty() {
            return;
        }
        let has_controls_constructor_candidate =
            construction_candidate_ids.iter().any(|&node_id| {
                let AstKind::NewExpression(new_expression) = ctx.nodes().get_node(node_id).kind()
                else {
                    return false;
                };
                three_module_api_name(&new_expression.callee, ctx).is_some_and(|api_name| {
                    THREE_CONTROLS_CONSTRUCTOR_NAMES.contains(&api_name.as_str())
                })
            }) || ctx.module_record().import_entries.iter().any(|entry| {
                entry.is_type && three_controls_module_source_matches(entry.module_request.name())
            }) || ctx.nodes().iter().any(|node| {
                let AstKind::TSImportEqualsDeclaration(declaration) = node.kind() else {
                    return false;
                };
                let oxc_ast::ast::TSModuleReference::ExternalModuleReference(reference) =
                    &declaration.module_reference
                else {
                    return false;
                };
                three_controls_module_source_matches(reference.expression.value.as_str())
            });
        if !has_controls_constructor_candidate {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let constructions = construction_candidate_ids
            .into_iter()
            .filter_map(|node_id| {
                let node = ctx.nodes().get_node(node_id);
                let AstKind::NewExpression(new_expression) = node.kind() else {
                    return None;
                };
                if !three_controls_constructor_matches(new_expression, &analysis, ctx) {
                    return None;
                }
                let declarator_node = ctx.nodes().parent_node(node_id);
                let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
                    return None;
                };
                let binding = declarator.id.get_binding_identifier()?;
                let binding_symbol_id = binding.symbol_id();
                Some(ThreeControlsConstruction {
                    binding_symbol_id,
                    key: format!("symbol:{}", binding_symbol_id.index()),
                    node_id,
                    owner_id: local_callback_nearest_function_id(node_id, ctx),
                })
            })
            .collect::<Vec<_>>();
        if constructions.is_empty() {
            return;
        }

        let mut update_dependent_controls_keys = rustc_hash::FxHashSet::default();
        let mut animation_callbacks = Vec::new();
        let mut animation_callback_ids = rustc_hash::FxHashSet::default();
        let mut callback_renders_with_three_cache = rustc_hash::FxHashMap::default();

        for node in ctx.nodes().iter() {
            if let AstKind::AssignmentExpression(assignment) = node.kind()
                && assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign
                && matches!(
                    assignment.right.get_inner_expression(),
                    Expression::BooleanLiteral(literal) if literal.value
                )
                && let Some(member_expression) = assignment.left.as_member_expression()
                && static_member_expression_property_name(member_expression).is_some_and(
                    |property_name| THREE_CONTROLS_UPDATE_PROPERTY_NAMES.contains(&property_name),
                )
                && let Some(controls_key) =
                    resolve_expression_key(member_expression.object(), ctx, &mut Vec::new())
            {
                update_dependent_controls_keys.insert(controls_key);
            }

            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let callback_id = three_controls_three_animation_callback_id(
                call_expression,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut callback_renders_with_three_cache,
            )
            .or_else(|| {
                three_controls_r3f_frame_callback_id(
                    call_expression,
                    &analysis,
                    ctx,
                    &mut resolution_cache,
                )
            });
            let Some(callback_id) = callback_id else {
                continue;
            };
            if animation_callback_ids.insert(callback_id) {
                animation_callbacks.push(ThreeControlsAnimationCallback {
                    callback_id,
                    owner_id: local_callback_nearest_function_id(node.id(), ctx),
                });
            }
        }

        if animation_callbacks.is_empty() || update_dependent_controls_keys.is_empty() {
            return;
        }
        let mut callback_update_cache = rustc_hash::FxHashMap::default();
        for construction in constructions {
            if !update_dependent_controls_keys.contains(&construction.key)
                || three_controls_escape_owner(construction.binding_symbol_id, ctx)
            {
                continue;
            }
            let owner_callbacks = animation_callbacks
                .iter()
                .filter(|callback| callback.owner_id == construction.owner_id)
                .collect::<Vec<_>>();
            if owner_callbacks.is_empty()
                || owner_callbacks.iter().any(|callback| {
                    let cache_key = (callback.callback_id, construction.key.clone());
                    if let Some(&does_update) = callback_update_cache.get(&cache_key) {
                        return does_update;
                    }
                    let does_update = three_controls_callback_updates_controls(
                        callback.callback_id,
                        &construction.key,
                        &analysis,
                        &node_index,
                        ctx,
                        &mut resolution_cache,
                    );
                    callback_update_cache.insert(cache_key, does_update);
                    does_update
                })
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(MESSAGE)
                    .with_label(ctx.nodes().get_node(construction.node_id).span()),
            );
        }
    }
}

fn three_controls_module_source_matches(module_source: &str) -> bool {
    module_source == "three-stdlib"
        || module_source.starts_with("three/addons/controls/")
        || module_source.starts_with("three/examples/jsm/controls/")
}

fn three_controls_constructor_matches<'a>(
    new_expression: &oxc_ast::ast::NewExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    THREE_CONTROLS_CONSTRUCTOR_NAMES
        .iter()
        .any(|constructor_name| {
            module_api_reference_matches(
                &new_expression.callee,
                constructor_name,
                &THREE_CONTROLS_MODULES,
                analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                &new_expression.callee,
                constructor_name,
                &THREE_CONTROLS_MODULES,
                analysis,
                ctx,
            )
        })
}

fn three_controls_escape_owner(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            ctx.nodes()
                .parent_node(reference_node.id())
                .kind()
                .as_member_expression_kind()
                .is_none_or(|member_expression| {
                    member_expression.object().node_id() != reference_node.id()
                })
        })
}

fn three_controls_r3f_frame_callback_id<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<NodeId> {
    (module_api_reference_matches(
        &call_expression.callee,
        "useFrame",
        &R3F_CONTROLS_PUBLIC_MODULES,
        analysis,
        ctx,
    ) || type_import_module_api_reference_matches(
        &call_expression.callee,
        "useFrame",
        &R3F_CONTROLS_PUBLIC_MODULES,
        analysis,
        ctx,
    ))
    .then_some(())?;
    resolve_r3f_analyzed_callback_function_id(
        call_expression.arguments.first()?.as_expression()?,
        analysis,
        ctx,
        resolution_cache,
    )
}

#[allow(clippy::too_many_arguments)]
fn three_controls_three_animation_callback_id<'a>(
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
        && three_controls_expression_resolves_to_renderer(
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
    let does_render = three_controls_callback_renders_with_three(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    callback_renders_with_three_cache.insert(callback_id, does_render);
    does_render.then_some(callback_id)
}

fn three_controls_callback_renders_with_three<'a>(
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
                && three_controls_expression_resolves_to_renderer(
                    member_expression.object(),
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

fn three_controls_expression_resolves_to_renderer<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(new_expression) = expression {
        return THREE_RENDERER_CONSTRUCTOR_NAMES
            .iter()
            .any(|constructor_name| {
                module_api_reference_matches(
                    &new_expression.callee,
                    constructor_name,
                    &THREE_RENDERER_MODULES,
                    analysis,
                    ctx,
                ) || type_import_module_api_reference_matches(
                    &new_expression.callee,
                    constructor_name,
                    &THREE_RENDERER_MODULES,
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
            three_controls_expression_resolves_to_renderer(
                initializer,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_controls_callback_updates_controls<'a>(
    callback_id: NodeId,
    controls_key: &str,
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
    let mut does_update = false;
    for_each_analyzed_synchronous_execution_node(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, _| {
            if does_update {
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
            if static_member_expression_property_name(member_expression) == Some("update")
                && resolve_expression_key(member_expression.object(), ctx, &mut Vec::new())
                    .as_deref()
                    == Some(controls_key)
            {
                does_update = true;
            }
        },
    );
    does_update
}
