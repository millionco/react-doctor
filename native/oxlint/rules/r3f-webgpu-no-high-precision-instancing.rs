use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;
use rustc_hash::FxHashMap;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const INCOMPATIBLE_ELEMENT_TYPES: [&str; 2] = ["instancedMesh", "skinnedMesh"];
const R3F_ROOT_MODULE: &str = "@react-three/fiber";
const THREE_MODULE_SOURCES: [&str; 3] = ["three", "three-stdlib", "three/"];
const MESSAGE: &str = "This R3F object is rendered by a WebGPURenderer with highPrecision enabled, but Three.js does not support 64-bit matrices for InstancedMesh or SkinnedMesh";

#[derive(Debug, Default, Clone)]
pub struct R3FWebgpuNoHighPrecisionInstancing;

impl RuleMeta for R3FWebgpuNoHighPrecisionInstancing {
    const NAME: &'static str = "r3f-webgpu-no-high-precision-instancing";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow incompatible WebGPU high-precision R3F rendering.",
    };
}

impl Rule for R3FWebgpuNoHighPrecisionInstancing {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_capability_or_unspecified(ctx, "three:181") {
            return;
        }
        let incompatible_opening_element_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                    return None;
                };
                if !is_r3f_host_intrinsic(opening_element, ctx)
                    || resolve_jsx_element_type(opening_element, ctx).is_none_or(
                        |(element_type, _)| !INCOMPATIBLE_ELEMENT_TYPES.contains(&element_type),
                    )
                {
                    return None;
                }
                Some(node.id())
            })
            .collect::<Vec<_>>();
        if incompatible_opening_element_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut canvas_high_precision_cache = FxHashMap::default();

        for opening_element_id in incompatible_opening_element_ids {
            let Some(canvas_id) =
                r3f_webgpu_find_owning_canvas_id(opening_element_id, &analysis, ctx)
            else {
                continue;
            };
            let enables_high_precision = if let Some(&enables_high_precision) =
                canvas_high_precision_cache.get(&canvas_id)
            {
                enables_high_precision
            } else {
                let enables_high_precision = r3f_webgpu_canvas_factory_enables_high_precision(
                    canvas_id,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                );
                canvas_high_precision_cache.insert(canvas_id, enables_high_precision);
                enables_high_precision
            };
            if enables_high_precision {
                let opening_element = ctx.nodes().get_node(opening_element_id);
                ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(opening_element.span()));
            }
        }
    }
}

fn r3f_webgpu_find_owning_canvas_id<'a>(
    opening_element_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    ctx.nodes().ancestors(opening_element_id).find_map(|node| {
        let AstKind::JSXElement(element) = node.kind() else {
            return None;
        };
        jsx_module_api_reference_matches(
            &element.opening_element.name,
            "Canvas",
            &[R3F_ROOT_MODULE],
            analysis,
            ctx,
        )
        .then_some(node.id())
    })
}

fn r3f_webgpu_canvas_factory_enables_high_precision<'a>(
    canvas_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let AstKind::JSXElement(canvas) = ctx.nodes().get_node(canvas_id).kind() else {
        return false;
    };
    let Some(gl_attribute) = get_authoritative_jsx_attribute(&canvas.opening_element, "gl", true)
    else {
        return false;
    };
    let Some(factory_expression) = jsx_attribute_expression(gl_attribute) else {
        return false;
    };
    let Some(factory_id) = resolve_r3f_analyzed_callback_function_id(
        factory_expression,
        analysis,
        ctx,
        resolution_cache,
    ) else {
        return false;
    };
    if matches!(
        ctx.nodes().get_node(factory_id).kind(),
        AstKind::Function(function) if function.generator
    ) {
        return false;
    }

    let mut enables_high_precision = false;
    for_each_analyzed_synchronous_execution_node(
        factory_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, _| {
            if enables_high_precision {
                return;
            }
            let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                return;
            };
            let Some(target) = assignment.left.as_member_expression() else {
                return;
            };
            if assignment.operator != AssignmentOperator::Assign
                || !matches!(
                    assignment.right.get_inner_expression(),
                    Expression::BooleanLiteral(boolean) if boolean.value
                )
                || static_member_expression_property_name(target) != Some("highPrecision")
                || !r3f_webgpu_is_renderer_constructor(
                    target.object(),
                    analysis,
                    ctx,
                    &mut Vec::new(),
                )
            {
                return;
            }
            enables_high_precision = true;
        },
    );
    enables_high_precision
}

fn r3f_webgpu_is_renderer_constructor<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(constructor) = expression {
        return module_api_reference_matches(
            &constructor.callee,
            "WebGPURenderer",
            &THREE_MODULE_SOURCES,
            analysis,
            ctx,
        ) || type_import_module_api_reference_matches(
            &constructor.callee,
            "WebGPURenderer",
            &THREE_MODULE_SOURCES,
            analysis,
            ctx,
        );
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
            r3f_webgpu_is_renderer_constructor(initializer, analysis, ctx, visited_symbol_ids)
        })
}
