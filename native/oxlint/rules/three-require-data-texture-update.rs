use oxc_ast::{
    AstKind,
    ast::{Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const DATA_TEXTURE_CONSTRUCTOR_NAMES: [&str; 3] =
    ["DataTexture", "Data3DTexture", "DataArrayTexture"];
const THREE_DATA_TEXTURE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_RENDER_METHOD_NAMES: [&str; 2] = ["render", "renderAsync"];
const THREE_RENDERER_CONSTRUCTOR_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_RENDERER_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const TYPED_ARRAY_MUTATION_METHOD_NAMES: [&str; 5] =
    ["copyWithin", "fill", "reverse", "set", "sort"];
const MESSAGE: &str = "This animation loop changes data-texture pixels without setting texture.needsUpdate on every path, so the GPU can keep rendering stale texels";

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireDataTextureUpdate;

impl RuleMeta for ThreeRequireDataTextureUpdate {
    const NAME: &'static str = "three-require-data-texture-update";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require data-texture uploads after animation-loop pixel changes.",
    };
}

struct ThreeDataTextureMutation {
    node_id: NodeId,
    owner_id: NodeId,
    texture_key: String,
}

struct ThreeDataTextureUpdate {
    node_id: NodeId,
    texture_key: String,
}

impl Rule for ThreeRequireDataTextureUpdate {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let animation_call_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(call_expression) = node.kind() else {
                    return None;
                };
                let callee = call_expression.callee.get_inner_expression();
                (callee
                    .as_member_expression()
                    .is_some_and(|member_expression| {
                        static_member_expression_property_name(member_expression)
                            == Some("setAnimationLoop")
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

        for animation_call_id in animation_call_ids {
            let AstKind::CallExpression(call_expression) =
                ctx.nodes().get_node(animation_call_id).kind()
            else {
                continue;
            };
            let Some(callback_id) = three_data_texture_animation_callback_id(
                call_expression,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut callback_renders_with_three_cache,
            ) else {
                continue;
            };
            if matches!(
                ctx.nodes().get_node(callback_id).kind(),
                AstKind::Function(function) if function.generator
            ) || !analyzed_callback_ids.insert(callback_id)
            {
                continue;
            }

            let mut mutations = Vec::new();
            let mut updates = Vec::new();
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, _, _, _| {
                    if let Some(receiver) =
                        three_data_texture_mutation_receiver(candidate, &analysis, ctx)
                        && let Some(texture_key) =
                            resolve_expression_key(receiver, ctx, &mut Vec::new())
                        && let Some(owner) = crate::ast_util::get_enclosing_function(candidate, ctx)
                    {
                        mutations.push(ThreeDataTextureMutation {
                            node_id: candidate.id(),
                            owner_id: owner.id(),
                            texture_key,
                        });
                    }
                    let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                        return;
                    };
                    let Some(receiver) = three_data_texture_update_receiver(assignment) else {
                        return;
                    };
                    if !three_data_texture_resolves_to_constructor(
                        receiver,
                        &analysis,
                        ctx,
                        &mut Vec::new(),
                    ) {
                        return;
                    }
                    if let Some(texture_key) =
                        resolve_expression_key(receiver, ctx, &mut Vec::new())
                    {
                        updates.push(ThreeDataTextureUpdate {
                            node_id: candidate.id(),
                            texture_key,
                        });
                    }
                },
            );

            for mutation in mutations {
                let matching_update_nodes = updates
                    .iter()
                    .filter(|update| update.texture_key == mutation.texture_key)
                    .map(|update| ctx.nodes().get_node(update.node_id))
                    .collect::<Vec<_>>();
                let mutation_node = ctx.nodes().get_node(mutation.node_id);
                if !do_nodes_cover_every_path_after_node(
                    mutation_node,
                    &matching_update_nodes,
                    ctx.nodes().get_node(mutation.owner_id),
                    ctx,
                ) {
                    ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(mutation_node.span()));
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn three_data_texture_animation_callback_id<'a>(
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
        && three_data_texture_resolves_to_renderer(
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
    let does_render = three_data_texture_callback_renders_with_three(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    callback_renders_with_three_cache.insert(callback_id, does_render);
    does_render.then_some(callback_id)
}

fn three_data_texture_callback_renders_with_three<'a>(
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
                && three_data_texture_resolves_to_renderer(
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

fn three_data_texture_mutation_receiver<'a>(
    node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    match node.kind() {
        AstKind::AssignmentExpression(assignment) => {
            let target = assignment.left.as_member_expression().or_else(|| {
                assignment
                    .left
                    .get_expression()?
                    .get_inner_expression()
                    .as_member_expression()
            })?;
            three_data_texture_assignment_receiver(target, analysis, ctx)
        }
        AstKind::UpdateExpression(update) => {
            let target = update.argument.as_member_expression().or_else(|| {
                update
                    .argument
                    .get_expression()?
                    .get_inner_expression()
                    .as_member_expression()
            })?;
            three_data_texture_assignment_receiver(target, analysis, ctx)
        }
        AstKind::CallExpression(call_expression) => {
            let callee = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()?;
            if !static_member_expression_property_name(callee)
                .is_some_and(|method_name| TYPED_ARRAY_MUTATION_METHOD_NAMES.contains(&method_name))
            {
                return None;
            }
            three_data_texture_from_data_expression(callee.object(), analysis, ctx, &mut Vec::new())
        }
        _ => None,
    }
}

fn three_data_texture_assignment_receiver<'a>(
    target: &'a MemberExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    if static_member_expression_property_name(target) == Some("image")
        && three_data_texture_resolves_to_constructor(
            target.object(),
            analysis,
            ctx,
            &mut Vec::new(),
        )
    {
        return Some(target.object());
    }
    if let Some(receiver) = three_data_texture_from_member_expression(target, analysis, ctx) {
        return Some(receiver);
    }
    matches!(target, MemberExpression::ComputedMemberExpression(_))
        .then(|| {
            three_data_texture_from_data_expression(target.object(), analysis, ctx, &mut Vec::new())
        })
        .flatten()
}

fn three_data_texture_from_data_expression<'a>(
    expression: &'a Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<&'a Expression<'a>> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression()
        && let Some(receiver) =
            three_data_texture_from_member_expression(member_expression, analysis, ctx)
    {
        return Some(receiver);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    three_data_texture_from_data_expression(
        declarator.init.as_ref()?,
        analysis,
        ctx,
        visited_symbol_ids,
    )
}

fn three_data_texture_from_member_expression<'a>(
    member_expression: &'a MemberExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    if static_member_expression_property_name(member_expression) != Some("data") {
        return None;
    }
    let image_member = member_expression
        .object()
        .get_inner_expression()
        .as_member_expression()?;
    if static_member_expression_property_name(image_member) != Some("image")
        || !three_data_texture_resolves_to_constructor(
            image_member.object(),
            analysis,
            ctx,
            &mut Vec::new(),
        )
    {
        return None;
    }
    Some(image_member.object())
}

fn three_data_texture_resolves_to_constructor<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    three_data_texture_resolves_to_three_constructor(
        expression,
        &DATA_TEXTURE_CONSTRUCTOR_NAMES,
        &THREE_DATA_TEXTURE_MODULES,
        analysis,
        ctx,
        visited_symbol_ids,
    )
}

fn three_data_texture_resolves_to_renderer<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    three_data_texture_resolves_to_three_constructor(
        expression,
        &THREE_RENDERER_CONSTRUCTOR_NAMES,
        &THREE_RENDERER_MODULES,
        analysis,
        ctx,
        visited_symbol_ids,
    )
}

fn three_data_texture_resolves_to_three_constructor<'a>(
    expression: &Expression<'a>,
    constructor_names: &[&str],
    module_sources: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(new_expression) = expression {
        return constructor_names.iter().any(|constructor_name| {
            module_api_reference_matches(
                &new_expression.callee,
                constructor_name,
                module_sources,
                analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                &new_expression.callee,
                constructor_name,
                module_sources,
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
            three_data_texture_resolves_to_three_constructor(
                initializer,
                constructor_names,
                module_sources,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_data_texture_update_receiver<'a>(
    assignment: &'a oxc_ast::ast::AssignmentExpression<'a>,
) -> Option<&'a Expression<'a>> {
    if assignment.operator != AssignmentOperator::Assign
        || !matches!(
            assignment.right.get_inner_expression(),
            Expression::BooleanLiteral(literal) if literal.value
        )
    {
        return None;
    }
    let target = assignment.left.as_member_expression().or_else(|| {
        assignment
            .left
            .get_expression()?
            .get_inner_expression()
            .as_member_expression()
    })?;
    (static_member_expression_property_name(target) == Some("needsUpdate")).then(|| target.object())
}
