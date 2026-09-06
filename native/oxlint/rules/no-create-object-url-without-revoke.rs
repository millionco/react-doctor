use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, CallExpression, Expression, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "`URL.createObjectURL(...)` pins the underlying Blob/File in memory, and this produced URL is not provably revoked. Store the URL and pass that same value to `URL.revokeObjectURL` once you're done so the Blob can be freed.";
const ESCAPE_PROPERTIES: [&str; 3] = ["href", "src", "current"];

#[derive(Debug, Default, Clone)]
pub struct NoCreateObjectUrlWithoutRevoke;

#[derive(Clone, Copy)]
struct ProducedBinding {
    symbol_id: SymbolId,
    acquired_at: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ObjectUrlCacheRetentionKind {
    MapKey,
    MapValue,
    SetElement,
}

struct ObjectUrlCacheRetention {
    kind: ObjectUrlCacheRetentionKind,
    property_path: Vec<String>,
}

struct ObjectUrlAnalysis {
    calls_by_function: FxHashMap<NodeId, Vec<NodeId>>,
    first_global_url_method_write_by_name: FxHashMap<String, u32>,
    property_write_analysis: PossibleStaticPropertyWriteAnalysis,
}

declare_oxc_lint!(
    /// Require escaping object URLs to have a provable revocation path.
    NoCreateObjectUrlWithoutRevoke,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Require escaping object URLs to be revoked.",
);

impl Rule for NoCreateObjectUrlWithoutRevoke {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !ctx.nodes().iter().any(|node| {
            matches!(node.kind(), AstKind::CallExpression(call)
            if call.callee.get_inner_expression().as_member_expression().is_some_and(|member| {
                object_url_resolved_member_property_name(member, ctx).as_deref()
                    == Some("createObjectURL")
            }))
        }) {
            return;
        }
        let analysis = ObjectUrlAnalysis::build(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            if !object_url_is_url_method_call(node, call, "createObjectURL", &analysis, ctx)
                || !object_url_escape_is_leaky(node, ctx)
                || object_url_bound_creation_is_disposed(node, &analysis, ctx)
                || object_url_direct_cache_store_has_safe_ownership(node, &analysis, ctx)
                || object_url_module_disposes_every_returned_result(node, &analysis, ctx)
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
        }
    }
}

impl ObjectUrlAnalysis {
    fn build(ctx: &LintContext<'_>) -> Self {
        let property_write_analysis = build_possible_static_property_write_analysis(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut calls_by_function = FxHashMap::<NodeId, Vec<NodeId>>::default();
        let mut first_global_url_method_write_by_name = FxHashMap::<String, u32>::default();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::CallExpression(call) => {
                    for function_id in object_url_possible_local_call_function_ids(
                        node,
                        call,
                        ctx,
                        &property_write_analysis,
                        &mut resolution_cache,
                    ) {
                        calls_by_function
                            .entry(function_id)
                            .or_default()
                            .push(node.id());
                    }
                }
                AstKind::AssignmentExpression(assignment) => {
                    if let Some(member) = assignment.left.as_member_expression()
                        && is_proven_global_namespace_reference(member.object(), "URL", ctx)
                        && let Some(property_name) = member.static_property_name()
                    {
                        first_global_url_method_write_by_name
                            .entry(property_name.to_string())
                            .and_modify(|offset| *offset = (*offset).min(node.span().start))
                            .or_insert(node.span().start);
                    }
                }
                AstKind::UpdateExpression(update) => {
                    if let Some(member) = update.argument.as_member_expression()
                        && is_proven_global_namespace_reference(member.object(), "URL", ctx)
                        && let Some(property_name) = member.static_property_name()
                    {
                        first_global_url_method_write_by_name
                            .entry(property_name.to_string())
                            .and_modify(|offset| *offset = (*offset).min(node.span().start))
                            .or_insert(node.span().start);
                    }
                }
                _ => {}
            }
        }
        Self {
            calls_by_function,
            first_global_url_method_write_by_name,
            property_write_analysis,
        }
    }
}

fn object_url_possible_local_call_function_ids<'a>(
    call_node: &AstNode<'a>,
    call: &'a CallExpression<'a>,
    ctx: &LintContext<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<NodeId> {
    if matches!(
        call.callee.get_inner_expression(),
        Expression::CallExpression(bound_call)
            if bound_call
                .callee
                .get_inner_expression()
                .as_member_expression()
                .is_some_and(|member| member.static_property_name() == Some("bind"))
    ) {
        return Vec::new();
    }
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return possible_local_function_ids(&call.callee, ctx, &mut Vec::new(), resolution_cache);
    };
    let Some(property_name) = object_url_resolved_member_property_name(member, ctx) else {
        return Vec::new();
    };
    let receiver = member.object().get_inner_expression();
    match receiver {
        Expression::ObjectExpression(object) => possible_object_property_function_ids(
            object,
            &property_name,
            ctx,
            &mut Vec::new(),
            resolution_cache,
        ),
        Expression::ClassExpression(class) => possible_class_property_function_ids(
            class,
            &property_name,
            ctx,
            &mut Vec::new(),
            resolution_cache,
        ),
        Expression::Identifier(identifier) => {
            if has_possible_static_property_write_before(
                identifier,
                &property_name,
                call_node,
                property_write_analysis,
                ctx,
            ) {
                return Vec::new();
            }
            let Some(root_symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
                return Vec::new();
            };
            let declaration = ctx.symbol_declaration(root_symbol_id);
            match declaration.kind() {
                AstKind::VariableDeclarator(declarator)
                    if matches!(
                        ctx.nodes().parent_node(declaration.id()).kind(),
                        AstKind::VariableDeclaration(variable) if variable.kind.is_const()
                    ) =>
                {
                    match declarator
                        .init
                        .as_ref()
                        .map(Expression::get_inner_expression)
                    {
                        Some(Expression::ObjectExpression(object)) => {
                            possible_object_property_function_ids(
                                object,
                                &property_name,
                                ctx,
                                &mut vec![root_symbol_id],
                                resolution_cache,
                            )
                        }
                        Some(Expression::ClassExpression(class)) => {
                            possible_class_property_function_ids(
                                class,
                                &property_name,
                                ctx,
                                &mut vec![root_symbol_id],
                                resolution_cache,
                            )
                        }
                        _ => Vec::new(),
                    }
                }
                AstKind::Class(class) => possible_class_property_function_ids(
                    class,
                    &property_name,
                    ctx,
                    &mut vec![root_symbol_id],
                    resolution_cache,
                ),
                _ => Vec::new(),
            }
        }
        _ => Vec::new(),
    }
}

fn object_url_is_url_method_call<'a>(
    call_node: &AstNode<'a>,
    call: &'a CallExpression<'a>,
    method_name: &str,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    if object_url_resolved_member_property_name(member, ctx).as_deref() != Some(method_name)
        || !is_proven_global_namespace_reference(member.object(), "URL", ctx)
    {
        return false;
    }
    if let Expression::Identifier(identifier) = member.object().get_inner_expression()
        && (object_url_identifier_is_defaulted_binding(identifier, ctx)
            || has_possible_static_property_write_before(
                identifier,
                method_name,
                call_node,
                &analysis.property_write_analysis,
                ctx,
            ))
    {
        return false;
    }
    !object_url_global_method_was_reassigned_before(call_node, method_name, analysis)
}

fn object_url_identifier_is_defaulted_binding(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
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
    object_url_pattern_default_for_symbol(&declarator.id, symbol_id)
}

fn object_url_pattern_default_for_symbol(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
) -> bool {
    match pattern {
        BindingPattern::AssignmentPattern(assignment) => assignment
            .left
            .get_binding_identifiers()
            .iter()
            .any(|binding| binding.symbol_id() == symbol_id),
        BindingPattern::ObjectPattern(object) => object
            .properties
            .iter()
            .any(|property| object_url_pattern_default_for_symbol(&property.value, symbol_id)),
        BindingPattern::ArrayPattern(array) => array
            .elements
            .iter()
            .flatten()
            .any(|element| object_url_pattern_default_for_symbol(element, symbol_id)),
        _ => false,
    }
}

fn object_url_global_method_was_reassigned_before(
    call_node: &AstNode<'_>,
    method_name: &str,
    analysis: &ObjectUrlAnalysis,
) -> bool {
    analysis
        .first_global_url_method_write_by_name
        .get(method_name)
        .is_some_and(|offset| *offset < call_node.span().start)
}

