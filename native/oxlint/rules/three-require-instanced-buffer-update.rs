use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, FunctionType},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{AssignmentOperator, LogicalOperator};

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const BUFFER_PROPERTY_NAMES: [&str; 3] = ["instanceMatrix", "instanceColor", "morphTexture"];
const INSTANCED_METHOD_NAMES: [&str; 3] = ["setMatrixAt", "setColorAt", "setMorphAt"];
const SCENE_CONTAINER_NAMES: [&str; 3] = ["Group", "Object3D", "Scene"];
const SYNCHRONOUS_ITERATOR_METHOD_NAMES: [&str; 8] = [
    "every",
    "filter",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
];
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireInstancedBufferUpdate;

impl RuleMeta for ThreeRequireInstancedBufferUpdate {
    const NAME: &'static str = "three-require-instanced-buffer-update";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require instanced-mesh buffer uploads after instance changes.",
    };
}

struct ThreeInstancedBufferMutation {
    buffer_property_name: &'static str,
    method_name: &'static str,
    node_id: NodeId,
    receiver_id: NodeId,
    receiver_key: String,
}

struct ThreeInstancedBufferCompletion {
    buffer_property_name: &'static str,
    coverage_node_id: NodeId,
    node_id: NodeId,
    receiver_keys: rustc_hash::FxHashSet<String>,
}

struct ThreeInstancedMeshReceiverKeys {
    keys: rustc_hash::FxHashSet<String>,
    static_iteration_node_id: Option<NodeId>,
}

impl Rule for ThreeRequireInstancedBufferUpdate {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mutation_candidate_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(call_expression) = node.kind() else {
                    return None;
                };
                call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .and_then(static_member_expression_property_name)
                    .is_some_and(|method_name| INSTANCED_METHOD_NAMES.contains(&method_name))
                    .then_some(node.id())
            })
            .collect::<Vec<_>>();
        if mutation_candidate_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let mutations = mutation_candidate_ids
            .into_iter()
            .filter_map(|node_id| {
                let node = ctx.nodes().get_node(node_id);
                let AstKind::CallExpression(call_expression) = node.kind() else {
                    return None;
                };
                three_instanced_buffer_mutation(node, call_expression, &analysis, ctx)
            })
            .collect::<Vec<_>>();
        if mutations.is_empty() {
            return;
        }
        let mutation_node_ids = mutations
            .iter()
            .map(|mutation| mutation.node_id)
            .collect::<rustc_hash::FxHashSet<_>>();

        let mut completions = Vec::new();
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::AssignmentExpression(assignment) => {
                    if let Some(completion) =
                        three_instanced_buffer_completion(node, assignment, &analysis, ctx)
                    {
                        completions.push(completion);
                    }
                }
                AstKind::CallExpression(call_expression) => {
                    if !mutation_node_ids.contains(&node.id()) {
                        completions.extend(three_instanced_buffer_opaque_completions(
                            node,
                            call_expression,
                            &analysis,
                            ctx,
                            &mut resolution_cache,
                        ));
                    }
                }
                _ => {}
            }
        }

        let program_id = ctx
            .nodes()
            .iter()
            .find_map(|node| matches!(node.kind(), AstKind::Program(_)).then_some(node.id()));
        let Some(program_id) = program_id else {
            return;
        };
        for mutation in mutations {
            if three_instanced_buffer_is_pre_escape_initialization(&mutation, &analysis, ctx)
                || three_instanced_buffer_completion_covers_mutation(
                    &mutation,
                    &completions,
                    program_id,
                    ctx,
                )
            {
                continue;
            }
            let message = format!(
                "After {}, set {}.needsUpdate to true so Three.js uploads the changed instance data",
                mutation.method_name, mutation.buffer_property_name
            );
            ctx.diagnostic(
                OxcDiagnostic::error(message)
                    .with_label(ctx.nodes().get_node(mutation.node_id).span()),
            );
        }
    }
}

fn three_instanced_buffer_method_names(method_name: &str) -> Option<(&'static str, &'static str)> {
    match method_name {
        "setMatrixAt" => Some(("setMatrixAt", "instanceMatrix")),
        "setColorAt" => Some(("setColorAt", "instanceColor")),
        "setMorphAt" => Some(("setMorphAt", "morphTexture")),
        _ => None,
    }
}

