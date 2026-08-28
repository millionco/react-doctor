use oxc_ast::{
    AstKind,
    ast::{Argument, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{AssignmentOperator, LogicalOperator, UnaryOperator};

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_INSTANCED_BUFFER_METHOD_NAMES: [&str; 3] = ["setMatrixAt", "setColorAt", "setMorphAt"];
const R3F_INSTANCED_BUFFER_PROPERTY_NAMES: [&str; 3] =
    ["instanceMatrix", "instanceColor", "morphTexture"];
const R3F_INSTANCED_BUFFER_SYNCHRONOUS_ITERATOR_METHOD_NAMES: [&str; 8] = [
    "every",
    "filter",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
];

#[derive(Debug, Default, Clone)]
pub struct R3FRequireInstancedBufferUpdate;

impl RuleMeta for R3FRequireInstancedBufferUpdate {
    const NAME: &'static str = "r3f-require-instanced-buffer-update";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Instanced mesh buffer is not marked for upload",
    };
}

struct R3fInstancedBufferMutation {
    buffer_property_name: &'static str,
    method_name: &'static str,
    node_id: NodeId,
    ref_symbol_id: SymbolId,
}

struct R3fInstancedBufferCompletion {
    buffer_property_name: &'static str,
    node_id: NodeId,
    ref_symbol_id: SymbolId,
}

impl Rule for R3FRequireInstancedBufferUpdate {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !has_r3f_runtime_import(ctx) {
            return;
        }

        let managed_ref_symbol_ids = r3f_instanced_buffer_managed_ref_symbol_ids(ctx);
        if managed_ref_symbol_ids.is_empty() {
            return;
        }

        let mut mutations = Vec::new();
        let mut completions = Vec::new();
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::AssignmentExpression(assignment_expression) => {
                    if let Some(completion) =
                        r3f_instanced_buffer_update_completion(node, assignment_expression, ctx)
                    {
                        completions.push(completion);
                    }
                }
                AstKind::CallExpression(call_expression) => {
                    if let Some(mutation) =
                        r3f_instanced_buffer_mutation(node, call_expression, ctx)
                    {
                        mutations.push(mutation);
                    } else {
                        completions.extend(r3f_instanced_buffer_opaque_ref_transfers(
                            node,
                            call_expression,
                            ctx,
                            &mut resolution_cache,
                        ));
                    }
                }
                _ => {}
            }
        }

        for mutation in mutations {
            if !managed_ref_symbol_ids.contains(&mutation.ref_symbol_id)
                || r3f_instanced_buffer_completions_cover_every_path_after_mutation(
                    &mutation,
                    &completions,
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

fn r3f_instanced_buffer_managed_ref_symbol_ids<'a>(
    ctx: &LintContext<'a>,
) -> rustc_hash::FxHashSet<SymbolId> {
    let mut managed_ref_symbol_ids = rustc_hash::FxHashSet::default();
    for node in ctx.nodes().iter() {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            continue;
        };
        if !is_r3f_host_intrinsic(opening_element, ctx)
            || resolve_jsx_element_type(opening_element, ctx)
                .is_none_or(|(element_type, _)| element_type != "instancedMesh")
        {
            continue;
        }
        let Some(ref_expression) = get_authoritative_jsx_attribute(opening_element, "ref", true)
            .and_then(jsx_attribute_expression)
        else {
            continue;
        };
        if let Some(ref_symbol_id) = r3f_instanced_buffer_stable_ref_symbol_id(ref_expression, ctx)
        {
            managed_ref_symbol_ids.insert(ref_symbol_id);
        }
    }
    managed_ref_symbol_ids
}

fn r3f_instanced_buffer_stable_ref_symbol_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = r3f_instanced_buffer_const_alias_root_symbol_id(identifier, ctx)?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let is_stable_declaration = match declaration.kind() {
        AstKind::VariableDeclarator(_) => matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ),
        AstKind::FormalParameter(_) => true,
        _ => ctx
            .nodes()
            .ancestors(declaration.id())
            .take_while(|ancestor| {
                !matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })
            .any(|ancestor| matches!(ancestor.kind(), AstKind::FormalParameter(_))),
    };
    (is_stable_declaration
        && ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .all(|reference| !reference.is_write()))
    .then_some(symbol_id)
}