fn object_url_resolve_static_string<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(value) = get_static_string_expression(expression) {
        return Some(value.to_string());
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited_symbol_ids.insert(symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    object_url_resolve_static_string(declarator.init.as_ref()?, ctx, visited_symbol_ids)
}

fn object_url_resolved_member_property_name<'a>(
    member: &'a oxc_ast::ast::MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    if let Some(property_name) = member.static_property_name() {
        return Some(property_name.to_string());
    }
    let oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) = member else {
        return None;
    };
    object_url_resolve_static_string(&member.expression, ctx, &mut FxHashSet::default())
}

fn object_url_find_call_result_root<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> &'b AstNode<'a> {
    let mut result = transparent_expression_root(node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(result.id());
        let propagates = match parent.kind() {
            AstKind::AwaitExpression(await_expression) => {
                await_expression.argument.span() == result.span()
            }
            AstKind::SequenceExpression(sequence) => sequence
                .expressions
                .last()
                .is_some_and(|expression| expression.span() == result.span()),
            _ => false,
        };
        if !propagates {
            return result;
        }
        result = transparent_expression_root(parent, ctx);
    }
}

fn object_url_analyze_containing_expression<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> (&'b AstNode<'a>, bool) {
    let mut expression_root = object_url_find_call_result_root(node, ctx);
    let mut is_guarded = false;
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        let is_branch = match parent.kind() {
            AstKind::LogicalExpression(logical) => {
                if logical.right.span() == expression_root.span() {
                    is_guarded = true;
                }
                logical.left.span() == expression_root.span()
                    || logical.right.span() == expression_root.span()
            }
            AstKind::ConditionalExpression(conditional) => {
                let is_arm = conditional.consequent.span() == expression_root.span()
                    || conditional.alternate.span() == expression_root.span();
                is_guarded |= is_arm;
                is_arm
            }
            _ => false,
        };
        if !is_branch {
            return (expression_root, is_guarded);
        }
        expression_root = object_url_find_call_result_root(parent, ctx);
    }
}

fn object_url_is_nested_in_returned_value<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let mut current = object_url_find_call_result_root(node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::ReturnStatement(statement)
                if statement
                    .argument
                    .as_ref()
                    .is_some_and(|argument| argument.span() == current.span()) =>
            {
                return true;
            }
            AstKind::ArrowFunctionExpression(function)
                if function
                    .get_expression()
                    .is_some_and(|body| body.span() == current.span()) =>
            {
                return true;
            }
            AstKind::ObjectProperty(property) if property.value.span() == current.span() => {}
            AstKind::ObjectExpression(_)
            | AstKind::ArrayExpression(_)
            | AstKind::SpreadElement(_) => {}
            AstKind::LogicalExpression(logical)
                if logical.left.span() == current.span()
                    || logical.right.span() == current.span() => {}
            AstKind::ConditionalExpression(conditional)
                if conditional.consequent.span() == current.span()
                    || conditional.alternate.span() == current.span() => {}
            _ => return false,
        }
        current = object_url_find_call_result_root(parent, ctx);
    }
}

fn object_url_direct_if_branch<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let expression_root = transparent_expression_root(node, ctx);
    let statement = ctx.nodes().parent_node(expression_root.id());
    if !matches!(
        statement.kind(),
        AstKind::ExpressionStatement(_) | AstKind::VariableDeclaration(_)
    ) {
        return false;
    }
    let mut container = ctx.nodes().parent_node(statement.id());
    if matches!(container.kind(), AstKind::BlockStatement(_)) {
        container = ctx.nodes().parent_node(container.id());
    }
    matches!(container.kind(), AstKind::IfStatement(_))
}

fn object_url_bound_symbol_id<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> Option<SymbolId> {
    let (expression_root, _) = object_url_analyze_containing_expression(node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == expression_root.span()) =>
        {
            declarator
                .id
                .get_binding_identifier()
                .map(|binding| binding.symbol_id())
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.right.span() == expression_root.span() =>
        {
            let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) =
                &assignment.left
            else {
                return None;
            };
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
        }
        _ => None,
    }
}

fn object_url_collect_alias_bindings(
    source: ProducedBinding,
    ctx: &LintContext<'_>,
) -> Vec<ProducedBinding> {
    let mut bindings = vec![source];
    let mut visited_symbol_ids = FxHashSet::from_iter([source.symbol_id]);
    let mut binding_index = 0;
    while binding_index < bindings.len() {
        let binding = bindings[binding_index];
        binding_index += 1;
        for reference in ctx.scoping().get_resolved_references(binding.symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if reference_node.span().start <= binding.acquired_at || reference.is_write() {
                continue;
            }
            let reference_root = transparent_expression_root(reference_node, ctx);
            let declaration = ctx.nodes().parent_node(reference_root.id());
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                continue;
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != reference_root.span())
                || !matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
            {
                continue;
            }
            let Some(alias) = declarator.id.get_binding_identifier() else {
                continue;
            };
            if visited_symbol_ids.insert(alias.symbol_id()) {
                bindings.push(ProducedBinding {
                    symbol_id: alias.symbol_id(),
                    acquired_at: declaration.span().end,
                });
            }
        }
    }
    bindings
}

fn object_url_binding_has_write_before(
    binding: ProducedBinding,
    consumer_start: u32,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(binding.symbol_id)
        .any(|reference| {
            reference.is_write()
                && ctx.nodes().get_node(reference.node_id()).span().start > binding.acquired_at
                && ctx.nodes().get_node(reference.node_id()).span().start < consumer_start
        })
}

fn object_url_expression_symbol_id(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn object_url_symbol_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn object_url_expression_matches_binding(
    expression: &Expression<'_>,
    binding: ProducedBinding,
    ctx: &LintContext<'_>,
) -> bool {
    object_url_expression_symbol_id(expression, ctx) == Some(binding.symbol_id)
}

fn object_url_nearest_boundary_id<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> Option<NodeId> {
    crate::ast_util::get_enclosing_function(node, ctx).map(AstNode::id)
}

fn object_url_reachable_cfg_blocks(
    entry_block: oxc_cfg::BlockNodeId,
    excluded_block: Option<oxc_cfg::BlockNodeId>,
    ctx: &LintContext<'_>,
) -> FxHashSet<oxc_cfg::BlockNodeId> {
    let mut visited_blocks = FxHashSet::default();
    let mut pending_blocks = Vec::new();
    if Some(entry_block) != excluded_block {
        pending_blocks.push(entry_block);
    }
    while let Some(block_id) = pending_blocks.pop() {
        if !visited_blocks.insert(block_id) {
            continue;
        }
        for edge in ctx
            .cfg()
            .graph()
            .edges_directed(block_id, oxc_cfg::graph::Direction::Outgoing)
        {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction
                    | oxc_cfg::EdgeType::Unreachable
                    | oxc_cfg::EdgeType::Error(_)
            ) {
                continue;
            }
            let target = oxc_cfg::graph::visit::EdgeRef::target(&edge);
            if Some(target) != excluded_block {
                pending_blocks.push(target);
            }
        }
    }
    visited_blocks
}

fn object_url_node_is_unconditional_from_boundary(
    node: &AstNode<'_>,
    boundary_id: Option<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(boundary_id) = boundary_id else {
        return !object_url_is_conditionally_executed_at_module(node, ctx);
    };
    let entry_block = ctx.nodes().cfg_id(boundary_id);
    let target_block = ctx.nodes().cfg_id(node.id());
    let reachable_blocks = object_url_reachable_cfg_blocks(entry_block, None, ctx);
    reachable_blocks.contains(&target_block)
        && !object_url_reachable_cfg_blocks(entry_block, Some(target_block), ctx)
            .into_iter()
            .any(|block_id| {
                ctx.cfg()
                    .basic_block(block_id)
                    .instructions()
                    .iter()
                    .any(|instruction| {
                        matches!(
                            instruction.kind,
                            oxc_cfg::InstructionKind::ImplicitReturn
                                | oxc_cfg::InstructionKind::Return(_)
                        )
                    })
            })
}

fn object_url_unary_not_binding(
    expression: &Expression<'_>,
    binding: ProducedBinding,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::UnaryExpression(unary) = expression.get_inner_expression() else {
        return false;
    };
    unary.operator == UnaryOperator::LogicalNot
        && object_url_expression_matches_binding(&unary.argument, binding, ctx)
}