fn three_instanced_buffer_mutation<'a>(
    node: &AstNode<'a>,
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<ThreeInstancedBufferMutation> {
    let member_expression = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()?;
    let (method_name, buffer_property_name) = three_instanced_buffer_method_names(
        static_member_expression_property_name(member_expression)?,
    )?;
    if !three_instanced_buffer_resolves_to_constructor(
        member_expression.object(),
        "InstancedMesh",
        analysis,
        ctx,
        &mut Vec::new(),
    ) {
        return None;
    }
    Some(ThreeInstancedBufferMutation {
        buffer_property_name,
        method_name,
        node_id: node.id(),
        receiver_id: member_expression.object().node_id(),
        receiver_key: resolve_expression_key(member_expression.object(), ctx, &mut Vec::new())?,
    })
}

fn three_instanced_mesh_receiver_keys<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> ThreeInstancedMeshReceiverKeys {
    let mut keys = rustc_hash::FxHashSet::default();
    if let Some(receiver_key) = resolve_expression_key(expression, ctx, &mut Vec::new()) {
        keys.insert(receiver_key);
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return ThreeInstancedMeshReceiverKeys {
            keys,
            static_iteration_node_id: None,
        };
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return ThreeInstancedMeshReceiverKeys {
            keys,
            static_iteration_node_id: None,
        };
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(_) = declaration.kind() else {
        return ThreeInstancedMeshReceiverKeys {
            keys,
            static_iteration_node_id: None,
        };
    };
    let variable_declaration = ctx.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(_) = variable_declaration.kind() else {
        return ThreeInstancedMeshReceiverKeys {
            keys,
            static_iteration_node_id: None,
        };
    };
    let for_of_node = ctx.nodes().parent_node(variable_declaration.id());
    let AstKind::ForOfStatement(for_of_statement) = for_of_node.kind() else {
        return ThreeInstancedMeshReceiverKeys {
            keys,
            static_iteration_node_id: None,
        };
    };
    let oxc_ast::ast::ForStatementLeft::VariableDeclaration(left_declaration) =
        &for_of_statement.left
    else {
        return ThreeInstancedMeshReceiverKeys {
            keys,
            static_iteration_node_id: None,
        };
    };
    if left_declaration.span != variable_declaration.span() {
        return ThreeInstancedMeshReceiverKeys {
            keys,
            static_iteration_node_id: None,
        };
    }
    let Expression::ArrayExpression(collection) = for_of_statement.right.get_inner_expression()
    else {
        return ThreeInstancedMeshReceiverKeys {
            keys,
            static_iteration_node_id: None,
        };
    };
    if collection.elements.is_empty() {
        return ThreeInstancedMeshReceiverKeys {
            keys,
            static_iteration_node_id: None,
        };
    }
    for element in &collection.elements {
        if let Some(element_expression) = element.as_expression()
            && let Some(element_key) =
                resolve_expression_key(element_expression, ctx, &mut Vec::new())
        {
            keys.insert(element_key);
        }
    }
    ThreeInstancedMeshReceiverKeys {
        keys,
        static_iteration_node_id: Some(for_of_node.id()),
    }
}

fn three_instanced_buffer_completion<'a>(
    node: &AstNode<'a>,
    assignment: &oxc_ast::ast::AssignmentExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<ThreeInstancedBufferCompletion> {
    if assignment.operator != AssignmentOperator::Assign
        || !matches!(
            assignment.right.get_inner_expression(),
            Expression::BooleanLiteral(literal) if literal.value
        )
    {
        return None;
    }
    let needs_update_member = assignment.left.as_member_expression().or_else(|| {
        assignment
            .left
            .get_expression()?
            .get_inner_expression()
            .as_member_expression()
    })?;
    if static_member_expression_property_name(needs_update_member) != Some("needsUpdate") {
        return None;
    }
    let buffer_member = needs_update_member
        .object()
        .get_inner_expression()
        .as_member_expression()?;
    let buffer_property_name = BUFFER_PROPERTY_NAMES
        .iter()
        .copied()
        .find(|property_name| {
            static_member_expression_property_name(buffer_member) == Some(*property_name)
        })?;
    let receiver_proof = three_instanced_mesh_receiver_keys(buffer_member.object(), ctx);
    if !three_instanced_buffer_resolves_to_constructor(
        buffer_member.object(),
        "InstancedMesh",
        analysis,
        ctx,
        &mut Vec::new(),
    ) && receiver_proof.keys.len() < 2
    {
        return None;
    }
    (!receiver_proof.keys.is_empty()).then_some(ThreeInstancedBufferCompletion {
        buffer_property_name,
        coverage_node_id: receiver_proof.static_iteration_node_id.unwrap_or(node.id()),
        node_id: node.id(),
        receiver_keys: receiver_proof.keys,
    })
}

fn three_instanced_buffer_opaque_completions<'a>(
    node: &AstNode<'a>,
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<ThreeInstancedBufferCompletion> {
    if !is_imported_or_stable_parameter_call(call_expression, ctx, resolution_cache) {
        return Vec::new();
    }
    let mut completions = Vec::new();
    for argument in &call_expression.arguments {
        let Some(candidate) = argument
            .as_expression()
            .map(Expression::get_inner_expression)
        else {
            continue;
        };
        if let Some(buffer_member) = candidate.as_member_expression()
            && let Some(buffer_property_name) =
                BUFFER_PROPERTY_NAMES.iter().copied().find(|property_name| {
                    static_member_expression_property_name(buffer_member) == Some(*property_name)
                })
            && three_instanced_buffer_resolves_to_constructor(
                buffer_member.object(),
                "InstancedMesh",
                analysis,
                ctx,
                &mut Vec::new(),
            )
        {
            let receiver_proof = three_instanced_mesh_receiver_keys(buffer_member.object(), ctx);
            if !receiver_proof.keys.is_empty() {
                completions.push(ThreeInstancedBufferCompletion {
                    buffer_property_name,
                    coverage_node_id: receiver_proof.static_iteration_node_id.unwrap_or(node.id()),
                    node_id: node.id(),
                    receiver_keys: receiver_proof.keys,
                });
            }
            continue;
        }
        if !three_instanced_buffer_resolves_to_constructor(
            candidate,
            "InstancedMesh",
            analysis,
            ctx,
            &mut Vec::new(),
        ) {
            continue;
        }
        let receiver_proof = three_instanced_mesh_receiver_keys(candidate, ctx);
        if receiver_proof.keys.is_empty() {
            continue;
        }
        let coverage_node_id = receiver_proof.static_iteration_node_id.unwrap_or(node.id());
        completions.extend(BUFFER_PROPERTY_NAMES.map(|buffer_property_name| {
            ThreeInstancedBufferCompletion {
                buffer_property_name,
                coverage_node_id,
                node_id: node.id(),
                receiver_keys: receiver_proof.keys.clone(),
            }
        }));
    }
    completions
}

fn three_instanced_buffer_expression_matches_completion<'a>(
    expression: &Expression<'a>,
    completion: &ThreeInstancedBufferCompletion,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(buffer_member) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    static_member_expression_property_name(buffer_member) == Some(completion.buffer_property_name)
        && resolve_expression_key(buffer_member.object(), ctx, &mut Vec::new())
            .is_some_and(|key| completion.receiver_keys.contains(&key))
}

