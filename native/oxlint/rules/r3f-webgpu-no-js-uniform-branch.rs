use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This JavaScript branch reads a TSL uniform while the node graph is built, so later uniform changes cannot change the branch. Use TSL control flow";
const R3F_WEBGPU_MODULES: [&str; 1] = ["@react-three/fiber/webgpu"];
const TSL_UNIFORM_MODULES: [&str; 2] = ["three/tsl", "three/webgpu"];
const WEBGPU_GRAPH_HOOKS: [&str; 4] = [
    "useLocalNodes",
    "useNodes",
    "usePostProcessing",
    "useRenderPipeline",
];

#[derive(Debug, Default, Clone)]
pub struct R3FWebgpuNoJsUniformBranch;

struct R3fWebgpuUniformExpressionCandidateIndex {
    node_ids_by_start: Vec<NodeId>,
}

impl R3fWebgpuUniformExpressionCandidateIndex {
    fn new(ctx: &LintContext<'_>) -> Self {
        let mut node_ids_by_start = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                matches!(
                    node.kind(),
                    AstKind::IdentifierReference(_)
                        | AstKind::StaticMemberExpression(_)
                        | AstKind::ComputedMemberExpression(_)
                )
                .then_some(node.id())
            })
            .collect::<Vec<_>>();
        node_ids_by_start
            .sort_unstable_by_key(|node_id| ctx.nodes().get_node(*node_id).span().start);
        Self { node_ids_by_start }
    }
}

impl RuleMeta for R3FWebgpuNoJsUniformBranch {
    const NAME: &'static str = "r3f-webgpu-no-js-uniform-branch";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow JavaScript branches over TSL uniform values.",
    };
}

impl Rule for R3FWebgpuNoJsUniformBranch {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !program_references_r3f(ctx) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut node_index = None;
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut expression_candidate_index = None;
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(hook_name) = WEBGPU_GRAPH_HOOKS.iter().copied().find(|hook_name| {
                r3f_webgpu_uniform_api_call_matches(
                    call_expression,
                    hook_name,
                    &R3F_WEBGPU_MODULES,
                    &analysis,
                    ctx,
                )
            }) else {
                continue;
            };
            let callback_count = if matches!(hook_name, "usePostProcessing" | "useRenderPipeline") {
                2
            } else {
                1
            };
            for callback_argument in call_expression.arguments.iter().take(callback_count) {
                let Some(callback_expression) = callback_argument.as_expression() else {
                    continue;
                };
                let Some(callback_id) = resolve_r3f_analyzed_callback_function_id(
                    callback_expression,
                    &analysis,
                    ctx,
                    &mut resolution_cache,
                ) else {
                    continue;
                };
                if matches!(
                    ctx.nodes().get_node(callback_id).kind(),
                    AstKind::Function(function) if function.generator
                ) {
                    continue;
                }

                let node_index = node_index
                    .get_or_insert_with(|| build_local_callback_nearest_function_node_index(ctx));
                let expression_candidate_index: &R3fWebgpuUniformExpressionCandidateIndex =
                    expression_candidate_index
                        .get_or_insert_with(|| R3fWebgpuUniformExpressionCandidateIndex::new(ctx));
                let mut reported_control_flow_test_ids = Vec::new();
                for_each_analyzed_synchronous_execution_node(
                    callback_id,
                    &analysis,
                    node_index,
                    ctx,
                    &mut resolution_cache,
                    |candidate, _, _, _| {
                        let Some(control_flow_test) =
                            r3f_webgpu_uniform_control_flow_test(candidate)
                        else {
                            return;
                        };
                        if !r3f_webgpu_expression_references_uniform_value(
                            control_flow_test,
                            callback_id,
                            &analysis,
                            expression_candidate_index,
                            ctx,
                            &mut Vec::new(),
                        ) {
                            return;
                        }
                        let control_flow_test_id = control_flow_test.node_id();
                        if reported_control_flow_test_ids
                            .iter()
                            .any(|&reported_test_id| {
                                r3f_webgpu_node_is_descendant_or_same(
                                    control_flow_test_id,
                                    reported_test_id,
                                    ctx,
                                )
                            })
                        {
                            return;
                        }
                        reported_control_flow_test_ids.push(control_flow_test_id);
                        ctx.diagnostic(
                            OxcDiagnostic::warn(MESSAGE).with_label(control_flow_test.span()),
                        );
                    },
                );
            }
        }
    }
}

fn r3f_webgpu_uniform_api_call_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    module_sources: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    module_api_reference_matches(
        &call_expression.callee,
        api_name,
        module_sources,
        analysis,
        ctx,
    ) || type_import_module_api_reference_matches(
        &call_expression.callee,
        api_name,
        module_sources,
        analysis,
        ctx,
    )
}