fn object_url_has_intervening_control_transfer(
    consumer: &AstNode<'_>,
    binding: ProducedBinding,
    boundary_id: Option<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if candidate.span().start <= binding.acquired_at
            || candidate.span().start >= consumer.span().start
            || object_url_nearest_boundary_id(candidate, ctx) != boundary_id
        {
            return false;
        }
        let is_matching_result_guard_exit = ctx
            .nodes()
            .ancestors(candidate.id())
            .take_while(|ancestor| object_url_nearest_boundary_id(ancestor, ctx) == boundary_id)
            .find_map(|ancestor| match ancestor.kind() {
                AstKind::IfStatement(statement)
                    if statement.alternate.is_none()
                        && statement
                            .consequent
                            .span()
                            .contains_inclusive(candidate.span())
                        && object_url_unary_not_binding(&statement.test, binding, ctx) =>
                {
                    Some(statement.span)
                }
                _ => None,
            })
            .is_some();
        if is_matching_result_guard_exit {
            return false;
        }
        object_url_control_transfer_can_bypass_consumer(candidate, consumer, ctx)
    })
}

fn object_url_control_transfer_can_bypass_consumer(
    transfer: &AstNode<'_>,
    consumer: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match transfer.kind() {
        AstKind::ReturnStatement(_) => true,
        AstKind::ThrowStatement(_) => !ctx.nodes().ancestors(transfer.id()).any(|ancestor| {
            matches!(ancestor.kind(), AstKind::TryStatement(try_statement)
                if try_statement.handler.is_some()
                    && try_statement.block.span.contains_inclusive(transfer.span())
                    && !try_statement.block.span.contains_inclusive(consumer.span()))
        }),
        AstKind::BreakStatement(_) => ctx
            .nodes()
            .ancestors(transfer.id())
            .find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::SwitchStatement(_)
                        | AstKind::WhileStatement(_)
                        | AstKind::DoWhileStatement(_)
                        | AstKind::ForStatement(_)
                        | AstKind::ForInStatement(_)
                        | AstKind::ForOfStatement(_)
                )
            })
            .is_none_or(|target| target.span().contains_inclusive(consumer.span())),
        AstKind::ContinueStatement(_) => ctx
            .nodes()
            .ancestors(transfer.id())
            .find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::WhileStatement(_)
                        | AstKind::DoWhileStatement(_)
                        | AstKind::ForStatement(_)
                        | AstKind::ForInStatement(_)
                        | AstKind::ForOfStatement(_)
                )
            })
            .is_none_or(|target| target.span().contains_inclusive(consumer.span())),
        _ => false,
    }
}

fn object_url_is_positive_guarded_consumer<'a>(
    consumer: &AstNode<'a>,
    binding: ProducedBinding,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = consumer;
    let consumer_boundary = object_url_nearest_boundary_id(consumer, ctx);
    let mut found_positive_guard = false;
    while let Some(parent) = ctx.nodes().ancestors(current.id()).next() {
        if object_url_nearest_boundary_id(parent, ctx) != consumer_boundary {
            break;
        }
        let guarded_branch = match parent.kind() {
            AstKind::IfStatement(statement)
                if statement
                    .consequent
                    .span()
                    .contains_inclusive(current.span()) =>
            {
                Some((&statement.test, Some(&statement.consequent)))
            }
            AstKind::LogicalExpression(logical)
                if logical.operator == LogicalOperator::And
                    && logical.right.span().contains_inclusive(current.span()) =>
            {
                Some((&logical.left, None))
            }
            AstKind::ConditionalExpression(conditional)
                if conditional
                    .consequent
                    .span()
                    .contains_inclusive(current.span()) =>
            {
                Some((&conditional.test, None))
            }
            _ => None,
        };
        if let Some((guard, guarded_statement)) = guarded_branch {
            if object_url_expression_matches_binding(guard, binding, ctx) {
                found_positive_guard = true;
            } else if guarded_statement.is_none_or(|statement| {
                !(statement.span().start <= binding.acquired_at
                    && binding.acquired_at <= statement.span().end)
            }) {
                return false;
            }
        } else if matches!(
            parent.kind(),
            AstKind::SwitchCase(_)
                | AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::ForStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::CatchClause(_)
        ) {
            return false;
        }
        current = parent;
    }
    found_positive_guard
        && !object_url_has_intervening_control_transfer(consumer, binding, consumer_boundary, ctx)
}

fn object_url_consumer_guaranteed_after<'a>(
    consumer: &AstNode<'a>,
    creation: &AstNode<'a>,
    binding: ProducedBinding,
    ctx: &LintContext<'a>,
) -> bool {
    object_url_consumer_guaranteed_after_inner(consumer, creation, binding, false, ctx)
}

fn object_url_returned_cleanup_consumer_guaranteed_after<'a>(
    consumer: &AstNode<'a>,
    creation: &AstNode<'a>,
    binding: ProducedBinding,
    ctx: &LintContext<'a>,
) -> bool {
    object_url_consumer_guaranteed_after_inner(consumer, creation, binding, true, ctx)
}

fn object_url_consumer_guaranteed_after_inner<'a>(
    consumer: &AstNode<'a>,
    creation: &AstNode<'a>,
    binding: ProducedBinding,
    is_returned_cleanup: bool,
    ctx: &LintContext<'a>,
) -> bool {
    if consumer.span().start <= creation.span().end
        || object_url_binding_has_write_before(binding, consumer.span().start, ctx)
    {
        return false;
    }
    if ctx.nodes().ancestors(creation.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::ForStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
        ) && !ancestor.span().contains_inclusive(consumer.span())
    }) {
        return false;
    }
    let creation_boundary = object_url_nearest_boundary_id(creation, ctx);
    if object_url_nearest_boundary_id(consumer, ctx) != creation_boundary {
        return false;
    }
    if !is_returned_cleanup
        && object_url_consumer_follows_in_same_block(consumer, creation, ctx)
        && !object_url_has_intervening_control_transfer(consumer, binding, creation_boundary, ctx)
    {
        return true;
    }
    if let Some(function_id) = creation_boundary
        && !is_node_reachable_within_function(consumer, ctx.nodes().get_node(function_id), ctx)
    {
        return false;
    }
    if !is_returned_cleanup
        && creation_boundary
            .is_some_and(|function_id| !is_node_conditionally_executed(consumer, function_id, ctx))
        && !object_url_has_intervening_control_transfer(consumer, binding, creation_boundary, ctx)
    {
        return true;
    }
    if object_url_node_is_unconditional_from_boundary(consumer, creation_boundary, ctx)
        && !object_url_has_intervening_control_transfer(consumer, binding, creation_boundary, ctx)
    {
        return true;
    }
    if is_returned_cleanup {
        return object_url_is_positive_guarded_consumer(consumer, binding, ctx);
    }
    if ctx.nodes().cfg_id(consumer.id()) == ctx.nodes().cfg_id(creation.id()) {
        return !object_url_has_intervening_control_transfer(
            consumer,
            binding,
            creation_boundary,
            ctx,
        );
    }
    object_url_is_positive_guarded_consumer(consumer, binding, ctx)
}

fn object_url_consumer_follows_in_same_block(
    consumer: &AstNode<'_>,
    creation: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some((creation_block_id, creation_statement_index)) =
        object_url_direct_block_statement_index(creation, ctx)
    else {
        return false;
    };
    let Some((consumer_block_id, consumer_statement_index)) =
        object_url_direct_block_statement_index(consumer, ctx)
    else {
        return false;
    };
    creation_block_id == consumer_block_id && creation_statement_index <= consumer_statement_index
}

fn object_url_direct_block_statement_index(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<(NodeId, usize)> {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let AstKind::BlockStatement(block) = ancestor.kind() else {
            continue;
        };
        let statement_index = block
            .body
            .iter()
            .position(|statement| statement.span().contains_inclusive(node.span()))?;
        return Some((ancestor.id(), statement_index));
    }
    None
}

