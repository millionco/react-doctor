use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This Canvas factory returns WebGPURenderer without an unconditional awaited init() call, so R3F can receive an uninitialized backend";
const R3F_ROOT_MODULES: [&str; 1] = ["@react-three/fiber"];
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_WEBGPU_MODULES: [&str; 2] = ["three", "three/"];

#[derive(Debug, Default, Clone)]
pub struct R3FWebgpuRequireAsyncInit;

impl RuleMeta for R3FWebgpuRequireAsyncInit {
    const NAME: &'static str = "r3f-webgpu-require-async-init";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require awaited WebGPURenderer initialization in R3F factories.",
    };
}

#[derive(Default)]
struct R3fWebgpuAsyncInitAssignedExpressionCache<'a> {
    expressions_by_symbol_and_reference: FxHashMap<(SymbolId, NodeId), Vec<&'a Expression<'a>>>,
}

impl Rule for R3FWebgpuRequireAsyncInit {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !program_references_r3f(ctx) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut node_index = None;
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut assigned_expression_cache = R3fWebgpuAsyncInitAssignedExpressionCache::default();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !jsx_module_api_reference_matches(
                &opening_element.name,
                "Canvas",
                &R3F_ROOT_MODULES,
                &analysis,
                ctx,
            ) {
                continue;
            }
            let Some(gl_attribute) = get_authoritative_jsx_attribute(opening_element, "gl", true)
            else {
                continue;
            };
            let Some(factory_expression) = jsx_attribute_expression(gl_attribute) else {
                continue;
            };
            let Some(factory_id) = resolve_r3f_analyzed_callback_function_id(
                factory_expression,
                &analysis,
                ctx,
                &mut resolution_cache,
            ) else {
                continue;
            };
            let node_index = node_index
                .get_or_insert_with(|| build_local_callback_nearest_function_node_index(ctx));
            if !r3f_webgpu_async_init_function_returns_renderer(
                factory_id,
                &analysis,
                node_index,
                ctx,
                &mut assigned_expression_cache,
                &mut Vec::new(),
            ) || r3f_webgpu_async_init_has_dominating_initialization(
                factory_id,
                &analysis,
                node_index,
                ctx,
                &mut resolution_cache,
            ) {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(gl_attribute.span()));
        }
    }
}

fn r3f_webgpu_async_init_is_async_function(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn r3f_webgpu_async_init_function_returns_renderer<'a>(
    function_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut R3fWebgpuAsyncInitAssignedExpressionCache<'a>,
    visited_function_ids: &mut Vec<NodeId>,
) -> bool {
    if visited_function_ids.contains(&function_id) {
        return false;
    }
    visited_function_ids.push(function_id);
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        let matches = r3f_webgpu_async_init_return_expression_matches(
            expression,
            analysis,
            node_index,
            ctx,
            assigned_expression_cache,
            visited_function_ids,
            &mut Vec::new(),
        );
        visited_function_ids.pop();
        return matches;
    }
    let matches = node_index.node_ids(function_id).iter().any(|candidate_id| {
        let AstKind::ReturnStatement(statement) = ctx.nodes().get_node(*candidate_id).kind() else {
            return false;
        };
        statement.argument.as_ref().is_some_and(|expression| {
            r3f_webgpu_async_init_return_expression_matches(
                expression,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_function_ids,
                &mut Vec::new(),
            )
        })
    });
    visited_function_ids.pop();
    matches
}

