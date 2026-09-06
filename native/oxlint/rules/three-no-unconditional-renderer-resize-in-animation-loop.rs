use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This animation callback resizes the renderer on every frame without checking whether the display size changed. Guard the resize with a drawing-buffer size comparison";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_RENDERER_CONSTRUCTOR_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_RENDER_METHOD_NAMES: [&str; 2] = ["render", "renderAsync"];
const THREE_RENDERER_RESIZE_METHOD_NAMES: [&str; 2] = ["setDrawingBufferSize", "setSize"];

#[derive(Debug, Default, Clone)]
pub struct ThreeNoUnconditionalRendererResizeInAnimationLoop;

impl RuleMeta for ThreeNoUnconditionalRendererResizeInAnimationLoop {
    const NAME: &'static str = "three-no-unconditional-renderer-resize-in-animation-loop";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow unconditional renderer resizing in Three.js animation loops.",
    };
}

impl Rule for ThreeNoUnconditionalRendererResizeInAnimationLoop {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut animation_call_ids = Vec::new();
        let mut has_resize_candidate = false;
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let callee = call_expression.callee.get_inner_expression();
            if callee
                .as_member_expression()
                .and_then(static_member_expression_property_name)
                .is_some_and(|method_name| {
                    THREE_RENDERER_RESIZE_METHOD_NAMES.contains(&method_name)
                })
            {
                has_resize_candidate = true;
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
        if animation_call_ids.is_empty() || !has_resize_candidate {
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
            let Some(callback_id) = three_resize_animation_callback_id(
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
                    let AstKind::CallExpression(resize_call) = candidate.kind() else {
                        return;
                    };
                    let Some(callee) = resize_call
                        .callee
                        .get_inner_expression()
                        .as_member_expression()
                    else {
                        return;
                    };
                    if !static_member_expression_property_name(callee).is_some_and(|method_name| {
                        THREE_RENDERER_RESIZE_METHOD_NAMES.contains(&method_name)
                    }) || !three_resize_resolves_to_renderer(
                        callee.object(),
                        &analysis,
                        ctx,
                        &mut Vec::new(),
                    ) || local_callback_nearest_function_id(candidate.id(), ctx)
                        != Some(callback_id)
                        || !three_resize_is_direct_unconditional_callback_expression(
                            candidate,
                            callback_id,
                            ctx,
                        )
                    {
                        return;
                    }
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
                },
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn three_resize_animation_callback_id<'a>(
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
        && three_resize_resolves_to_renderer(
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
    let does_render = three_resize_callback_renders_with_three(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    callback_renders_with_three_cache.insert(callback_id, does_render);
    does_render.then_some(callback_id)
}

fn three_resize_callback_renders_with_three<'a>(
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
            let Some(callee) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                return;
            };
            if static_member_expression_property_name(callee)
                .is_some_and(|method_name| THREE_RENDER_METHOD_NAMES.contains(&method_name))
                && three_resize_resolves_to_renderer(
                    callee.object(),
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

fn three_resize_resolves_to_renderer<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::NewExpression(allocation) => {
            THREE_RENDERER_CONSTRUCTOR_NAMES
                .iter()
                .any(|constructor_name| {
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
                })
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx)
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
                    three_resize_resolves_to_renderer(
                        initializer,
                        analysis,
                        ctx,
                        visited_symbol_ids,
                    )
                })
        }
        _ => false,
    }
}

fn three_resize_is_direct_unconditional_callback_expression<'a>(
    candidate: &AstNode<'a>,
    callback_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let expression_root = transparent_expression_root(candidate, ctx);
    let callback = ctx.nodes().get_node(callback_id);
    if let AstKind::ArrowFunctionExpression(function) = callback.kind()
        && function
            .get_expression()
            .is_some_and(|expression| expression.span() == expression_root.span())
    {
        return true;
    }
    let statement = ctx.nodes().parent_node(expression_root.id());
    let AstKind::ExpressionStatement(expression_statement) = statement.kind() else {
        return false;
    };
    if expression_statement.expression.span() != expression_root.span() {
        return false;
    }
    let Some(statements) = three_resize_callback_statements(callback) else {
        return false;
    };
    let Some(statement_index) = statements
        .iter()
        .position(|candidate_statement| candidate_statement.span() == statement.span())
    else {
        return false;
    };
    statements[..statement_index]
        .iter()
        .all(three_resize_allowed_preceding_statement)
}

fn three_resize_callback_statements<'a, 'b>(
    callback: &'b AstNode<'a>,
) -> Option<&'b [oxc_ast::ast::Statement<'a>]> {
    match callback.kind() {
        AstKind::Function(function) => Some(function.body.as_ref()?.statements.as_slice()),
        AstKind::ArrowFunctionExpression(function) => {
            Some(function.body.as_function_body()?.statements.as_slice())
        }
        _ => None,
    }
}

fn three_resize_allowed_preceding_statement(statement: &oxc_ast::ast::Statement<'_>) -> bool {
    matches!(
        statement,
        oxc_ast::ast::Statement::ExpressionStatement(_)
            | oxc_ast::ast::Statement::VariableDeclaration(_)
            | oxc_ast::ast::Statement::EmptyStatement(_)
    )
}