fn object_url_is_conditionally_executed_at_module(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut current = node;
    for parent in ctx.nodes().ancestors(node.id()) {
        let is_conditional = match parent.kind() {
            AstKind::IfStatement(statement) => {
                statement
                    .consequent
                    .span()
                    .contains_inclusive(current.span())
                    || statement.alternate.as_ref().is_some_and(|alternate| {
                        alternate.span().contains_inclusive(current.span())
                    })
            }
            AstKind::LogicalExpression(logical) => {
                logical.right.span().contains_inclusive(current.span())
            }
            AstKind::ConditionalExpression(conditional) => {
                conditional
                    .consequent
                    .span()
                    .contains_inclusive(current.span())
                    || conditional
                        .alternate
                        .span()
                        .contains_inclusive(current.span())
            }
            AstKind::SwitchCase(_)
            | AstKind::WhileStatement(_)
            | AstKind::DoWhileStatement(_)
            | AstKind::ForStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_)
            | AstKind::CatchClause(_) => true,
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return true,
            _ => false,
        };
        if is_conditional {
            return true;
        }
        current = parent;
    }
    false
}

fn object_url_is_revoke_of_binding<'a>(
    node: &AstNode<'a>,
    call: &'a CallExpression<'a>,
    binding: ProducedBinding,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    object_url_is_url_method_call(node, call, "revokeObjectURL", analysis, ctx)
        && call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|argument| object_url_expression_matches_binding(argument, binding, ctx))
}

fn object_url_returned_cleanup_is_guaranteed<'a>(
    revoke_node: &AstNode<'a>,
    creation: &AstNode<'a>,
    binding: ProducedBinding,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(cleanup) = crate::ast_util::get_enclosing_function(revoke_node, ctx) else {
        return false;
    };
    if Some(cleanup.id()) == object_url_nearest_boundary_id(creation, ctx)
        || is_node_conditionally_executed(revoke_node, cleanup.id(), ctx)
            && !object_url_is_positive_guarded_consumer(revoke_node, binding, ctx)
        || object_url_has_intervening_control_transfer(
            revoke_node,
            binding,
            Some(cleanup.id()),
            ctx,
        )
    {
        return false;
    }
    let cleanup_root = transparent_expression_root(cleanup, ctx);
    let consumer = ctx.nodes().parent_node(cleanup_root.id());
    match consumer.kind() {
        AstKind::ReturnStatement(_) => {
            object_url_nearest_boundary_id(consumer, ctx)
                == object_url_nearest_boundary_id(creation, ctx)
                && object_url_returned_cleanup_consumer_guaranteed_after(
                    consumer, creation, binding, ctx,
                )
        }
        AstKind::ArrowFunctionExpression(function) => function
            .get_expression()
            .is_some_and(|body| body.span() == cleanup_root.span()),
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == cleanup_root.span()) =>
        {
            let Some(cleanup_binding) = declarator.id.get_binding_identifier() else {
                return false;
            };
            object_url_cleanup_binding_is_returned(
                cleanup_binding.symbol_id(),
                creation,
                binding,
                ctx,
                &mut FxHashSet::default(),
            )
        }
        _ => false,
    }
}

fn object_url_cleanup_binding_is_returned<'a>(
    symbol_id: SymbolId,
    creation: &AstNode<'a>,
    produced_binding: ProducedBinding,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            if reference.is_write() {
                return false;
            }
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let consumer = ctx.nodes().parent_node(reference_root.id());
            if matches!(consumer.kind(), AstKind::ReturnStatement(_)) {
                return object_url_returned_cleanup_consumer_guaranteed_after(
                    reference_root,
                    creation,
                    produced_binding,
                    ctx,
                );
            }
            let AstKind::VariableDeclarator(declarator) = consumer.kind() else {
                return false;
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != reference_root.span())
                || !matches!(
                    ctx.nodes().parent_node(consumer.id()).kind(),
                    AstKind::VariableDeclaration(variable) if variable.kind.is_const()
                )
            {
                return false;
            }
            declarator.id.get_binding_identifier().is_some_and(|alias| {
                object_url_cleanup_binding_is_returned(
                    alias.symbol_id(),
                    creation,
                    produced_binding,
                    ctx,
                    visited_symbol_ids,
                )
            })
        })
}

fn object_url_scheduled_revoke_is_guaranteed<'a>(
    revoke_node: &AstNode<'a>,
    creation: &AstNode<'a>,
    binding: ProducedBinding,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(callback) = crate::ast_util::get_enclosing_function(revoke_node, ctx) else {
        return false;
    };
    if Some(callback.id()) == object_url_nearest_boundary_id(creation, ctx)
        || is_node_conditionally_executed(revoke_node, callback.id(), ctx)
        || object_url_has_intervening_control_transfer(
            revoke_node,
            binding,
            Some(callback.id()),
            ctx,
        )
    {
        return false;
    }
    let callback_root = transparent_expression_root(callback, ctx);
    let scheduler_node = ctx.nodes().parent_node(callback_root.id());
    let AstKind::CallExpression(scheduler) = scheduler_node.kind() else {
        return false;
    };
    if scheduler
        .arguments
        .first()
        .is_none_or(|argument| argument.span() != callback_root.span())
        || !matches!(
            ctx.nodes().parent_node(scheduler_node.id()).kind(),
            AstKind::ExpressionStatement(_)
        )
    {
        return false;
    }
    let scheduler_callee = scheduler.callee.get_inner_expression();
    let scheduler_name = match scheduler_callee {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        expression => expression
            .as_member_expression()
            .and_then(|member| member.static_property_name())
            .map(|name| name.to_string()),
    };
    if !matches!(
        scheduler_name.as_deref(),
        Some("setTimeout" | "queueMicrotask")
    ) {
        return false;
    }
    let Some(scheduler_name) = scheduler_name.as_deref() else {
        return false;
    };
    let is_proven_global_scheduler = match scheduler_callee {
        Expression::Identifier(_) => {
            is_proven_global_namespace_reference(scheduler_callee, scheduler_name, ctx)
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return false;
            };
            matches!(receiver.name.as_str(), "window" | "globalThis" | "self")
                && is_proven_global_namespace_reference(
                    member.object(),
                    receiver.name.as_str(),
                    ctx,
                )
                && !has_possible_static_property_write_before(
                    receiver,
                    scheduler_name,
                    scheduler_node,
                    &analysis.property_write_analysis,
                    ctx,
                )
        }),
    };
    if !is_proven_global_scheduler {
        return false;
    }
    object_url_consumer_guaranteed_after(scheduler_node, creation, binding, ctx)
}

fn object_url_bound_creation_is_disposed<'a>(
    creation: &AstNode<'a>,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = object_url_bound_symbol_id(creation, ctx) else {
        return false;
    };
    let bindings = object_url_collect_alias_bindings(
        ProducedBinding {
            symbol_id,
            acquired_at: creation.span().end,
        },
        ctx,
    );
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call) = node.kind() else {
            continue;
        };
        for binding in &bindings {
            if object_url_is_revoke_of_binding(node, call, *binding, analysis, ctx)
                && (object_url_consumer_guaranteed_after(node, creation, *binding, ctx)
                    || object_url_returned_cleanup_is_guaranteed(node, creation, *binding, ctx)
                    || object_url_scheduled_revoke_is_guaranteed(
                        node, creation, *binding, analysis, ctx,
                    ))
            {
                return true;
            }
        }
    }
    object_url_boundary_has_exhaustive_disposal(creation, &bindings, analysis, ctx)
}

fn object_url_statement_can_bypass_following_sibling(
    statement: &Statement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let statement_span = statement.span();
    let statement_boundary = ctx
        .nodes()
        .iter()
        .find(|node| node.span() == statement_span)
        .and_then(|node| object_url_nearest_boundary_id(node, ctx));
    ctx.nodes().iter().any(|candidate| {
        if candidate.span() == statement_span
            || !statement_span.contains_inclusive(candidate.span())
            || object_url_nearest_boundary_id(candidate, ctx) != statement_boundary
        {
            return false;
        }
        match candidate.kind() {
            AstKind::ReturnStatement(_) => true,
            AstKind::ThrowStatement(_) => !ctx.nodes().ancestors(candidate.id()).any(|ancestor| {
                matches!(ancestor.kind(), AstKind::TryStatement(try_statement)
                    if try_statement.handler.is_some()
                        && try_statement.block.span.contains_inclusive(candidate.span())
                        && statement_span.contains_inclusive(ancestor.span()))
            }),
            AstKind::BreakStatement(_) => ctx
                .nodes()
                .ancestors(candidate.id())
                .find(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::SwitchStatement(_)
                            | AstKind::WhileStatement(_)
                            | AstKind::DoWhileStatement(_)
                            | AstKind::ForStatement(_)
                            | AstKind::ForInStatement(_)
                            | AstKind::ForOfStatement(_)
                    )
                })
                .is_none_or(|target| !statement_span.contains_inclusive(target.span())),
            AstKind::ContinueStatement(_) => ctx
                .nodes()
                .ancestors(candidate.id())
                .find(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::WhileStatement(_)
                            | AstKind::DoWhileStatement(_)
                            | AstKind::ForStatement(_)
                            | AstKind::ForInStatement(_)
                            | AstKind::ForOfStatement(_)
                    )
                })
                .is_none_or(|target| !statement_span.contains_inclusive(target.span())),
            _ => false,
        }
    })
}