fn r3f_webgpu_async_init_return_expression_matches<'a>(
    expression: &'a Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut R3fWebgpuAsyncInitAssignedExpressionCache<'a>,
    visited_function_ids: &mut Vec<NodeId>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if r3f_webgpu_async_init_is_renderer_allocation(expression, analysis, ctx) {
        return true;
    }
    match expression {
        Expression::Identifier(identifier) => {
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
            let assigned_expressions = r3f_webgpu_async_init_possible_assigned_expressions(
                identifier,
                symbol_id,
                ctx,
                assigned_expression_cache,
            );
            let matches = assigned_expressions.into_iter().any(|assigned_expression| {
                !matches!(
                    assigned_expression.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                ) && r3f_webgpu_async_init_return_expression_matches(
                    assigned_expression,
                    analysis,
                    node_index,
                    ctx,
                    assigned_expression_cache,
                    visited_function_ids,
                    &mut visited_symbol_ids.clone(),
                )
            });
            visited_symbol_ids.pop();
            matches
        }
        Expression::CallExpression(call_expression)
            if call_expression.arguments.is_empty()
                && matches!(&call_expression.callee, Expression::Identifier(_)) =>
        {
            r3f_webgpu_async_init_zero_argument_function_id(call_expression, ctx).is_some_and(
                |called_function_id| {
                    r3f_webgpu_async_init_function_returns_renderer(
                        called_function_id,
                        analysis,
                        node_index,
                        ctx,
                        assigned_expression_cache,
                        visited_function_ids,
                    )
                },
            )
        }
        Expression::ConditionalExpression(conditional) => {
            r3f_webgpu_async_init_return_expression_matches(
                &conditional.consequent,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            ) || r3f_webgpu_async_init_return_expression_matches(
                &conditional.alternate,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            )
        }
        Expression::LogicalExpression(logical) => {
            r3f_webgpu_async_init_return_expression_matches(
                &logical.left,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            ) || r3f_webgpu_async_init_return_expression_matches(
                &logical.right,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            )
        }
        _ => false,
    }
}

fn r3f_webgpu_async_init_is_renderer_allocation<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    r3f_webgpu_async_init_is_renderer_allocation_from_modules(
        expression,
        &THREE_WEBGPU_MODULES,
        analysis,
        ctx,
    )
}

