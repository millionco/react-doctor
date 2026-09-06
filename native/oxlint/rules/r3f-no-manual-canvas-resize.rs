use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "Canvas already observes its container and sizes this renderer. A second resize loop can duplicate work and fight the Canvas size lifecycle";
#[derive(Debug, Default, Clone)]
pub struct R3FNoManualCanvasResize;

impl RuleMeta for R3FNoManualCanvasResize {
    const NAME: &'static str = "r3f-no-manual-canvas-resize";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow manual resize loops for R3F-owned renderers.",
    };
}

impl Rule for R3FNoManualCanvasResize {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let registration_node_ids = ctx
            .nodes()
            .iter()
            .filter(|node| manual_resize_handler_expression(node, ctx).is_some())
            .map(crate::AstNode::id)
            .collect::<Vec<_>>();
        if registration_node_ids.is_empty() {
            return;
        }
        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut assigned_expression_cache = R3fAnalyzedAssignedExpressionCache::default();
        let mut first_set_size_call_id_by_handler_id = rustc_hash::FxHashMap::default();
        for registration_node_id in registration_node_ids {
            let registration_node = ctx.nodes().get_node(registration_node_id);
            let Some(handler_expression) = manual_resize_handler_expression(registration_node, ctx)
            else {
                continue;
            };
            let Some(handler_function_id) = exact_local_function_id(
                handler_expression,
                ctx,
                &mut Vec::new(),
                &mut resolution_cache,
            ) else {
                continue;
            };
            let set_size_call_id = if let Some(cached_call_id) =
                first_set_size_call_id_by_handler_id.get(&handler_function_id)
            {
                *cached_call_id
            } else {
                let set_size_call_id = manual_resize_first_set_size_call(
                    handler_function_id,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                    &mut assigned_expression_cache,
                );
                first_set_size_call_id_by_handler_id.insert(handler_function_id, set_size_call_id);
                set_size_call_id
            };
            if let Some(set_size_call_id) = set_size_call_id {
                ctx.diagnostic(
                    OxcDiagnostic::warn(MESSAGE)
                        .with_label(ctx.nodes().get_node(set_size_call_id).span()),
                );
            }
        }
    }
}

fn manual_resize_handler_expression<'a, 'ctx>(
    node: &'ctx crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'ctx Expression<'a>> {
    match node.kind() {
        AstKind::CallExpression(call_expression) => {
            let callee = call_expression.callee.get_inner_expression();
            let member_expression = callee.as_member_expression()?;
            if member_expression.static_property_name() != Some("addEventListener")
                || !manual_resize_is_global_identifier(member_expression.object(), "window", ctx)
                || !matches!(
                    call_expression.arguments.first()?.as_expression()?.get_inner_expression(),
                    Expression::StringLiteral(literal) if literal.value == "resize"
                )
            {
                return None;
            }
            call_expression.arguments.get(1)?.as_expression()
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign =>
        {
            let member_expression = assignment.left.as_member_expression()?;
            (member_expression.static_property_name() == Some("onresize")
                && manual_resize_is_global_identifier(member_expression.object(), "window", ctx))
            .then_some(&assignment.right)
        }
        AstKind::NewExpression(new_expression) => {
            if !manual_resize_is_global_identifier(&new_expression.callee, "ResizeObserver", ctx) {
                return None;
            }
            new_expression.arguments.first()?.as_expression()
        }
        _ => None,
    }
}

fn manual_resize_is_global_identifier(
    expression: &Expression<'_>,
    identifier_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == identifier_name
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    )
}

fn manual_resize_first_set_size_call<'a, 'ctx>(
    handler_function_id: oxc_semantic::NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &'ctx LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> Option<oxc_semantic::NodeId> {
    let mut first_set_size_call_id = None;
    for_each_analyzed_synchronous_execution_node(
        handler_function_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, execution_resolution_cache| {
            if first_set_size_call_id.is_some() {
                return;
            }
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return;
            };
            let Some(member_expression) =
                strip_parenthesized_expression(&call_expression.callee).as_member_expression()
            else {
                return;
            };
            if member_expression.static_property_name() == Some("setSize")
                && ["gl", "renderer"].iter().any(|property_name| {
                    r3f_analyzed_use_three_state_property_matches(
                        member_expression.object(),
                        property_name,
                        analysis,
                        node_index,
                        ctx,
                        execution_resolution_cache,
                        assigned_expression_cache,
                    )
                })
            {
                first_set_size_call_id = Some(candidate.id());
            }
        },
    );
    first_set_size_call_id
}