fn object_url_statement_always_revokes_binding<'a>(
    statement: &'a Statement<'a>,
    binding: ProducedBinding,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    match statement {
        Statement::BlockStatement(block) => {
            for child in &block.body {
                if object_url_statement_always_revokes_binding(child, binding, analysis, ctx) {
                    return true;
                }
                if statement_always_exits(child)
                    || object_url_statement_can_bypass_following_sibling(child, ctx)
                {
                    return false;
                }
            }
            false
        }
        Statement::IfStatement(statement) => {
            statement.alternate.as_ref().is_some_and(|alternate| {
                object_url_statement_always_revokes_binding(
                    &statement.consequent,
                    binding,
                    analysis,
                    ctx,
                ) && object_url_statement_always_revokes_binding(alternate, binding, analysis, ctx)
            })
        }
        Statement::SwitchStatement(statement) => {
            statement.cases.iter().any(|case| case.test.is_none())
                && statement.cases.iter().enumerate().all(|(case_index, _)| {
                    for case in statement.cases.iter().skip(case_index) {
                        for child in &case.consequent {
                            if object_url_statement_always_revokes_binding(
                                child, binding, analysis, ctx,
                            ) {
                                return true;
                            }
                            if statement_always_exits(child)
                                || object_url_statement_can_bypass_following_sibling(child, ctx)
                            {
                                return false;
                            }
                        }
                    }
                    false
                })
        }
        Statement::ExpressionStatement(statement) => {
            let expression = statement.expression.get_inner_expression();
            let Expression::CallExpression(call) = expression else {
                return false;
            };
            let Some(node) = ctx
                .nodes()
                .iter()
                .find(|candidate| candidate.span() == call.span)
            else {
                return false;
            };
            object_url_is_revoke_of_binding(node, call, binding, analysis, ctx)
        }
        _ => false,
    }
}

fn object_url_boundary_has_exhaustive_disposal<'a>(
    creation: &AstNode<'a>,
    bindings: &[ProducedBinding],
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let creation_boundary = object_url_nearest_boundary_id(creation, ctx);
    ctx.nodes().iter().any(|node| {
        if node.span().start <= creation.span().end
            || object_url_nearest_boundary_id(node, ctx) != creation_boundary
        {
            return false;
        }
        match node.kind() {
            AstKind::IfStatement(statement) => bindings.iter().any(|binding| {
                !object_url_binding_has_write_before(*binding, node.span().start, ctx)
                    && object_url_consumer_guaranteed_after(node, creation, *binding, ctx)
                    && statement.alternate.as_ref().is_some_and(|alternate| {
                        object_url_statement_always_revokes_binding(
                            &statement.consequent,
                            *binding,
                            analysis,
                            ctx,
                        ) && object_url_statement_always_revokes_binding(
                            alternate, *binding, analysis, ctx,
                        )
                    })
            }),
            AstKind::SwitchStatement(statement) => {
                statement.cases.iter().any(|case| case.test.is_none())
                    && bindings.iter().any(|binding| {
                        !object_url_binding_has_write_before(*binding, node.span().start, ctx)
                            && object_url_consumer_guaranteed_after(node, creation, *binding, ctx)
                            && statement.cases.iter().enumerate().all(|(case_index, _)| {
                                for case in statement.cases.iter().skip(case_index) {
                                    for child in &case.consequent {
                                        if object_url_statement_always_revokes_binding(
                                            child, *binding, analysis, ctx,
                                        ) {
                                            return true;
                                        }
                                        if statement_always_exits(child)
                                            || object_url_statement_can_bypass_following_sibling(
                                                child, ctx,
                                            )
                                        {
                                            return false;
                                        }
                                    }
                                }
                                false
                            })
                    })
            }
            _ => false,
        }
    })
}

fn object_url_bound_value_has_hard_escape(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if reference.is_write() {
                return false;
            }
            let reference_root = transparent_expression_root(reference_node, ctx);
            let consumer = ctx.nodes().parent_node(reference_root.id());
            match consumer.kind() {
                AstKind::VariableDeclarator(declarator)
                    if declarator
                        .init
                        .as_ref()
                        .is_some_and(|initializer| initializer.span() == reference_root.span())
                        && matches!(
                            ctx.nodes().parent_node(consumer.id()).kind(),
                            AstKind::VariableDeclaration(variable) if variable.kind.is_const()
                        ) =>
                {
                    declarator
                        .id
                        .get_binding_identifier()
                        .is_some_and(|binding| {
                            object_url_bound_value_has_hard_escape(
                                binding.symbol_id(),
                                ctx,
                                visited_symbol_ids,
                            )
                        })
                }
                AstKind::AssignmentExpression(assignment)
                    if assignment.right.span() == reference_root.span() =>
                {
                    assignment
                        .left
                        .as_member_expression()
                        .is_some_and(|member| {
                            object_url_resolved_member_property_name(member, ctx)
                                .is_some_and(|name| ESCAPE_PROPERTIES.contains(&name.as_str()))
                        })
                }
                AstKind::JSXExpressionContainer(_) => {
                    matches!(
                        ctx.nodes().parent_node(consumer.id()).kind(),
                        AstKind::JSXAttribute(_)
                    )
                }
                AstKind::CallExpression(call) => {
                    object_url_is_url_set_attribute_call(call, reference_root, ctx)
                }
                _ => object_url_is_nested_in_returned_value(reference_root, ctx),
            }
        })
}

fn object_url_is_state_setter_callee(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ConditionalExpression(conditional) => {
            object_url_is_state_setter_callee(
                &conditional.consequent,
                ctx,
                &mut visited_symbol_ids.clone(),
            ) && object_url_is_state_setter_callee(
                &conditional.alternate,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        }
        Expression::Identifier(identifier) => {
            let name = identifier.name.as_str();
            if name.starts_with("set") && name.as_bytes().get(3).is_some_and(u8::is_ascii_uppercase)
            {
                return true;
            }
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                && declarator
                    .id
                    .get_binding_identifier()
                    .is_some_and(|binding| binding.symbol_id() == symbol_id)
                && declarator.init.as_ref().is_some_and(|initializer| {
                    object_url_is_state_setter_callee(initializer, ctx, visited_symbol_ids)
                })
        }
        _ => false,
    }
}

fn object_url_is_url_set_attribute_call<'a>(
    call: &'a CallExpression<'a>,
    url_argument_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    if object_url_resolved_member_property_name(member, ctx).as_deref() != Some("setAttribute") {
        return false;
    }
    let Some(attribute_name) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    let Some(attribute_value) = call.arguments.get(1).and_then(Argument::as_expression) else {
        return false;
    };
    matches!(
        object_url_resolve_static_string(attribute_name, ctx, &mut FxHashSet::default()).as_deref(),
        Some("href" | "src")
    ) && attribute_value.get_inner_expression().span() == url_argument_node.span()
}

