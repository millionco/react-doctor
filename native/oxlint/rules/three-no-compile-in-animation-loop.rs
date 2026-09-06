use oxc_ast::{
    AstKind,
    ast::{AssignmentTarget, Expression, SimpleAssignmentTarget},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "Renderer shader precompilation runs inside the animation loop. Compile once before display instead of rechecking the scene every frame";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_COMPILE_METHOD_NAMES: [&str; 2] = ["compile", "compileAsync"];
const THREE_RENDERER_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_RENDER_METHOD_NAMES: [&str; 2] = ["render", "renderAsync"];

#[derive(Debug, Default, Clone)]
pub struct ThreeNoCompileInAnimationLoop;

impl RuleMeta for ThreeNoCompileInAnimationLoop {
    const NAME: &'static str = "three-no-compile-in-animation-loop";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow renderer shader compilation inside animation loops.",
    };
}

impl Rule for ThreeNoCompileInAnimationLoop {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut animation_call_ids = Vec::new();
        let mut has_compile_candidate = false;
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let callee = call_expression.callee.get_inner_expression();
            if callee
                .as_member_expression()
                .and_then(static_member_expression_property_name)
                .is_some_and(|method_name| THREE_COMPILE_METHOD_NAMES.contains(&method_name))
            {
                has_compile_candidate = true;
            }
            if callee
                .as_member_expression()
                .is_some_and(|member_expression| {
                    static_member_expression_property_name(member_expression)
                        == Some("setAnimationLoop")
                })
                || is_global_request_animation_frame_call(call_expression, ctx)
            {
                animation_call_ids.push(node.id());
            }
        }
        if !has_compile_candidate || animation_call_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut callback_renders_with_three_cache = rustc_hash::FxHashMap::default();
        let mut analyzed_callback_ids = rustc_hash::FxHashSet::default();

        for animation_call_id in animation_call_ids {
            let AstKind::CallExpression(call_expression) =
                ctx.nodes().get_node(animation_call_id).kind()
            else {
                continue;
            };
            let Some(callback_id) = three_compile_animation_callback_id(
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
                |candidate, _, _, _| {
                    let AstKind::CallExpression(candidate_call) = candidate.kind() else {
                        return;
                    };
                    let Some(member_expression) = candidate_call.callee.as_member_expression()
                    else {
                        return;
                    };
                    if !static_member_expression_property_name(member_expression).is_some_and(
                        |method_name| THREE_COMPILE_METHOD_NAMES.contains(&method_name),
                    ) || !three_compile_expression_resolves_to_renderer(
                        member_expression.object(),
                        &analysis,
                        ctx,
                    ) || three_compile_is_inside_advancing_switch_stage(candidate, ctx)
                    {
                        return;
                    }
                    ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(candidate.span()));
                },
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn three_compile_animation_callback_id<'a>(
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
        && three_compile_expression_resolves_to_renderer(member_expression.object(), analysis, ctx)
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
    let does_render = three_compile_callback_renders_with_three(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    callback_renders_with_three_cache.insert(callback_id, does_render);
    does_render.then_some(callback_id)
}

fn three_compile_callback_renders_with_three<'a>(
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
                && three_compile_expression_resolves_to_renderer(
                    member_expression.object(),
                    analysis,
                    ctx,
                )
            {
                does_render = true;
            }
        },
    );
    does_render
}

fn three_compile_expression_resolves_to_renderer<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    three_compile_expression_resolves_to_renderer_inner(expression, analysis, ctx, &mut Vec::new())
}

fn three_compile_expression_resolves_to_renderer_inner<'a>(
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
            three_compile_expression_resolves_to_renderer_inner(
                initializer,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_compile_is_inside_advancing_switch_stage(
    node: &crate::AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(switch_case) = ctx
        .nodes()
        .ancestors(node.id())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::SwitchCase(_)))
    else {
        return false;
    };
    let switch_node = ctx.nodes().parent_node(switch_case.id());
    let AstKind::SwitchStatement(switch_statement) = switch_node.kind() else {
        return false;
    };
    let Expression::Identifier(stage_identifier) = &switch_statement.discriminant else {
        return false;
    };
    let block_node = ctx.nodes().parent_node(switch_node.id());
    let AstKind::BlockStatement(block) = block_node.kind() else {
        return false;
    };
    let Some(switch_index) = block
        .body
        .iter()
        .position(|statement| statement.span() == switch_node.span())
    else {
        return false;
    };
    let Some(first_later_statement) = block.body.get(switch_index + 1) else {
        return false;
    };
    let later_statements_start = first_later_statement.span().start;
    let later_statements_end = block.body.last().unwrap().span().end;
    ctx.nodes().iter().any(|candidate| {
        let candidate_span = candidate.span();
        if candidate_span.start < later_statements_start
            || candidate_span.end > later_statements_end
        {
            return false;
        }
        match candidate.kind() {
            AstKind::UpdateExpression(update_expression) => matches!(
                &update_expression.argument,
                SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier)
                    if identifier.name == stage_identifier.name
            ),
            AstKind::AssignmentExpression(assignment_expression)
                if assignment_expression.operator != AssignmentOperator::Assign =>
            {
                matches!(
                    &assignment_expression.left,
                    AssignmentTarget::AssignmentTargetIdentifier(identifier)
                        if identifier.name == stage_identifier.name
                )
            }
            _ => false,
        }
    })
}