fn r3f_instanced_buffer_const_alias_root_symbol_id<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let mut symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let mut visited_symbol_ids = Vec::new();
    loop {
        if visited_symbol_ids.contains(&symbol_id) {
            return None;
        }
        visited_symbol_ids.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return Some(symbol_id);
        };
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
        let Expression::Identifier(next_identifier) = initializer else {
            return Some(symbol_id);
        };
        symbol_id = ctx
            .scoping()
            .get_reference(next_identifier.reference_id())
            .symbol_id()?;
    }
}

fn r3f_instanced_buffer_current_ref_symbol_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let member_expression = expression.get_inner_expression().as_member_expression()?;
    (member_expression.static_property_name() == Some("current"))
        .then(|| {
            r3f_instanced_buffer_stable_ref_symbol_id(
                member_expression.object().get_inner_expression(),
                ctx,
            )
        })
        .flatten()
}

fn r3f_instanced_buffer_is_direct_execution_root<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    match parent.kind() {
        AstKind::ExpressionStatement(statement) => statement.expression.span() == node.span(),
        AstKind::ReturnStatement(statement) => statement
            .argument
            .as_ref()
            .is_some_and(|argument| argument.span() == node.span()),
        AstKind::ArrowFunctionExpression(function) => function.body.span() == node.span(),
        _ => false,
    }
}

fn r3f_instanced_buffer_is_direct_executed_call<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut execution_root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(execution_root.id());
    let is_transparent_execution_wrapper = match parent.kind() {
        AstKind::AwaitExpression(await_expression) => {
            await_expression.argument.span() == execution_root.span()
        }
        AstKind::UnaryExpression(unary_expression) => {
            unary_expression.operator == UnaryOperator::Void
                && unary_expression.argument.span() == execution_root.span()
        }
        _ => false,
    };
    if is_transparent_execution_wrapper {
        execution_root = transparent_expression_root(parent, ctx);
    }
    r3f_instanced_buffer_is_direct_execution_root(execution_root, ctx)
}

fn r3f_instanced_buffer_names_for_method(
    method_name: &str,
) -> Option<(&'static str, &'static str)> {
    match method_name {
        "setMatrixAt" => Some(("setMatrixAt", "instanceMatrix")),
        "setColorAt" => Some(("setColorAt", "instanceColor")),
        "setMorphAt" => Some(("setMorphAt", "morphTexture")),
        _ => None,
    }
}

fn r3f_instanced_buffer_mutation<'a>(
    node: &AstNode<'a>,
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<R3fInstancedBufferMutation> {
    if !r3f_instanced_buffer_is_direct_executed_call(node, ctx) {
        return None;
    }
    let member_expression = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()?;
    let (method_name, buffer_property_name) =
        r3f_instanced_buffer_names_for_method(member_expression.static_property_name()?)?;
    let ref_symbol_id =
        r3f_instanced_buffer_current_ref_symbol_id(member_expression.object(), ctx)?;
    Some(R3fInstancedBufferMutation {
        buffer_property_name,
        method_name,
        node_id: node.id(),
        ref_symbol_id,
    })
}

fn r3f_instanced_buffer_update_completion<'a>(
    node: &AstNode<'a>,
    assignment_expression: &oxc_ast::ast::AssignmentExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<R3fInstancedBufferCompletion> {
    if assignment_expression.operator != AssignmentOperator::Assign
        || !matches!(
            assignment_expression.right.get_inner_expression(),
            Expression::BooleanLiteral(boolean_literal) if boolean_literal.value
        )
        || !r3f_instanced_buffer_is_direct_execution_root(
            transparent_expression_root(node, ctx),
            ctx,
        )
    {
        return None;
    }
    let needs_update_member = assignment_expression.left.as_member_expression()?;
    if needs_update_member.static_property_name() != Some("needsUpdate") {
        return None;
    }
    let buffer_member = needs_update_member
        .object()
        .get_inner_expression()
        .as_member_expression()?;
    let buffer_property_name = R3F_INSTANCED_BUFFER_PROPERTY_NAMES
        .iter()
        .copied()
        .find(|property_name| buffer_member.static_property_name() == Some(*property_name))?;
    let ref_symbol_id = r3f_instanced_buffer_current_ref_symbol_id(buffer_member.object(), ctx)?;
    Some(R3fInstancedBufferCompletion {
        buffer_property_name,
        node_id: node.id(),
        ref_symbol_id,
    })
}