fn object_url_escape_is_leaky<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let (expression_root, is_guarded) = object_url_analyze_containing_expression(node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    let stored_result_is_guarded = is_guarded || object_url_direct_if_branch(parent, ctx);
    match parent.kind() {
        AstKind::AssignmentExpression(assignment)
            if assignment.right.span() == expression_root.span() =>
        {
            if let Some(member) = assignment.left.as_member_expression() {
                return object_url_resolved_member_property_name(member, ctx)
                    .is_some_and(|name| ESCAPE_PROPERTIES.contains(&name.as_str()));
            }
            matches!(
                &assignment.left,
                oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier)
                    if stored_result_is_guarded
                        || ctx
                            .scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                            .is_some_and(|symbol_id| {
                                object_url_bound_value_has_hard_escape(
                                    symbol_id,
                                    ctx,
                                    &mut FxHashSet::default(),
                                )
                            })
            )
        }
        AstKind::ReturnStatement(_) => true,
        AstKind::ArrowFunctionExpression(function) => function
            .get_expression()
            .is_some_and(|body| body.span() == expression_root.span()),
        AstKind::JSXExpressionContainer(_) => {
            matches!(
                ctx.nodes().parent_node(parent.id()).kind(),
                AstKind::JSXAttribute(_)
            )
        }
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == expression_root.span()) =>
        {
            stored_result_is_guarded
                || declarator
                    .id
                    .get_binding_identifier()
                    .is_some_and(|binding| {
                        object_url_bound_value_has_hard_escape(
                            binding.symbol_id(),
                            ctx,
                            &mut FxHashSet::default(),
                        )
                    })
        }
        AstKind::CallExpression(call) => {
            object_url_is_state_setter_callee(&call.callee, ctx, &mut FxHashSet::default())
                || object_url_is_url_set_attribute_call(call, expression_root, ctx)
                || object_url_is_module_cache_store(call, expression_root, ctx)
        }
        _ => object_url_is_nested_in_returned_value(expression_root, ctx),
    }
}

fn object_url_module_cache(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<(SymbolId, bool)> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited_symbol_ids.insert(symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
    {
        return None;
    }
    if let Some(binding) = declarator.id.get_binding_identifier()
        && binding.symbol_id() == symbol_id
    {
        let initializer = declarator.init.as_ref()?.get_inner_expression();
        if let Expression::Identifier(_) = initializer {
            return object_url_module_cache(initializer, ctx, visited_symbol_ids);
        }
        if !ctx
            .scoping()
            .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
            .is_top()
        {
            return None;
        }
        let Expression::NewExpression(allocation) = initializer else {
            return None;
        };
        if !binding.name.to_ascii_lowercase().contains("cache") {
            return None;
        }
        if is_proven_global_namespace_reference(&allocation.callee, "Map", ctx) {
            return Some((symbol_id, true));
        }
        if is_proven_global_namespace_reference(&allocation.callee, "Set", ctx) {
            return Some((symbol_id, false));
        }
        return None;
    }
    None
}

fn object_url_is_module_cache_store(
    call: &CallExpression<'_>,
    retained_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    object_url_cache_retention(call, retained_node, ctx).is_some()
}

fn object_url_find_retained_property_path(
    expression: &Expression<'_>,
    retained_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<Vec<String>> {
    let expression = expression.get_inner_expression();
    if object_url_expression_refers_to_node(expression, retained_node, ctx) {
        return Some(Vec::new());
    }
    let Expression::ObjectExpression(object) = expression else {
        return None;
    };
    for property in &object.properties {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let Some(property_name) = property.key.static_name() else {
            continue;
        };
        let Some(mut nested_path) =
            object_url_find_retained_property_path(&property.value, retained_node, ctx)
        else {
            continue;
        };
        nested_path.insert(0, property_name.to_string());
        return Some(nested_path);
    }
    None
}

fn object_url_expression_refers_to_node(
    expression: &Expression<'_>,
    retained_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if expression.span() == retained_node.span() {
        return true;
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let AstKind::IdentifierReference(retained) = retained_node.kind() else {
        return false;
    };
    let expression_symbol_id = object_url_symbol_id(identifier, ctx);
    let retained_symbol_id = object_url_symbol_id(retained, ctx);
    expression_symbol_id.is_some_and(|symbol_id| {
        retained_symbol_id == Some(symbol_id)
            || object_url_identifier_resolves_to_symbol(
                retained,
                symbol_id,
                ctx,
                &mut FxHashSet::default(),
            )
    }) || retained_symbol_id.is_some_and(|symbol_id| {
        object_url_identifier_resolves_to_symbol(
            identifier,
            symbol_id,
            ctx,
            &mut FxHashSet::default(),
        )
    })
}

fn object_url_expression_retains_node(
    expression: &Expression<'_>,
    retained_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = expression.get_inner_expression();
    if object_url_expression_refers_to_node(expression, retained_node, ctx) {
        return true;
    }
    match expression {
        Expression::ArrayExpression(array) => array.elements.iter().any(|element| match element {
            oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread) => {
                object_url_expression_retains_node(&spread.argument, retained_node, ctx)
            }
            oxc_ast::ast::ArrayExpressionElement::Elision(_) => false,
            element => element.as_expression().is_some_and(|expression| {
                object_url_expression_retains_node(expression, retained_node, ctx)
            }),
        }),
        Expression::ObjectExpression(object) => {
            object.properties.iter().any(|property| match property {
                oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) => {
                    object_url_expression_retains_node(&property.value, retained_node, ctx)
                }
                oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread) => {
                    object_url_expression_retains_node(&spread.argument, retained_node, ctx)
                }
            })
        }
        _ => false,
    }
}

fn object_url_cache_retention(
    call: &CallExpression<'_>,
    retained_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<(SymbolId, ObjectUrlCacheRetention)> {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return None;
    };
    let Some((cache_symbol_id, is_map)) =
        object_url_module_cache(member.object(), ctx, &mut FxHashSet::default())
    else {
        return None;
    };
    let expected_method = if is_map { "set" } else { "add" };
    if member.static_property_name().as_deref() != Some(expected_method) {
        return None;
    }
    if !is_map {
        let element = call.arguments.first().and_then(Argument::as_expression)?;
        return object_url_expression_retains_node(element, retained_node, ctx).then(|| {
            (
                cache_symbol_id,
                ObjectUrlCacheRetention {
                    kind: ObjectUrlCacheRetentionKind::SetElement,
                    property_path: Vec::new(),
                },
            )
        });
    }
    if let Some(key) = call.arguments.first().and_then(Argument::as_expression)
        && object_url_expression_retains_node(key, retained_node, ctx)
    {
        return Some((
            cache_symbol_id,
            ObjectUrlCacheRetention {
                kind: ObjectUrlCacheRetentionKind::MapKey,
                property_path: Vec::new(),
            },
        ));
    }
    let value = call.arguments.get(1).and_then(Argument::as_expression)?;
    object_url_find_retained_property_path(value, retained_node, ctx).map(|property_path| {
        (
            cache_symbol_id,
            ObjectUrlCacheRetention {
                kind: ObjectUrlCacheRetentionKind::MapValue,
                property_path,
            },
        )
    })
}

fn object_url_direct_cache_store_has_safe_ownership<'a>(
    creation: &AstNode<'a>,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let (expression_root, _) = object_url_analyze_containing_expression(creation, ctx);
    let store_node = ctx.nodes().parent_node(expression_root.id());
    let AstKind::CallExpression(store) = store_node.kind() else {
        return false;
    };
    object_url_cache_store_has_safe_ownership(store_node, store, expression_root, analysis, ctx)
}

fn object_url_cache_store_has_safe_ownership<'a>(
    store_node: &AstNode<'a>,
    store: &CallExpression<'a>,
    retained_node: &AstNode<'a>,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((cache_symbol_id, retention)) = object_url_cache_retention(store, retained_node, ctx)
    else {
        return false;
    };
    if !object_url_cache_evictions_are_safe(cache_symbol_id, &retention, store_node, analysis, ctx)
    {
        return false;
    }
    if retention.kind != ObjectUrlCacheRetentionKind::MapValue
        || object_url_nearest_boundary_id(store_node, ctx).is_none()
    {
        return true;
    }
    let Some(key) = store.arguments.first().and_then(Argument::as_expression) else {
        return true;
    };
    object_url_cache_previous_slot_is_revoked(
        cache_symbol_id,
        key,
        &retention.property_path,
        store_node,
        analysis,
        ctx,
    )
}