fn three_instanced_buffer_is_mutation_flag_guard<'a>(
    expression: &Expression<'a>,
    mutation: &ThreeInstancedBufferMutation,
    completion: &ThreeInstancedBufferCompletion,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        declarator.init.as_ref().map(Expression::get_inner_expression),
        Some(Expression::BooleanLiteral(literal)) if !literal.value
    ) {
        return false;
    }
    let mut true_assignment_nodes = Vec::new();
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let parent = ctx.nodes().parent_node(reference_node.id());
        let AstKind::AssignmentExpression(assignment) = parent.kind() else {
            continue;
        };
        if assignment.left.span() != reference_node.span() {
            continue;
        }
        if assignment.operator != AssignmentOperator::Assign
            || !matches!(
                assignment.right.get_inner_expression(),
                Expression::BooleanLiteral(literal) if literal.value
            )
        {
            return false;
        }
        if parent.span().start
            < ctx
                .nodes()
                .get_node(completion.coverage_node_id)
                .span()
                .start
        {
            true_assignment_nodes.push(parent);
        }
    }
    let Some(owner) =
        crate::ast_util::get_enclosing_function(ctx.nodes().get_node(mutation.node_id), ctx)
    else {
        return false;
    };
    !true_assignment_nodes.is_empty()
        && do_nodes_cover_every_path_after_node(
            ctx.nodes().get_node(mutation.node_id),
            &true_assignment_nodes,
            owner,
            ctx,
        )
}

