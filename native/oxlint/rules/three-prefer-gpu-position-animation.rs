use oxc_ast::{
    AstKind,
    ast::{Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This animation loop rewrites position-buffer entries on the CPU. Move repeated vertex or particle motion into a vertex shader, instanced attributes, or a GPU simulation";
const POSITION_BUFFER_ARRAY_MUTATION_METHOD_NAMES: [&str; 3] = ["copyWithin", "fill", "set"];
const POSITION_BUFFER_MUTATION_METHOD_NAMES: [&str; 6] =
    ["setX", "setXY", "setXYZ", "setXYZW", "setY", "setZ"];
const THREE_RENDERER_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_RENDER_METHOD_NAMES: [&str; 2] = ["render", "renderAsync"];

#[derive(Debug, Default, Clone)]
pub struct ThreePreferGpuPositionAnimation;

impl RuleMeta for ThreePreferGpuPositionAnimation {
    const NAME: &'static str = "three-prefer-gpu-position-animation";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Prefer GPU-backed position animation in Three.js frame loops.",
    };
}

impl Rule for ThreePreferGpuPositionAnimation {
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
            let Some(callback_id) = three_position_animation_callback_id(
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
            let mut first_mutation_id = None;
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, _, is_conditionally_executed, _| {
                    if first_mutation_id.is_none()
                        && !is_conditionally_executed
                        && three_position_animation_is_repeated_mutation(candidate, ctx)
                    {
                        first_mutation_id = Some(candidate.id());
                    }
                },
            );
            if let Some(first_mutation_id) = first_mutation_id {
                ctx.diagnostic(
                    OxcDiagnostic::warn(MESSAGE)
                        .with_label(ctx.nodes().get_node(first_mutation_id).span()),
                );
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn three_position_animation_callback_id<'a>(
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
    let does_render = three_position_animation_callback_renders_with_three(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    callback_renders_with_three_cache.insert(callback_id, does_render);
    does_render.then_some(callback_id)
}

fn three_position_animation_callback_renders_with_three<'a>(
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

fn three_position_animation_is_repeated_mutation<'a>(
    candidate: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match candidate.kind() {
        AstKind::CallExpression(call_expression) => {
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                return false;
            };
            let Some(method_name) = static_member_expression_property_name(member_expression)
            else {
                return false;
            };
            (POSITION_BUFFER_MUTATION_METHOD_NAMES.contains(&method_name)
                && three_position_animation_resolves_to_buffer_attribute(
                    member_expression.object(),
                    ctx,
                    &mut Vec::new(),
                )
                && node_is_inside_repeated_execution(candidate, ctx))
                || (POSITION_BUFFER_ARRAY_MUTATION_METHOD_NAMES.contains(&method_name)
                    && three_position_animation_resolves_to_buffer_array(
                        member_expression.object(),
                        ctx,
                        &mut Vec::new(),
                    ))
        }
        AstKind::AssignmentExpression(assignment) => assignment
            .left
            .as_member_expression()
            .or_else(|| {
                assignment
                    .left
                    .get_expression()
                    .map(Expression::get_inner_expression)
                    .and_then(Expression::as_member_expression)
            })
            .is_some_and(|member_expression| {
                three_position_animation_is_buffer_array_element(member_expression, ctx)
                    && node_is_inside_repeated_execution(candidate, ctx)
            }),
        AstKind::UpdateExpression(update) => update
            .argument
            .as_member_expression()
            .or_else(|| {
                update
                    .argument
                    .get_expression()
                    .map(Expression::get_inner_expression)
                    .and_then(Expression::as_member_expression)
            })
            .is_some_and(|member_expression| {
                three_position_animation_is_buffer_array_element(member_expression, ctx)
                    && node_is_inside_repeated_execution(candidate, ctx)
            }),
        _ => false,
    }
}

fn three_position_animation_is_buffer_array_element<'a>(
    member_expression: &MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    matches!(
        member_expression,
        MemberExpression::ComputedMemberExpression(_)
    ) && three_position_animation_resolves_to_buffer_array(
        member_expression.object(),
        ctx,
        &mut Vec::new(),
    )
}

fn three_position_animation_resolves_to_buffer_attribute<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call_expression) = expression
        && call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|member_expression| {
                static_member_expression_property_name(member_expression) == Some("getAttribute")
            })
        && matches!(
            call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                .map(Expression::get_inner_expression),
            Some(Expression::StringLiteral(literal)) if literal.value == "position"
        )
    {
        return true;
    }
    if let Some(position_member) = expression.as_member_expression()
        && static_member_expression_property_name(position_member) == Some("position")
        && position_member
            .object()
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|attributes_member| {
                static_member_expression_property_name(attributes_member) == Some("attributes")
            })
    {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some((symbol_id, initializer)) =
        three_position_animation_const_identifier_initializer(identifier, ctx)
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    three_position_animation_resolves_to_buffer_attribute(initializer, ctx, visited_symbol_ids)
}

fn three_position_animation_resolves_to_buffer_array<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression()
        && static_member_expression_property_name(member_expression) == Some("array")
    {
        return three_position_animation_resolves_to_buffer_attribute(
            member_expression.object(),
            ctx,
            &mut Vec::new(),
        );
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some((symbol_id, initializer)) =
        three_position_animation_const_identifier_initializer(identifier, ctx)
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    three_position_animation_resolves_to_buffer_array(initializer, ctx, visited_symbol_ids)
}

fn three_position_animation_const_identifier_initializer<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<(SymbolId, &'a Expression<'a>)> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const())
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    Some((symbol_id, declarator.init.as_ref()?))
}
