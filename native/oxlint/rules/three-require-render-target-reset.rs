use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This renderer binds an offscreen render target without restoring the default framebuffer on every path, so later rendering can go to the wrong target";
const RENDER_TARGET_CONSTRUCTOR_NAMES: [&str; 3] =
    ["RenderTarget", "WebGLCubeRenderTarget", "WebGLRenderTarget"];
const RENDERER_CONSTRUCTOR_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireRenderTargetReset;

struct ThreeRenderTargetBinding {
    node_id: NodeId,
    renderer_key: String,
}

struct ThreeRenderTargetReset {
    node_id: NodeId,
    renderer_key: String,
}

enum ThreeRenderTargetOperation {
    Binding(ThreeRenderTargetBinding),
    Reset(ThreeRenderTargetReset),
}

impl RuleMeta for ThreeRequireRenderTargetReset {
    const NAME: &'static str = "three-require-render-target-reset";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require restoring Three.js's default render target on every path.",
    };
}

impl Rule for ThreeRequireRenderTargetReset {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !ctx.nodes().iter().any(|node| {
            matches!(
                node.kind(),
                AstKind::CallExpression(call)
                    if call.callee.get_inner_expression().as_member_expression().is_some_and(
                        |member| static_member_expression_property_name(member)
                            == Some("setRenderTarget")
                    )
            )
        }) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut bindings = Vec::new();
        let mut resets = Vec::new();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if let Some(operation) =
                three_render_target_operation(node.id(), call_expression, &analysis, ctx)
            {
                match operation {
                    ThreeRenderTargetOperation::Binding(binding) => bindings.push(binding),
                    ThreeRenderTargetOperation::Reset(reset) => resets.push(reset),
                }
                continue;
            }
            if !is_imported_or_stable_parameter_call(call_expression, ctx, &mut resolution_cache) {
                continue;
            }
            for argument in &call_expression.arguments {
                let Some(argument) = argument.as_expression() else {
                    continue;
                };
                if !three_render_target_expression_resolves_to_constructor(
                    argument,
                    &RENDERER_CONSTRUCTOR_NAMES,
                    &analysis,
                    ctx,
                    &mut Vec::new(),
                ) {
                    continue;
                }
                if let Some(renderer_key) = resolve_expression_key(argument, ctx, &mut Vec::new()) {
                    resets.push(ThreeRenderTargetReset {
                        node_id: node.id(),
                        renderer_key,
                    });
                }
            }
        }
        if bindings.is_empty() {
            return;
        }
        let Some(program_id) = ctx
            .nodes()
            .iter()
            .find_map(|node| matches!(node.kind(), AstKind::Program(_)).then_some(node.id()))
        else {
            return;
        };
        for binding in bindings {
            if three_render_target_reset_covers_binding(&binding, &resets, program_id, ctx) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::error(MESSAGE)
                    .with_label(ctx.nodes().get_node(binding.node_id).span()),
            );
        }
    }
}

fn three_render_target_operation<'a>(
    node_id: NodeId,
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<ThreeRenderTargetOperation> {
    let member_expression = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()?;
    if static_member_expression_property_name(member_expression) != Some("setRenderTarget")
        || !three_render_target_expression_resolves_to_constructor(
            member_expression.object(),
            &RENDERER_CONSTRUCTOR_NAMES,
            analysis,
            ctx,
            &mut Vec::new(),
        )
    {
        return None;
    }
    let renderer_key = resolve_expression_key(member_expression.object(), ctx, &mut Vec::new())?;
    let target = call_expression.arguments.first()?.as_expression()?;
    if matches!(target.get_inner_expression(), Expression::NullLiteral(_)) {
        return Some(ThreeRenderTargetOperation::Reset(ThreeRenderTargetReset {
            node_id,
            renderer_key,
        }));
    }
    three_render_target_expression_resolves_to_constructor(
        target,
        &RENDER_TARGET_CONSTRUCTOR_NAMES,
        analysis,
        ctx,
        &mut Vec::new(),
    )
    .then_some(ThreeRenderTargetOperation::Binding(
        ThreeRenderTargetBinding {
            node_id,
            renderer_key,
        },
    ))
}

fn three_render_target_expression_resolves_to_constructor<'a>(
    expression: &Expression<'a>,
    constructor_names: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(allocation) = expression {
        return constructor_names.iter().any(|constructor_name| {
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
    let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx) else {
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
            three_render_target_expression_resolves_to_constructor(
                initializer,
                constructor_names,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_render_target_reset_covers_binding<'a>(
    binding: &ThreeRenderTargetBinding,
    resets: &[ThreeRenderTargetReset],
    program_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let binding_node = ctx.nodes().get_node(binding.node_id);
    let owner_id =
        crate::ast_util::get_enclosing_function(binding_node, ctx).map(crate::AstNode::id);
    let matching_reset_nodes = resets
        .iter()
        .filter(|reset| reset.renderer_key == binding.renderer_key)
        .filter_map(|reset| {
            let reset_node = ctx.nodes().get_node(reset.node_id);
            (crate::ast_util::get_enclosing_function(reset_node, ctx).map(crate::AstNode::id)
                == owner_id)
                .then_some(reset_node)
        })
        .collect::<Vec<_>>();
    if let Some(owner_id) = owner_id {
        return do_nodes_cover_every_path_after_node(
            binding_node,
            &matching_reset_nodes,
            ctx.nodes().get_node(owner_id),
            ctx,
        );
    }
    matching_reset_nodes.into_iter().any(|reset_node| {
        reset_node.span().start > binding_node.span().start
            && !is_node_conditionally_executed(reset_node, program_id, ctx)
    })
}