fn three_instanced_buffer_guard_guaranteed_after_mutation<'a>(
    expression: &Expression<'a>,
    mutation: &ThreeInstancedBufferMutation,
    completion: &ThreeInstancedBufferCompletion,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::LogicalExpression(logical_expression) = expression
        && logical_expression.operator == LogicalOperator::And
    {
        return three_instanced_buffer_guard_guaranteed_after_mutation(
            &logical_expression.left,
            mutation,
            completion,
            ctx,
        ) && three_instanced_buffer_guard_guaranteed_after_mutation(
            &logical_expression.right,
            mutation,
            completion,
            ctx,
        );
    }
    three_instanced_buffer_expression_matches_completion(expression, completion, ctx)
        || three_instanced_buffer_is_mutation_flag_guard(expression, mutation, completion, ctx)
}

fn three_instanced_buffer_completion_has_matching_guard<'a>(
    mutation: &ThreeInstancedBufferMutation,
    completion: &ThreeInstancedBufferCompletion,
    owner: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let completion_node = ctx.nodes().get_node(completion.node_id);
    if ctx
        .nodes()
        .get_node(completion.coverage_node_id)
        .span()
        .start
        <= ctx.nodes().get_node(mutation.node_id).span().start
    {
        return false;
    }
    let mut current_child = completion_node;
    let mut current_ancestor = ctx.nodes().parent_node(completion_node.id());
    while current_ancestor.id() != owner.id() {
        if let AstKind::IfStatement(if_statement) = current_ancestor.kind()
            && if_statement.consequent.span() == current_child.span()
            && !is_node_conditionally_executed(completion_node, current_child.id(), ctx)
            && three_instanced_buffer_guard_guaranteed_after_mutation(
                &if_statement.test,
                mutation,
                completion,
                ctx,
            )
        {
            return true;
        }
        current_child = current_ancestor;
        current_ancestor = ctx.nodes().parent_node(current_ancestor.id());
    }
    false
}

fn three_instanced_buffer_direct_local_function_call_sites<'a>(
    function_id: NodeId,
    ctx: &LintContext<'a>,
) -> Option<Vec<NodeId>> {
    let function_node = ctx.nodes().get_node(function_id);
    let symbol_id = match function_node.kind() {
        AstKind::Function(function) if function.r#type == FunctionType::FunctionDeclaration => {
            function.id.as_ref()?.symbol_id()
        }
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
            let parent = ctx.nodes().parent_node(function_id);
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                return None;
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.node_id() != function_id)
            {
                return None;
            }
            declarator.id.get_binding_identifier()?.symbol_id()
        }
        _ => return None,
    };
    let mut call_site_ids = Vec::new();
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let parent = ctx.nodes().parent_node(reference_node.id());
        let AstKind::CallExpression(call_expression) = parent.kind() else {
            return None;
        };
        if call_expression.callee.span() != reference_node.span() {
            return None;
        }
        call_site_ids.push(parent.id());
    }
    (!call_site_ids.is_empty()).then_some(call_site_ids)
}

fn three_instanced_buffer_completion_covers_mutation<'a>(
    mutation: &ThreeInstancedBufferMutation,
    completions: &[ThreeInstancedBufferCompletion],
    program_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    three_instanced_buffer_completion_covers_anchor(
        mutation,
        mutation.node_id,
        completions,
        program_id,
        ctx,
        &mut Vec::new(),
    )
}

