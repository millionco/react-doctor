use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const SYNCHRONOUS_INITIALIZED_RENDERER_METHOD_NAMES: [&str; 10] = [
    "clear",
    "clearColor",
    "clearDepth",
    "clearStencil",
    "hasCompatibility",
    "hasFeature",
    "initRenderTarget",
    "initTexture",
    "render",
    "resetState",
];
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct ThreeWebgpuRequireInitBeforeSyncOperation;

impl RuleMeta for ThreeWebgpuRequireInitBeforeSyncOperation {
    const NAME: &'static str = "three-webgpu-require-init-before-sync-operation";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require awaited WebGPURenderer initialization before synchronous use.",
    };
}

struct ThreeWebgpuRendererMethodCall {
    method_name: &'static str,
    node_id: NodeId,
    owner_function_id: Option<NodeId>,
    renderer_symbol_id: SymbolId,
}

impl Rule for ThreeWebgpuRequireInitBeforeSyncOperation {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "three:181") {
            return;
        }

        let Some(program_id) = ctx
            .nodes()
            .iter()
            .find_map(|node| matches!(node.kind(), AstKind::Program(_)).then_some(node.id()))
        else {
            return;
        };
        let candidate_calls = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(call_expression) = node.kind() else {
                    return None;
                };
                let callee = call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()?;
                let method_name = static_member_expression_property_name(callee)?;
                let method_name = if method_name == "init" {
                    "init"
                } else {
                    SYNCHRONOUS_INITIALIZED_RENDERER_METHOD_NAMES
                        .iter()
                        .copied()
                        .find(|candidate| *candidate == method_name)?
                };
                Some((node.id(), method_name))
            })
            .collect::<Vec<_>>();
        if candidate_calls.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut initialization_calls = Vec::new();
        let mut operation_calls = Vec::new();
        for (node_id, method_name) in candidate_calls {
            let node = ctx.nodes().get_node(node_id);
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(callee) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                continue;
            };
            let Some(renderer_symbol_id) = three_webgpu_resolve_renderer_symbol(
                callee.object(),
                &analysis,
                ctx,
                &mut Vec::new(),
            ) else {
                continue;
            };
            let Some(renderer_initializer) =
                three_webgpu_direct_unreassigned_initializer(renderer_symbol_id, ctx)
            else {
                continue;
            };
            let owner_function_id = local_callback_nearest_function_id(node.id(), ctx);
            if owner_function_id
                != local_callback_nearest_function_id(renderer_initializer.node_id(), ctx)
            {
                continue;
            }
            let method_call = ThreeWebgpuRendererMethodCall {
                method_name,
                node_id: node.id(),
                owner_function_id,
                renderer_symbol_id,
            };
            if method_name == "init" {
                if three_webgpu_call_is_awaited(node, ctx) {
                    initialization_calls.push(method_call);
                }
            } else {
                operation_calls.push(method_call);
            }
        }

        for operation in operation_calls {
            let operation_node = ctx.nodes().get_node(operation.node_id);
            let operation_start = operation_node.span().start;
            let is_initialized = initialization_calls.iter().any(|initialization| {
                let initialization_node = ctx.nodes().get_node(initialization.node_id);
                initialization.renderer_symbol_id == operation.renderer_symbol_id
                    && initialization.owner_function_id == operation.owner_function_id
                    && initialization_node.span().start < operation_start
                    && !is_node_conditionally_executed(
                        initialization_node,
                        operation.owner_function_id.unwrap_or(program_id),
                        ctx,
                    )
            });
            if is_initialized {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "WebGPURenderer.{}() is called before a provable awaited renderer.init(), so the synchronous API can throw while the backend is uninitialized",
                    operation.method_name,
                ))
                .with_label(operation_node.span()),
            );
        }
    }
}

fn three_webgpu_resolve_renderer_symbol<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    let initializer = three_webgpu_direct_unreassigned_initializer(symbol_id, ctx)?;
    visited_symbol_ids.push(symbol_id);
    if matches!(
        initializer.get_inner_expression(),
        Expression::Identifier(_)
    ) {
        return three_webgpu_resolve_renderer_symbol(
            initializer,
            analysis,
            ctx,
            visited_symbol_ids,
        );
    }
    three_webgpu_is_renderer_allocation(initializer, analysis, ctx).then_some(symbol_id)
}

fn three_webgpu_direct_unreassigned_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return None;
    };
    if variable_declaration.kind.is_const() {
        return declarator.init.as_ref();
    }
    let symbol_scope_id = ctx.scoping().symbol_scope_id(symbol_id);
    let symbol_name = ctx.scoping().symbol_name(symbol_id);
    let has_same_scope_sibling = ctx.scoping().symbol_ids().any(|candidate_symbol_id| {
        candidate_symbol_id != symbol_id
            && ctx.scoping().symbol_scope_id(candidate_symbol_id) == symbol_scope_id
            && ctx.scoping().symbol_name(candidate_symbol_id) == symbol_name
    });
    if !matches!(
        variable_declaration.kind,
        oxc_ast::ast::VariableDeclarationKind::Let | oxc_ast::ast::VariableDeclarationKind::Var
    ) || has_same_scope_sibling
        || !ctx.scoping().symbol_redeclarations(symbol_id).is_empty()
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| !reference.is_read() || reference.is_write())
    {
        return None;
    }
    declarator.init.as_ref()
}

fn three_webgpu_is_renderer_allocation<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::NewExpression(allocation) = expression.get_inner_expression() else {
        return false;
    };
    module_api_reference_matches(
        &allocation.callee,
        "WebGPURenderer",
        &THREE_MODULES,
        analysis,
        ctx,
    ) || type_import_module_api_reference_matches(
        &allocation.callee,
        "WebGPURenderer",
        &THREE_MODULES,
        analysis,
        ctx,
    )
}

fn three_webgpu_call_is_awaited<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let expression_root = transparent_expression_root(node, ctx);
    matches!(
        ctx.nodes().parent_node(expression_root.id()).kind(),
        AstKind::AwaitExpression(await_expression)
            if await_expression.argument.span() == expression_root.span()
    )
}
