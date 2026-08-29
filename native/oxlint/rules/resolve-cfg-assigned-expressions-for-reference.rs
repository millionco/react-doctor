use oxc_ast::{AstKind as AssignedExpressionAstKind, ast::Expression as AssignedExpression};
use oxc_span::GetSpan as AssignedExpressionGetSpan;

use crate::context::LintContext as AssignedExpressionLintContext;

struct PossibleAssignedExpressionCache<'a> {
    expressions_by_symbol_and_reference: rustc_hash::FxHashMap<
        (oxc_semantic::SymbolId, oxc_semantic::NodeId),
        Vec<&'a AssignedExpression<'a>>,
    >,
}

impl Default for PossibleAssignedExpressionCache<'_> {
    fn default() -> Self {
        Self {
            expressions_by_symbol_and_reference: rustc_hash::FxHashMap::default(),
        }
    }
}

fn resolve_cfg_assigned_expressions_for_reference<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &AssignedExpressionLintContext<'a>,
    cache: &mut PossibleAssignedExpressionCache<'a>,
) -> Vec<&'a AssignedExpression<'a>> {
    let cache_key = (symbol_id, identifier.node_id.get());
    if let Some(expressions) = cache.expressions_by_symbol_and_reference.get(&cache_key) {
        return expressions.clone();
    }
    let expressions = compute_possible_assigned_expressions(identifier, symbol_id, ctx);
    cache
        .expressions_by_symbol_and_reference
        .insert(cache_key, expressions.clone());
    expressions
}

fn compute_possible_assigned_expressions<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &AssignedExpressionLintContext<'a>,
) -> Vec<&'a AssignedExpression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AssignedExpressionAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Vec::new();
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return Vec::new();
    }
    let AssignedExpressionAstKind::VariableDeclaration(variable_declaration) =
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
    let function_node = ctx.nodes().get_node(function_id);
    if local_callback_nearest_function_id(declaration.id(), ctx) != Some(function_id) {
        return Vec::new();
    }
    let reference_position = reference_node.span().start;
    let mut definitions = Vec::new();
    if let Some(initializer) = declarator.init.as_ref() {
        definitions.push((
            initializer,
            declaration.span().start,
            assigned_expression_definition_is_conditional(declaration, ctx),
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
        let AssignedExpressionAstKind::AssignmentExpression(assignment) = assignment_node.kind()
        else {
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
            assigned_expression_definition_is_conditional(assignment_target_root, ctx),
            ctx.nodes().cfg_id(assignment_target_root.id()),
        ));
    }
    let mut definitions_by_block: rustc_hash::FxHashMap<oxc_cfg::BlockNodeId, Vec<usize>> =
        rustc_hash::FxHashMap::default();
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
    let entry_block = ctx.nodes().cfg_id(function_node.id());
    let mut reachable_blocks = rustc_hash::FxHashSet::default();
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
    let apply_definitions = |incoming: &rustc_hash::FxHashSet<usize>, definition_ids: &[usize]| {
        let mut outgoing = incoming.clone();
        for definition_id in definition_ids {
            if !definitions[*definition_id].2 {
                outgoing.clear();
            }
            outgoing.insert(*definition_id);
        }
        outgoing
    };
    let mut incoming_by_block: rustc_hash::FxHashMap<
        oxc_cfg::BlockNodeId,
        rustc_hash::FxHashSet<usize>,
    > = rustc_hash::FxHashMap::default();
    let mut outgoing_by_block: rustc_hash::FxHashMap<
        oxc_cfg::BlockNodeId,
        rustc_hash::FxHashSet<usize>,
    > = rustc_hash::FxHashMap::default();
    let mut did_change = true;
    while did_change {
        did_change = false;
        for block_id in &reachable_blocks {
            let mut incoming = rustc_hash::FxHashSet::default();
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
    let empty_incoming = rustc_hash::FxHashSet::default();
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

fn assigned_expression_definition_is_conditional(
    node: &crate::AstNode<'_>,
    ctx: &AssignedExpressionLintContext<'_>,
) -> bool {
    let block_id = ctx.nodes().cfg_id(node.id());
    for parent in ctx.nodes().ancestors(node.id()) {
        if ctx.nodes().cfg_id(parent.id()) != block_id {
            break;
        }
        if matches!(
            parent.kind(),
            AssignedExpressionAstKind::ConditionalExpression(_)
                | AssignedExpressionAstKind::LogicalExpression(_)
        ) {
            return true;
        }
    }
    false
}