#[allow(clippy::too_many_arguments)]
fn three_instanced_buffer_completion_covers_anchor<'a>(
    mutation: &ThreeInstancedBufferMutation,
    initial_anchor_id: NodeId,
    completions: &[ThreeInstancedBufferCompletion],
    program_id: NodeId,
    ctx: &LintContext<'a>,
    visited_function_ids: &mut Vec<NodeId>,
) -> bool {
    let mut path_anchor = ctx.nodes().get_node(initial_anchor_id);
    loop {
        let owner = crate::ast_util::get_enclosing_function(path_anchor, ctx);
        let matching_completions = completions
            .iter()
            .filter(|completion| {
                completion.receiver_keys.contains(&mutation.receiver_key)
                    && completion.buffer_property_name == mutation.buffer_property_name
                    && crate::ast_util::get_enclosing_function(
                        ctx.nodes().get_node(completion.coverage_node_id),
                        ctx,
                    )
                    .map(AstNode::id)
                        == owner.map(AstNode::id)
            })
            .collect::<Vec<_>>();
        let Some(owner) = owner else {
            return matching_completions.iter().any(|completion| {
                let coverage_node = ctx.nodes().get_node(completion.coverage_node_id);
                coverage_node.span().start > path_anchor.span().start
                    && !is_node_conditionally_executed(coverage_node, program_id, ctx)
            });
        };
        if matching_completions.iter().any(|completion| {
            three_instanced_buffer_completion_has_matching_guard(mutation, completion, owner, ctx)
        }) {
            return true;
        }
        let matching_coverage_nodes = matching_completions
            .iter()
            .map(|completion| ctx.nodes().get_node(completion.coverage_node_id))
            .collect::<Vec<_>>();
        if do_nodes_cover_every_path_after_node(path_anchor, &matching_coverage_nodes, owner, ctx) {
            return true;
        }
        if !three_instanced_buffer_is_synchronous_function(owner) {
            return false;
        }
        if three_instanced_buffer_is_synchronous_iterator_callback(owner, ctx) {
            path_anchor = ctx.nodes().parent_node(owner.id());
            continue;
        }
        if visited_function_ids.contains(&owner.id()) {
            return false;
        }
        let Some(call_site_ids) =
            three_instanced_buffer_direct_local_function_call_sites(owner.id(), ctx)
        else {
            return false;
        };
        visited_function_ids.push(owner.id());
        let all_covered = call_site_ids.into_iter().all(|call_site_id| {
            three_instanced_buffer_completion_covers_anchor(
                mutation,
                call_site_id,
                completions,
                program_id,
                ctx,
                visited_function_ids,
            )
        });
        visited_function_ids.pop();
        return all_covered;
    }
}

fn three_instanced_buffer_is_synchronous_function(node: &AstNode<'_>) -> bool {
    match node.kind() {
        AstKind::Function(function) => !function.r#async && !function.generator,
        AstKind::ArrowFunctionExpression(function) => !function.r#async,
        _ => false,
    }
}

fn three_instanced_buffer_is_synchronous_iterator_callback<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if !three_instanced_buffer_is_synchronous_function(function_node) {
        return false;
    }
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    let Some(member_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let callback_index = if static_member_expression_property_name(member_expression)
        == Some("from")
        && matches!(
            member_expression.object().get_inner_expression(),
            Expression::Identifier(identifier) if identifier.name == "Array"
        ) {
        1
    } else if static_member_expression_property_name(member_expression)
        .is_some_and(|method_name| SYNCHRONOUS_ITERATOR_METHOD_NAMES.contains(&method_name))
    {
        0
    } else {
        return false;
    };
    call_expression
        .arguments
        .get(callback_index)
        .and_then(Argument::as_expression)
        .is_some_and(|callback| callback.node_id() == function_node.id())
}

fn three_instanced_buffer_is_pre_escape_initialization<'a>(
    mutation: &ThreeInstancedBufferMutation,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let receiver = ctx.nodes().get_node(mutation.receiver_id);
    let AstKind::IdentifierReference(identifier) = receiver.kind() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
        || !declarator.init.as_ref().is_some_and(|initializer| {
            matches!(initializer, Expression::NewExpression(_))
                && three_instanced_buffer_resolves_to_constructor(
                    initializer,
                    "InstancedMesh",
                    analysis,
                    ctx,
                    &mut Vec::new(),
                )
        })
    {
        return false;
    }
    let mut mutation_owner =
        crate::ast_util::get_enclosing_function(ctx.nodes().get_node(mutation.node_id), ctx);
    while let Some(owner) = mutation_owner
        .filter(|owner| three_instanced_buffer_is_synchronous_iterator_callback(owner, ctx))
    {
        mutation_owner =
            crate::ast_util::get_enclosing_function(ctx.nodes().parent_node(owner.id()), ctx);
    }
    if crate::ast_util::get_enclosing_function(declaration, ctx).map(AstNode::id)
        != mutation_owner.map(AstNode::id)
    {
        return false;
    }
    let mutation_start = ctx.nodes().get_node(mutation.node_id).span().start;
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .all(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            reference_node.span().start >= mutation_start
                || three_instanced_buffer_is_non_escaping_reference(reference_node, analysis, ctx)
        })
}

fn three_instanced_buffer_is_direct_non_escaping_reference<'a>(
    reference: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut reference_root = reference;
    loop {
        let parent = ctx.nodes().parent_node(reference_root.id());
        let Some(member_expression) = parent.kind().as_member_expression_kind() else {
            break;
        };
        if member_expression.object().span() != reference_root.span() {
            break;
        }
        reference_root = parent;
    }
    let parent = ctx.nodes().parent_node(reference_root.id());
    match parent.kind() {
        AstKind::CallExpression(call_expression) => {
            call_expression.callee.span() == reference_root.span()
        }
        AstKind::AssignmentExpression(assignment) => {
            assignment.left.span() == reference_root.span()
        }
        AstKind::UpdateExpression(update) => update.argument.span() == reference_root.span(),
        _ => false,
    }
}