fn object_url_cache_previous_slot_is_revoked(
    cache_symbol_id: SymbolId,
    key: &Expression<'_>,
    property_path: &[String],
    store_node: &AstNode<'_>,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|call_node| {
        if call_node.span().start >= store_node.span().start {
            return false;
        }
        let AstKind::CallExpression(call) = call_node.kind() else {
            return false;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            return false;
        };
        if member.static_property_name().as_deref() != Some("get")
            || object_url_module_cache(member.object(), ctx, &mut FxHashSet::default())
                .map(|cache| cache.0)
                != Some(cache_symbol_id)
            || call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_none_or(|candidate_key| {
                    !object_url_expressions_refer_to_same_value(candidate_key, key, ctx)
                })
        {
            return false;
        }
        let Some(result_symbol_id) = object_url_bound_symbol_id(call_node, ctx) else {
            return false;
        };
        let binding = ProducedBinding {
            symbol_id: result_symbol_id,
            acquired_at: call_node.span().end,
        };
        ctx.nodes().iter().any(|revoke_node| {
            let AstKind::CallExpression(revoke) = revoke_node.kind() else {
                return false;
            };
            revoke_node.span().start < store_node.span().start
                && object_url_revoke_matches_binding_path(
                    revoke_node,
                    revoke,
                    binding,
                    property_path,
                    analysis,
                    ctx,
                    &mut FxHashSet::default(),
                )
                && object_url_consumer_guaranteed_after(revoke_node, call_node, binding, ctx)
        })
    })
}

fn object_url_cache_evictions_are_safe<'a>(
    cache_symbol_id: SymbolId,
    retention: &ObjectUrlCacheRetention,
    store_node: &AstNode<'a>,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes()
        .iter()
        .filter_map(|node| {
            let AstKind::CallExpression(call) = node.kind() else {
                return None;
            };
            let member = call.callee.get_inner_expression().as_member_expression()?;
            let method_name = member.static_property_name()?;
            if !matches!(method_name.as_ref(), "delete" | "clear")
                || object_url_module_cache(member.object(), ctx, &mut FxHashSet::default())
                    .map(|cache| cache.0)
                    != Some(cache_symbol_id)
            {
                return None;
            }
            Some((node, call, method_name))
        })
        .all(|(eviction_node, eviction, method_name)| {
            if method_name == "delete" {
                let Some(key) = eviction.arguments.first().and_then(Argument::as_expression) else {
                    return false;
                };
                return match retention.kind {
                    ObjectUrlCacheRetentionKind::MapValue => {
                        object_url_cache_previous_slot_is_revoked(
                            cache_symbol_id,
                            key,
                            &retention.property_path,
                            eviction_node,
                            analysis,
                            ctx,
                        )
                    }
                    ObjectUrlCacheRetentionKind::MapKey
                    | ObjectUrlCacheRetentionKind::SetElement => {
                        object_url_expression_is_revoked_before(key, eviction_node, analysis, ctx)
                    }
                };
            }
            object_url_cache_clear_has_revoke_sweep(
                cache_symbol_id,
                retention,
                store_node,
                eviction_node,
                analysis,
                ctx,
            )
        })
}

fn object_url_binding_pattern_path(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
) -> Option<Vec<String>> {
    match pattern {
        BindingPattern::BindingIdentifier(binding) => {
            (binding.symbol_id() == symbol_id).then(Vec::new)
        }
        BindingPattern::AssignmentPattern(assignment) => {
            object_url_binding_pattern_path(&assignment.left, symbol_id)
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                let Some(mut path) = object_url_binding_pattern_path(&property.value, symbol_id)
                else {
                    continue;
                };
                let property_name = property.key.static_name()?;
                path.insert(0, property_name.to_string());
                return Some(path);
            }
            None
        }
        BindingPattern::ArrayPattern(_) => None,
    }
}

fn object_url_expression_path_from_binding(
    expression: &Expression<'_>,
    root_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<Vec<String>> {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        let property_name = member.static_property_name()?;
        let mut path = object_url_expression_path_from_binding(
            member.object(),
            root_symbol_id,
            ctx,
            visited_symbol_ids,
        )?;
        path.push(property_name.to_string());
        return Some(path);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = object_url_symbol_id(identifier, ctx)?;
    if symbol_id == root_symbol_id {
        return Some(Vec::new());
    }
    if !visited_symbol_ids.insert(symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| reference.is_write())
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable) if variable.kind.is_const()
    ) {
        return None;
    }
    let mut path = object_url_expression_path_from_binding(
        declarator.init.as_ref()?,
        root_symbol_id,
        ctx,
        visited_symbol_ids,
    )?;
    path.extend(object_url_binding_pattern_path(&declarator.id, symbol_id)?);
    Some(path)
}

fn object_url_revoke_matches_binding_path<'a>(
    revoke_node: &AstNode<'a>,
    revoke: &'a CallExpression<'a>,
    binding: ProducedBinding,
    property_path: &[String],
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    object_url_is_url_method_call(revoke_node, revoke, "revokeObjectURL", analysis, ctx)
        && revoke
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(|argument| {
                object_url_expression_path_from_binding(
                    argument,
                    binding.symbol_id,
                    ctx,
                    visited_symbol_ids,
                )
            })
            .is_some_and(|path| path == property_path)
}

fn object_url_expression_is_revoked_before<'a>(
    expression: &Expression<'a>,
    before_node: &AstNode<'a>,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let boundary_id = object_url_nearest_boundary_id(before_node, ctx);
    ctx.nodes().iter().any(|revoke_node| {
        if revoke_node.span().start >= before_node.span().start
            || object_url_nearest_boundary_id(revoke_node, ctx) != boundary_id
            || !object_url_node_is_unconditional_from_boundary(revoke_node, boundary_id, ctx)
        {
            return false;
        }
        let AstKind::CallExpression(revoke) = revoke_node.kind() else {
            return false;
        };
        object_url_is_url_method_call(revoke_node, revoke, "revokeObjectURL", analysis, ctx)
            && revoke
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|argument| {
                    object_url_expressions_refer_to_same_value(argument, expression, ctx)
                })
    })
}

fn object_url_callback_always_revokes_retention(
    callback: &Expression<'_>,
    retention: &ObjectUrlCacheRetention,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    let (callback_id, parameter) = match callback.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => (
            function.node_id.get(),
            function
                .params
                .items
                .get(if retention.kind == ObjectUrlCacheRetentionKind::MapKey {
                    1
                } else {
                    0
                })
                .map(|parameter| &parameter.pattern),
        ),
        Expression::FunctionExpression(function) => (
            function.node_id.get(),
            function
                .params
                .items
                .get(if retention.kind == ObjectUrlCacheRetentionKind::MapKey {
                    1
                } else {
                    0
                })
                .map(|parameter| &parameter.pattern),
        ),
        _ => return false,
    };
    let Some(BindingPattern::BindingIdentifier(parameter)) = parameter else {
        return false;
    };
    let binding = ProducedBinding {
        symbol_id: parameter.symbol_id(),
        acquired_at: callback.span().start,
    };
    ctx.nodes().iter().any(|revoke_node| {
        if object_url_nearest_boundary_id(revoke_node, ctx) != Some(callback_id)
            || !object_url_node_is_unconditional_from_boundary(revoke_node, Some(callback_id), ctx)
        {
            return false;
        }
        let AstKind::CallExpression(revoke) = revoke_node.kind() else {
            return false;
        };
        object_url_revoke_matches_binding_path(
            revoke_node,
            revoke,
            binding,
            &retention.property_path,
            analysis,
            ctx,
            &mut FxHashSet::default(),
        )
    }) || object_url_boundary_has_exhaustive_disposal_for_binding_path(
        callback_id,
        binding,
        &retention.property_path,
        analysis,
        ctx,
    )
}

fn object_url_statement_always_revokes_binding_path<'a>(
    statement: &'a Statement<'a>,
    binding: ProducedBinding,
    property_path: &[String],
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    match statement {
        Statement::BlockStatement(block) => {
            for child in &block.body {
                if object_url_statement_always_revokes_binding_path(
                    child,
                    binding,
                    property_path,
                    analysis,
                    ctx,
                ) {
                    return true;
                }
                if statement_always_exits(child)
                    || object_url_statement_can_bypass_following_sibling(child, ctx)
                {
                    return false;
                }
            }
            false
        }
        Statement::IfStatement(statement) => {
            statement.alternate.as_ref().is_some_and(|alternate| {
                object_url_statement_always_revokes_binding_path(
                    &statement.consequent,
                    binding,
                    property_path,
                    analysis,
                    ctx,
                ) && object_url_statement_always_revokes_binding_path(
                    alternate,
                    binding,
                    property_path,
                    analysis,
                    ctx,
                )
            })
        }
        Statement::ExpressionStatement(statement) => {
            let Expression::CallExpression(call) = statement.expression.get_inner_expression()
            else {
                return false;
            };
            let Some(node) = ctx.nodes().iter().find(|node| node.span() == call.span) else {
                return false;
            };
            object_url_revoke_matches_binding_path(
                node,
                call,
                binding,
                property_path,
                analysis,
                ctx,
                &mut FxHashSet::default(),
            )
        }
        _ => false,
    }
}