fn r3f_instanced_buffer_opaque_ref_transfers<'a>(
    node: &AstNode<'a>,
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<R3fInstancedBufferCompletion> {
    if !r3f_instanced_buffer_is_direct_executed_call(node, ctx) {
        return Vec::new();
    }
    if call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
        .and_then(|member_expression| member_expression.static_property_name())
        .is_some_and(|method_name| R3F_INSTANCED_BUFFER_METHOD_NAMES.contains(&method_name))
        || !is_imported_or_stable_parameter_call(call_expression, ctx, resolution_cache)
    {
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
            && let Some(buffer_property_name) = R3F_INSTANCED_BUFFER_PROPERTY_NAMES
                .iter()
                .copied()
                .find(|property_name| buffer_member.static_property_name() == Some(*property_name))
        {
            if let Some(ref_symbol_id) =
                r3f_instanced_buffer_current_ref_symbol_id(buffer_member.object(), ctx)
            {
                completions.push(R3fInstancedBufferCompletion {
                    buffer_property_name,
                    node_id: node.id(),
                    ref_symbol_id,
                });
            }
            continue;
        }

        let ref_symbol_id = match candidate {
            Expression::Identifier(_) => r3f_instanced_buffer_stable_ref_symbol_id(candidate, ctx),
            _ => r3f_instanced_buffer_current_ref_symbol_id(candidate, ctx),
        };
        let Some(ref_symbol_id) = ref_symbol_id else {
            continue;
        };
        completions.extend(
            R3F_INSTANCED_BUFFER_PROPERTY_NAMES.map(|buffer_property_name| {
                R3fInstancedBufferCompletion {
                    buffer_property_name,
                    node_id: node.id(),
                    ref_symbol_id,
                }
            }),
        );
    }
    completions
}

fn r3f_instanced_buffer_expression_matches_completion_buffer<'a>(
    expression: &Expression<'a>,
    completion: &R3fInstancedBufferCompletion,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(buffer_member) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    buffer_member.static_property_name() == Some(completion.buffer_property_name)
        && r3f_instanced_buffer_current_ref_symbol_id(buffer_member.object(), ctx)
            == Some(completion.ref_symbol_id)
}

fn r3f_instanced_buffer_completion_guarded_by_matching_buffer<'a>(
    completion: &R3fInstancedBufferCompletion,
    owner: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let completion_node = ctx.nodes().get_node(completion.node_id);
    let mut current_child = completion_node;
    let mut current_ancestor = ctx.nodes().parent_node(completion_node.id());
    while current_ancestor.id() != owner.id() {
        let is_matching_guard = match current_ancestor.kind() {
            AstKind::IfStatement(if_statement)
                if if_statement.consequent.span() == current_child.span()
                    && !is_node_conditionally_executed(
                        completion_node,
                        current_child.id(),
                        ctx,
                    ) =>
            {
                r3f_instanced_buffer_expression_matches_completion_buffer(
                    &if_statement.test,
                    completion,
                    ctx,
                )
            }
            AstKind::ConditionalExpression(conditional_expression)
                if conditional_expression.consequent.span() == current_child.span() =>
            {
                r3f_instanced_buffer_expression_matches_completion_buffer(
                    &conditional_expression.test,
                    completion,
                    ctx,
                )
            }
            AstKind::LogicalExpression(logical_expression)
                if logical_expression.operator == LogicalOperator::And
                    && logical_expression.right.span() == current_child.span() =>
            {
                r3f_instanced_buffer_expression_matches_completion_buffer(
                    &logical_expression.left,
                    completion,
                    ctx,
                )
            }
            _ => false,
        };
        if is_matching_guard {
            return true;
        }
        current_child = current_ancestor;
        current_ancestor = ctx.nodes().parent_node(current_ancestor.id());
    }
    false
}