fn r3f_webgpu_async_init_zero_argument_function_id(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let Expression::Identifier(identifier) = &call_expression.callee else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function)
            if !function.r#async && !function.generator && function.params.items.is_empty() =>
        {
            Some(declaration.id())
        }
        AstKind::VariableDeclarator(declarator) => {
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
            let initializer = declarator.init.as_ref()?.get_inner_expression();
            match initializer {
                Expression::ArrowFunctionExpression(function)
                    if !function.r#async && function.params.items.is_empty() =>
                {
                    Some(function.node_id.get())
                }
                Expression::FunctionExpression(function)
                    if !function.r#async
                        && !function.generator
                        && function.params.items.is_empty() =>
                {
                    Some(function.node_id.get())
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn r3f_webgpu_async_init_has_dominating_initialization<'a>(
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if !r3f_webgpu_async_init_is_async_function(callback_id, ctx)
        || matches!(
            ctx.nodes().get_node(callback_id).kind(),
            AstKind::Function(function) if function.generator
        )
    {
        return false;
    }
    let return_starts = r3f_webgpu_async_init_return_starts(callback_id, node_index, ctx);
    let mut has_initialization = false;
    for_each_analyzed_synchronous_execution_node(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, _| {
            if has_initialization || is_node_conditionally_executed(candidate, callback_id, ctx) {
                return;
            }
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return;
            };
            let Some(callee) = call_expression.callee.as_member_expression() else {
                return;
            };
            if callee.static_property_name() != Some("init")
                || !r3f_webgpu_async_init_resolves_to_renderer(
                    callee.object(),
                    analysis,
                    ctx,
                    &mut Vec::new(),
                )
                || !r3f_webgpu_async_init_call_is_awaited(candidate, ctx)
                || return_starts
                    .iter()
                    .any(|return_start| *return_start < candidate.span().start)
            {
                return;
            }
            has_initialization = true;
        },
    );
    has_initialization
}

fn r3f_webgpu_async_init_return_starts(
    callback_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> Vec<u32> {
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(callback_id).kind()
        && let Some(expression) = function.get_expression()
    {
        return vec![expression.span().start];
    }
    node_index
        .node_ids(callback_id)
        .iter()
        .filter_map(|candidate_id| {
            matches!(
                ctx.nodes().get_node(*candidate_id).kind(),
                AstKind::ReturnStatement(_)
            )
            .then_some(ctx.nodes().get_node(*candidate_id).span().start)
        })
        .collect()
}

fn r3f_webgpu_async_init_call_is_awaited<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let expression_root = transparent_expression_root(node, ctx);
    matches!(
        ctx.nodes().parent_node(expression_root.id()).kind(),
        AstKind::AwaitExpression(await_expression)
            if await_expression.argument.span() == expression_root.span()
    )
}

fn r3f_webgpu_async_init_resolves_to_renderer<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if r3f_webgpu_async_init_is_renderer_allocation_from_modules(
        expression,
        &THREE_MODULES,
        analysis,
        ctx,
    ) {
        return true;
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
            r3f_webgpu_async_init_resolves_to_renderer(
                initializer,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn r3f_webgpu_async_init_is_renderer_allocation_from_modules<'a>(
    expression: &Expression<'a>,
    module_sources: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::NewExpression(allocation) = expression.get_inner_expression() else {
        return false;
    };
    module_api_reference_matches(
        &allocation.callee,
        "WebGPURenderer",
        module_sources,
        analysis,
        ctx,
    ) || type_import_module_api_reference_matches(
        &allocation.callee,
        "WebGPURenderer",
        module_sources,
        analysis,
        ctx,
    )
}

fn r3f_webgpu_async_init_possible_assigned_expressions<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    cache: &mut R3fWebgpuAsyncInitAssignedExpressionCache<'a>,
) -> Vec<&'a Expression<'a>> {
    let cache_key = (symbol_id, identifier.node_id.get());
    if let Some(expressions) = cache.expressions_by_symbol_and_reference.get(&cache_key) {
        return expressions.clone();
    }
    let expressions =
        r3f_webgpu_async_init_compute_possible_assigned_expressions(identifier, symbol_id, ctx);
    cache
        .expressions_by_symbol_and_reference
        .insert(cache_key, expressions.clone());
    expressions
}

fn r3f_webgpu_async_init_compute_possible_assigned_expressions<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Vec<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Vec::new();
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return Vec::new();
    }
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return Vec::new();
    };
    if variable_declaration.kind.is_const() {
        return declarator.init.iter().collect();
    }
    if !matches!(
        variable_declaration.kind,
        oxc_ast::ast::VariableDeclarationKind::Let | oxc_ast::ast::VariableDeclarationKind::Var
    ) {
        return Vec::new();
    }
    let reference_node = ctx.nodes().get_node(identifier.node_id.get());
    let Some(function_id) = local_callback_nearest_function_id(reference_node.id(), ctx) else {
        return Vec::new();
    };
    if local_callback_nearest_function_id(declaration.id(), ctx) != Some(function_id) {
        return Vec::new();
    }
    let reference_position = reference_node.span().start;
    let mut definitions = Vec::new();
    if let Some(initializer) = declarator.init.as_ref() {
        definitions.push((
            initializer,
            declaration.span().start,
            r3f_webgpu_async_init_definition_is_conditional(declaration, ctx),
            ctx.nodes().cfg_id(declaration.id()),
        ));
    }
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        if !reference.is_write() {
            continue;
        }
        let identifier_node = ctx.nodes().get_node(reference.node_id());
        if identifier_node.span().start >= reference_position
            || local_callback_nearest_function_id(identifier_node.id(), ctx) != Some(function_id)
        {
            continue;
        }
        let assignment_target_root = transparent_expression_root(identifier_node, ctx);
        let assignment_node = ctx.nodes().parent_node(assignment_target_root.id());
        let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
            continue;
        };
        if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign
            || assignment.left.span() != assignment_target_root.span()
        {
            continue;
        }
        definitions.push((
            &assignment.right,
            assignment_target_root.span().start,
            r3f_webgpu_async_init_definition_is_conditional(assignment_target_root, ctx),
            ctx.nodes().cfg_id(assignment_target_root.id()),
        ));
    }
    let mut definitions_by_block: FxHashMap<oxc_cfg::BlockNodeId, Vec<usize>> =
        FxHashMap::default();
    for (definition_id, (_, _, _, block_id)) in definitions.iter().enumerate() {
        definitions_by_block
            .entry(*block_id)
            .or_default()
            .push(definition_id);
    }
    for definition_ids in definitions_by_block.values_mut() {
        definition_ids.sort_by_key(|definition_id| definitions[*definition_id].1);
    }
    let graph = ctx.cfg().graph();
    let function_node = ctx.nodes().get_node(function_id);
    let entry_block = ctx.nodes().cfg_id(function_node.id());
    let mut reachable_blocks = FxHashSet::default();
    let mut pending_blocks = vec![entry_block];
    while let Some(block_id) = pending_blocks.pop() {
        if !reachable_blocks.insert(block_id) {
            continue;
        }
        for edge in graph.edges_directed(block_id, oxc_cfg::graph::Direction::Outgoing) {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction
                    | oxc_cfg::EdgeType::Unreachable
                    | oxc_cfg::EdgeType::Error(oxc_cfg::ErrorEdgeKind::Implicit)
            ) {
                continue;
            }
            pending_blocks.push(oxc_cfg::graph::visit::EdgeRef::target(&edge));
        }
    }
    let apply_definitions = |incoming: &FxHashSet<usize>, definition_ids: &[usize]| {
        let mut outgoing = incoming.clone();
        for definition_id in definition_ids {
            if !definitions[*definition_id].2 {
                outgoing.clear();
            }
            outgoing.insert(*definition_id);
        }
        outgoing
    };
    let mut incoming_by_block: FxHashMap<oxc_cfg::BlockNodeId, FxHashSet<usize>> =
        FxHashMap::default();
    let mut outgoing_by_block: FxHashMap<oxc_cfg::BlockNodeId, FxHashSet<usize>> =
        FxHashMap::default();
    let mut did_change = true;
    while did_change {
        did_change = false;
        for block_id in &reachable_blocks {
            let mut incoming = FxHashSet::default();
            for edge in graph.edges_directed(*block_id, oxc_cfg::graph::Direction::Incoming) {
                if matches!(
                    edge.weight(),
                    oxc_cfg::EdgeType::NewFunction
                        | oxc_cfg::EdgeType::Unreachable
                        | oxc_cfg::EdgeType::Error(oxc_cfg::ErrorEdgeKind::Implicit)
                ) {
                    continue;
                }
                let source = oxc_cfg::graph::visit::EdgeRef::source(&edge);
                if reachable_blocks.contains(&source) {
                    incoming.extend(
                        outgoing_by_block
                            .get(&source)
                            .into_iter()
                            .flatten()
                            .copied(),
                    );
                }
            }
            let outgoing = apply_definitions(
                &incoming,
                definitions_by_block
                    .get(block_id)
                    .map_or(&[], Vec::as_slice),
            );
            if incoming_by_block.get(block_id) != Some(&incoming)
                || outgoing_by_block.get(block_id) != Some(&outgoing)
            {
                incoming_by_block.insert(*block_id, incoming);
                outgoing_by_block.insert(*block_id, outgoing);
                did_change = true;
            }
        }
    }
    let reference_block = ctx.nodes().cfg_id(reference_node.id());
    if !reachable_blocks.contains(&reference_block) {
        return Vec::new();
    }
    let definitions_before_reference = definitions_by_block
        .get(&reference_block)
        .into_iter()
        .flatten()
        .copied()
        .filter(|definition_id| definitions[*definition_id].1 < reference_position)
        .collect::<Vec<_>>();
    let empty_incoming = FxHashSet::default();
    apply_definitions(
        incoming_by_block
            .get(&reference_block)
            .unwrap_or(&empty_incoming),
        &definitions_before_reference,
    )
    .into_iter()
    .map(|definition_id| definitions[definition_id].0)
    .collect()
}

fn r3f_webgpu_async_init_definition_is_conditional(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let block_id = ctx.nodes().cfg_id(node.id());
    for parent in ctx.nodes().ancestors(node.id()) {
        if ctx.nodes().cfg_id(parent.id()) != block_id {
            break;
        }
        if matches!(
            parent.kind(),
            AstKind::ConditionalExpression(_) | AstKind::LogicalExpression(_)
        ) {
            return true;
        }
    }
    false
}