fn object_url_boundary_has_exhaustive_disposal_for_binding_path(
    boundary_id: NodeId,
    binding: ProducedBinding,
    property_path: &[String],
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|node| {
        if object_url_nearest_boundary_id(node, ctx) != Some(boundary_id)
            || !object_url_node_is_unconditional_from_boundary(node, Some(boundary_id), ctx)
        {
            return false;
        }
        match node.kind() {
            AstKind::IfStatement(statement) => {
                statement.alternate.as_ref().is_some_and(|alternate| {
                    object_url_statement_always_revokes_binding_path(
                        &statement.consequent,
                        binding,
                        property_path,
                        analysis,
                        ctx,
                    ) && object_url_statement_always_revokes_binding_path(
                        alternate,
                        binding,
                        property_path,
                        analysis,
                        ctx,
                    )
                })
            }
            _ => false,
        }
    })
}

fn object_url_cache_clear_has_revoke_sweep<'a>(
    cache_symbol_id: SymbolId,
    retention: &ObjectUrlCacheRetention,
    store_node: &AstNode<'a>,
    clear_node: &AstNode<'a>,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let clear_boundary_id = object_url_nearest_boundary_id(clear_node, ctx);
    let has_for_each_protocol = ctx.nodes().iter().any(|node| {
        if node.span().start <= store_node.span().end
            || node.span().start >= clear_node.span().start
            || object_url_nearest_boundary_id(node, ctx) != clear_boundary_id
            || !object_url_node_is_unconditional_from_boundary(node, clear_boundary_id, ctx)
        {
            return false;
        }
        let AstKind::CallExpression(call) = node.kind() else {
            return false;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            return false;
        };
        if member.static_property_name().as_deref() != Some("forEach")
            || object_url_module_cache(member.object(), ctx, &mut FxHashSet::default())
                .map(|cache| cache.0)
                != Some(cache_symbol_id)
        {
            return false;
        }
        call.arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|callback| {
                object_url_callback_always_revokes_retention(callback, retention, analysis, ctx)
            })
    });
    if has_for_each_protocol {
        return true;
    }
    if !retention.property_path.is_empty() {
        return false;
    }
    ctx.nodes().iter().any(|node| {
        if node.span().start <= store_node.span().end
            || node.span().start >= clear_node.span().start
            || object_url_nearest_boundary_id(node, ctx) != clear_boundary_id
            || !object_url_node_is_unconditional_from_boundary(node, clear_boundary_id, ctx)
        {
            return false;
        }
        let AstKind::ForOfStatement(statement) = node.kind() else {
            return false;
        };
        let oxc_ast::ast::ForStatementLeft::VariableDeclaration(declaration) = &statement.left
        else {
            return false;
        };
        let Some(binding) = declaration
            .declarations
            .first()
            .and_then(|declaration| declaration.id.get_binding_identifier())
        else {
            return false;
        };
        let Expression::CallExpression(iteration) = statement.right.get_inner_expression() else {
            return false;
        };
        let Some(iteration_member) = iteration
            .callee
            .get_inner_expression()
            .as_member_expression()
        else {
            return false;
        };
        let expected_method = if retention.kind == ObjectUrlCacheRetentionKind::MapKey {
            "keys"
        } else {
            "values"
        };
        iteration_member.static_property_name().as_deref() == Some(expected_method)
            && object_url_module_cache(iteration_member.object(), ctx, &mut FxHashSet::default())
                .map(|cache| cache.0)
                == Some(cache_symbol_id)
            && object_url_statement_always_revokes_binding_path(
                &statement.body,
                ProducedBinding {
                    symbol_id: binding.symbol_id(),
                    acquired_at: statement.body.span().start,
                },
                &[],
                analysis,
                ctx,
            )
    })
}

fn object_url_expressions_refer_to_same_value(
    first: &Expression<'_>,
    second: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if first.get_inner_expression().span() == second.get_inner_expression().span() {
        return true;
    }
    match (first.get_inner_expression(), second.get_inner_expression()) {
        (Expression::Identifier(first), Expression::Identifier(second)) => {
            let first_symbol_id = object_url_symbol_id(first, ctx);
            let second_symbol_id = object_url_symbol_id(second, ctx);
            first_symbol_id.is_some_and(|symbol_id| {
                second_symbol_id == Some(symbol_id)
                    || object_url_identifier_resolves_to_symbol(
                        second,
                        symbol_id,
                        ctx,
                        &mut FxHashSet::default(),
                    )
            }) || second_symbol_id.is_some_and(|symbol_id| {
                object_url_identifier_resolves_to_symbol(
                    first,
                    symbol_id,
                    ctx,
                    &mut FxHashSet::default(),
                )
            })
        }
        (Expression::StringLiteral(first), Expression::StringLiteral(second)) => {
            first.value == second.value
        }
        (Expression::BooleanLiteral(first), Expression::BooleanLiteral(second)) => {
            first.value == second.value
        }
        (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::NumericLiteral(first), Expression::NumericLiteral(second)) => {
            first.value == second.value
        }
        (Expression::BigIntLiteral(first), Expression::BigIntLiteral(second)) => {
            first.value == second.value
        }
        _ => false,
    }
}

fn object_url_identifier_resolves_to_symbol(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    target_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(symbol_id) = object_url_symbol_id(identifier, ctx) else {
        return false;
    };
    if symbol_id == target_symbol_id {
        return true;
    }
    if !visited_symbol_ids.insert(symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| reference.is_write())
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable) if variable.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(Expression::Identifier(initializer)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    object_url_identifier_resolves_to_symbol(initializer, target_symbol_id, ctx, visited_symbol_ids)
}

fn object_url_module_disposes_every_returned_result<'a>(
    creation: &AstNode<'a>,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    if !object_url_is_nested_in_returned_value(creation, ctx) {
        return false;
    }
    let Some(function) = crate::ast_util::get_enclosing_function(creation, ctx) else {
        return false;
    };
    let Some(call_ids) = analysis.calls_by_function.get(&function.id()) else {
        return false;
    };
    !call_ids.is_empty()
        && call_ids.iter().all(|call_id| {
            let call_node = ctx.nodes().get_node(*call_id);
            if object_url_bound_creation_is_disposed(call_node, analysis, ctx)
                || object_url_direct_cache_store_has_safe_ownership(call_node, analysis, ctx)
                || object_url_bound_call_has_safe_cache_store(call_node, analysis, ctx)
            {
                return true;
            }
            let (result_root, _) = object_url_analyze_containing_expression(call_node, ctx);
            let parent = ctx.nodes().parent_node(result_root.id());
            let AstKind::CallExpression(store) = parent.kind() else {
                return false;
            };
            object_url_cache_store_has_safe_ownership(parent, store, result_root, analysis, ctx)
        })
}

fn object_url_bound_call_has_safe_cache_store<'a>(
    call_node: &AstNode<'a>,
    analysis: &ObjectUrlAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = object_url_bound_symbol_id(call_node, ctx) else {
        return false;
    };
    let bindings = object_url_collect_alias_bindings(
        ProducedBinding {
            symbol_id,
            acquired_at: call_node.span().end,
        },
        ctx,
    );
    ctx.nodes().iter().any(|store_node| {
        let AstKind::CallExpression(store) = store_node.kind() else {
            return false;
        };
        bindings.iter().any(|binding| {
            if object_url_binding_has_write_before(*binding, store_node.span().start, ctx) {
                return false;
            }
            let retained_reference = store.arguments.iter().find_map(|argument| {
                let expression = argument.as_expression()?;
                ctx.scoping()
                    .get_resolved_references(binding.symbol_id)
                    .map(|reference| ctx.nodes().get_node(reference.node_id()))
                    .find(|reference| expression.span().contains_inclusive(reference.span()))
            });
            retained_reference.is_some_and(|retained_reference| {
                object_url_consumer_guaranteed_after(store_node, call_node, *binding, ctx)
                    && object_url_cache_store_has_safe_ownership(
                        store_node,
                        store,
                        retained_reference,
                        analysis,
                        ctx,
                    )
            })
        })
    })
}