fn r3f_instanced_buffer_completions_cover_every_path_within_owner<'a>(
    path_anchor: &AstNode<'a>,
    owner: &AstNode<'a>,
    completions: &[&R3fInstancedBufferCompletion],
    ctx: &LintContext<'a>,
) -> bool {
    let mutation_start = path_anchor.span().start;
    if completions.iter().any(|completion| {
        let completion_node = ctx.nodes().get_node(completion.node_id);
        completion_node.span().start > mutation_start
            && r3f_instanced_buffer_completion_guarded_by_matching_buffer(completion, owner, ctx)
    }) {
        return true;
    }

    let mutation_block = ctx.nodes().cfg_id(path_anchor.id());
    let matching_blocks = completions
        .iter()
        .filter_map(|completion| {
            let completion_node = ctx.nodes().get_node(completion.node_id);
            let completion_block = ctx.nodes().cfg_id(completion_node.id());
            (completion_block != mutation_block || completion_node.span().start >= mutation_start)
                .then_some(completion_block)
        })
        .collect::<rustc_hash::FxHashSet<_>>();
    if matching_blocks.contains(&mutation_block) {
        return true;
    }

    let graph = ctx.cfg().graph();
    let mut visited_blocks = rustc_hash::FxHashSet::default();
    let mut pending_blocks = vec![mutation_block];
    while let Some(current_block) = pending_blocks.pop() {
        if !visited_blocks.insert(current_block) {
            continue;
        }
        for edge in graph.edges_directed(current_block, oxc_cfg::graph::Direction::Outgoing) {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction
                    | oxc_cfg::EdgeType::Unreachable
                    | oxc_cfg::EdgeType::Error(_)
            ) {
                continue;
            }
            let target = oxc_cfg::graph::visit::EdgeRef::target(&edge);
            if !matching_blocks.contains(&target) {
                pending_blocks.push(target);
            }
        }
        if ctx
            .cfg()
            .basic_block(current_block)
            .instructions()
            .iter()
            .any(|instruction| {
                matches!(
                    instruction.kind,
                    oxc_cfg::InstructionKind::ImplicitReturn | oxc_cfg::InstructionKind::Return(_)
                )
            })
        {
            return false;
        }
    }
    !matching_blocks.is_empty()
}

fn r3f_instanced_buffer_completions_cover_every_path_after_mutation<'a>(
    mutation: &R3fInstancedBufferMutation,
    completions: &[R3fInstancedBufferCompletion],
    ctx: &LintContext<'a>,
) -> bool {
    let mut path_anchor = ctx.nodes().get_node(mutation.node_id);
    let mut owner = crate::ast_util::get_enclosing_function(path_anchor, ctx);
    while let Some(current_owner) = owner {
        let matching_completions = completions
            .iter()
            .filter(|completion| {
                completion.ref_symbol_id == mutation.ref_symbol_id
                    && completion.buffer_property_name == mutation.buffer_property_name
                    && crate::ast_util::get_enclosing_function(
                        ctx.nodes().get_node(completion.node_id),
                        ctx,
                    )
                    .is_some_and(|completion_owner| completion_owner.id() == current_owner.id())
            })
            .collect::<Vec<_>>();
        if r3f_instanced_buffer_completions_cover_every_path_within_owner(
            path_anchor,
            current_owner,
            &matching_completions,
            ctx,
        ) {
            return true;
        }
        if !r3f_instanced_buffer_is_synchronous_iterator_callback(current_owner, ctx) {
            return false;
        }
        path_anchor = ctx.nodes().parent_node(current_owner.id());
        owner = crate::ast_util::get_enclosing_function(path_anchor, ctx);
    }
    true
}

fn r3f_instanced_buffer_is_synchronous_iterator_callback<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let is_synchronous_function = match function_node.kind() {
        AstKind::Function(function) => !function.r#async && !function.generator,
        AstKind::ArrowFunctionExpression(function) => !function.r#async,
        _ => false,
    };
    if !is_synchronous_function {
        return false;
    }
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    let Expression::StaticMemberExpression(member_expression) =
        call_expression.callee.get_inner_expression()
    else {
        return false;
    };
    let callback_argument_index = if member_expression.property.name == "from"
        && matches!(
            &member_expression.object,
            Expression::Identifier(identifier) if identifier.name == "Array"
        ) {
        1
    } else if R3F_INSTANCED_BUFFER_SYNCHRONOUS_ITERATOR_METHOD_NAMES
        .contains(&member_expression.property.name.as_str())
    {
        0
    } else {
        return false;
    };
    call_expression
        .arguments
        .get(callback_argument_index)
        .and_then(Argument::as_expression)
        .is_some_and(|callback| callback.span() == function_node.span())
}