fn three_instanced_buffer_is_non_escaping_reference<'a>(
    reference: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    if three_instanced_buffer_is_direct_non_escaping_reference(reference, ctx) {
        return true;
    }
    let mut reference_root = reference;
    loop {
        let parent = ctx.nodes().parent_node(reference_root.id());
        let Some(member_expression) = parent.kind().as_member_expression_kind() else {
            break;
        };
        if member_expression.object().span() != reference_root.span() {
            break;
        }
        reference_root = parent;
    }
    let parent = ctx.nodes().parent_node(reference_root.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    let Some(argument_index) = call_expression
        .arguments
        .iter()
        .position(|argument| argument.span() == reference_root.span())
    else {
        return false;
    };
    if let Some(member_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
        && static_member_expression_property_name(member_expression) == Some("add")
        && SCENE_CONTAINER_NAMES.iter().any(|constructor_name| {
            three_instanced_buffer_resolves_to_constructor(
                member_expression.object(),
                constructor_name,
                analysis,
                ctx,
                &mut Vec::new(),
            )
        })
    {
        return true;
    }
    three_instanced_buffer_same_class_method_keeps_argument_local(
        call_expression,
        argument_index,
        ctx,
    )
}

fn three_instanced_buffer_same_class_method_keeps_argument_local<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    argument_index: usize,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if !matches!(
        member_expression.object().get_inner_expression(),
        Expression::ThisExpression(_)
    ) {
        return false;
    }
    let Some(method_name) = static_member_expression_property_name(member_expression) else {
        return false;
    };
    let Some(caller) = crate::ast_util::get_enclosing_function(
        ctx.nodes().get_node(call_expression.node_id.get()),
        ctx,
    ) else {
        return false;
    };
    let caller_definition = ctx.nodes().parent_node(caller.id());
    let AstKind::MethodDefinition(caller_method) = caller_definition.kind() else {
        return false;
    };
    if caller_method.value.node_id.get() != caller.id() {
        return false;
    }
    let class_body_node = ctx.nodes().parent_node(caller_definition.id());
    let AstKind::ClassBody(class_body) = class_body_node.kind() else {
        return false;
    };
    let Some(method) = class_body.body.iter().find_map(|element| {
        let oxc_ast::ast::ClassElement::MethodDefinition(method) = element else {
            return None;
        };
        (!method.r#static
            && three_instanced_buffer_method_key_matches(&method.key, method.computed, method_name))
        .then_some(method)
    }) else {
        return false;
    };
    let Some(parameter) = method.value.params.items.get(argument_index) else {
        return false;
    };
    let oxc_ast::ast::BindingPattern::BindingIdentifier(binding) = &parameter.pattern else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(binding.symbol_id())
        .all(|reference| {
            three_instanced_buffer_is_direct_non_escaping_reference(
                ctx.nodes().get_node(reference.node_id()),
                ctx,
            )
        })
}

fn three_instanced_buffer_method_key_matches(
    key: &oxc_ast::ast::PropertyKey<'_>,
    computed: bool,
    method_name: &str,
) -> bool {
    if !computed {
        return match key {
            oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => {
                identifier.name == method_name
            }
            oxc_ast::ast::PropertyKey::StringLiteral(literal) => literal.value == method_name,
            _ => false,
        };
    }
    match key {
        oxc_ast::ast::PropertyKey::StringLiteral(literal) => literal.value == method_name,
        oxc_ast::ast::PropertyKey::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            quasi
                .value
                .cooked
                .as_ref()
                .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                == method_name
        }
        _ => false,
    }
}

fn three_instanced_buffer_resolves_to_constructor<'a>(
    expression: &Expression<'a>,
    constructor_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(new_expression) = expression {
        return module_api_reference_matches(
            &new_expression.callee,
            constructor_name,
            &THREE_MODULES,
            analysis,
            ctx,
        ) || type_import_module_api_reference_matches(
            &new_expression.callee,
            constructor_name,
            &THREE_MODULES,
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
            three_instanced_buffer_resolves_to_constructor(
                initializer,
                constructor_name,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}