fn r3f_webgpu_uniform_control_flow_test<'a>(node: &AstNode<'a>) -> Option<&'a Expression<'a>> {
    match node.kind() {
        AstKind::IfStatement(statement) => Some(&statement.test),
        AstKind::WhileStatement(statement) => Some(&statement.test),
        AstKind::DoWhileStatement(statement) => Some(&statement.test),
        AstKind::ConditionalExpression(expression) => Some(&expression.test),
        AstKind::SwitchStatement(statement) => Some(&statement.discriminant),
        AstKind::ForStatement(statement) => statement.test.as_ref(),
        AstKind::LogicalExpression(expression) => Some(&expression.left),
        _ => None,
    }
}

fn r3f_webgpu_expression_references_uniform_value<'a>(
    expression: &Expression<'a>,
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    expression_candidate_index: &R3fWebgpuUniformExpressionCandidateIndex,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression_id = expression.node_id();
    let expression_span = expression.span();
    let first_candidate_index = expression_candidate_index
        .node_ids_by_start
        .partition_point(|node_id| {
            ctx.nodes().get_node(*node_id).span().start < expression_span.start
        });
    for candidate_id in &expression_candidate_index.node_ids_by_start[first_candidate_index..] {
        let candidate = ctx.nodes().get_node(*candidate_id);
        let candidate_span = candidate.span();
        if candidate_span.start > expression_span.end {
            break;
        }
        if !expression_span.contains_inclusive(candidate_span) {
            continue;
        }
        if !r3f_webgpu_node_is_descendant_or_same(candidate.id(), expression_id, ctx) {
            continue;
        }
        if r3f_webgpu_is_uniform_value_member(candidate, callback_id, analysis, ctx) {
            return true;
        }
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            continue;
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            continue;
        };
        if visited_symbol_ids.contains(&symbol_id)
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| !reference.is_read() || reference.is_write())
        {
            continue;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            continue;
        };
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            continue;
        }
        let Some(initializer) = binding_pattern_initializer_for_symbol(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        ) else {
            continue;
        };
        visited_symbol_ids.push(symbol_id);
        if r3f_webgpu_expression_references_uniform_value(
            initializer,
            callback_id,
            analysis,
            expression_candidate_index,
            ctx,
            visited_symbol_ids,
        ) {
            return true;
        }
    }
    false
}

fn r3f_webgpu_is_uniform_value_member<'a>(
    node: &AstNode<'a>,
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(mut current) = r3f_webgpu_uniform_member_object(node, "value") else {
        return false;
    };
    if r3f_webgpu_resolves_to_tsl_uniform(current, analysis, ctx, &mut Vec::new()) {
        return true;
    }
    loop {
        if r3f_callback_state_property_matches(current, callback_id, "uniforms", ctx) {
            return true;
        }
        let Some(member_expression) = current.get_inner_expression().as_member_expression() else {
            return false;
        };
        current = member_expression.object();
    }
}

fn r3f_webgpu_uniform_member_object<'a>(
    node: &AstNode<'a>,
    property_name: &str,
) -> Option<&'a Expression<'a>> {
    match node.kind() {
        AstKind::StaticMemberExpression(member) if member.property.name == property_name => {
            Some(&member.object)
        }
        AstKind::ComputedMemberExpression(member)
            if r3f_webgpu_uniform_static_property_expression_matches(
                &member.expression,
                property_name,
            ) =>
        {
            Some(&member.object)
        }
        _ => None,
    }
}

fn r3f_webgpu_uniform_static_property_expression_matches(
    expression: &Expression<'_>,
    property_name: &str,
) -> bool {
    match expression {
        Expression::StringLiteral(literal) => literal.value == property_name,
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
            template.quasis.first().is_some_and(|quasi| {
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    == property_name
            })
        }
        _ => false,
    }
}

fn r3f_webgpu_resolves_to_tsl_uniform<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call_expression) = expression {
        return r3f_webgpu_uniform_api_call_matches(
            call_expression,
            "uniform",
            &TSL_UNIFORM_MODULES,
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
    if visited_symbol_ids.contains(&symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| !reference.is_read() || reference.is_write())
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    let Some(initializer) =
        binding_pattern_initializer_for_symbol(&declarator.id, symbol_id, declarator.init.as_ref())
    else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    r3f_webgpu_resolves_to_tsl_uniform(initializer, analysis, ctx, visited_symbol_ids)
}

fn r3f_webgpu_node_is_descendant_or_same(
    inner_id: NodeId,
    outer_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    inner_id == outer_id
        || ctx
            .nodes()
            .ancestors(inner_id)
            .any(|node| node.id() == outer_id)
}
