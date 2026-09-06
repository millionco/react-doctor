use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This JavaScript branch reads a TSL uniform while the shader graph is built, so later uniform changes cannot change the branch. Use TSL control flow";
const TSL_MODULES: [&str; 2] = ["three/tsl", "three/webgpu"];

#[derive(Debug, Default, Clone)]
pub struct ThreeTslNoJsUniformBranch;

struct ThreeTslUniformExpressionCandidateIndex {
    node_ids_by_start: Vec<NodeId>,
}

impl ThreeTslUniformExpressionCandidateIndex {
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

impl RuleMeta for ThreeTslNoJsUniformBranch {
    const NAME: &'static str = "three-tsl-no-js-uniform-branch";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow JavaScript branches over TSL uniform values.",
    };
}

impl Rule for ThreeTslNoJsUniformBranch {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !three_tsl_program_references_modules(ctx) {
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
            if !three_tsl_api_call_matches(call_expression, "Fn", &analysis, ctx) {
                continue;
            }
            let Some(callback_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) = exact_local_function_id(
                callback_expression,
                ctx,
                &mut Vec::new(),
                &mut resolution_cache,
            ) else {
                continue;
            };
            let node_index = node_index
                .get_or_insert_with(|| build_local_callback_nearest_function_node_index(ctx));
            let expression_candidate_index: &ThreeTslUniformExpressionCandidateIndex =
                expression_candidate_index
                    .get_or_insert_with(|| ThreeTslUniformExpressionCandidateIndex::new(ctx));
            let mut reported_control_flow_test_ids = Vec::new();
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                node_index,
                ctx,
                &mut resolution_cache,
                |candidate, _, _, _| {
                    let Some(control_flow_test) = three_tsl_control_flow_test(candidate) else {
                        return;
                    };
                    if !three_tsl_expression_references_uniform_value(
                        control_flow_test,
                        &analysis,
                        expression_candidate_index,
                        ctx,
                        &mut Vec::new(),
                    ) {
                        return;
                    }
                    let control_flow_test_id = control_flow_test.node_id();
                    if reported_control_flow_test_ids.iter().any(|&reported_id| {
                        three_tsl_node_is_descendant_or_same(control_flow_test_id, reported_id, ctx)
                    }) {
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

fn three_tsl_program_references_modules(ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| {
        let module_source = match node.kind() {
            AstKind::ImportDeclaration(declaration) => Some(declaration.source.value.as_str()),
            AstKind::TSImportEqualsDeclaration(declaration) => {
                let oxc_ast::ast::TSModuleReference::ExternalModuleReference(reference) =
                    &declaration.module_reference
                else {
                    return false;
                };
                Some(reference.expression.value.as_str())
            }
            AstKind::CallExpression(call_expression) => call_expression
                .common_js_require()
                .map(|source| source.value.as_str()),
            _ => None,
        };
        module_source.is_some_and(|module_source| TSL_MODULES.contains(&module_source))
    })
}

fn three_tsl_api_call_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    module_api_reference_matches(
        &call_expression.callee,
        api_name,
        &TSL_MODULES,
        analysis,
        ctx,
    ) || type_import_module_api_reference_matches(
        &call_expression.callee,
        api_name,
        &TSL_MODULES,
        analysis,
        ctx,
    )
}

fn three_tsl_control_flow_test<'a>(node: &AstNode<'a>) -> Option<&'a Expression<'a>> {
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

fn three_tsl_expression_references_uniform_value<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    expression_candidate_index: &ThreeTslUniformExpressionCandidateIndex,
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
        if !expression_span.contains_inclusive(candidate_span)
            || !three_tsl_node_is_descendant_or_same(candidate.id(), expression_id, ctx)
        {
            continue;
        }
        if three_tsl_is_uniform_value_member(candidate, analysis, ctx) {
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
                .any(oxc_semantic::Reference::is_write)
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
        if three_tsl_expression_references_uniform_value(
            initializer,
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

fn three_tsl_is_uniform_value_member<'a>(
    node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member_expression) = node.kind().as_member_expression_kind() else {
        return false;
    };
    member_expression.static_property_name().as_deref() == Some("value")
        && three_tsl_resolves_to_uniform(member_expression.object(), analysis, ctx, &mut Vec::new())
}

fn three_tsl_resolves_to_uniform<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call_expression) = expression {
        return three_tsl_api_call_matches(call_expression, "uniform", analysis, ctx);
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
            .any(oxc_semantic::Reference::is_write)
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
    three_tsl_resolves_to_uniform(initializer, analysis, ctx, visited_symbol_ids)
}

fn three_tsl_node_is_descendant_or_same(
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
