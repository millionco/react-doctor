use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, BindingPattern, Expression, ObjectPropertyKind,
        PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan as _, Span};
use oxc_syntax::operator::{AssignmentOperator, BinaryOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This promise chain runs in an effect, ends in a `.then` that sets state or mutates a ref, and has no `.catch` or enclosing try/catch, so a rejection leaves the state unset and surfaces as an unhandled rejection. Add a `.catch` handler on the chain (`.finally` does not count).";
const MAX_INITIATOR_RESOLUTION_DEPTH: usize = 3;

#[derive(Default)]
struct ChainWalk {
    root_id: Option<NodeId>,
    has_catch: bool,
    has_rejection_handler_argument: bool,
    saw_then: bool,
    then_callback_ids: Vec<NodeId>,
    has_direct_setter_then_callback: bool,
}

#[derive(Default)]
struct PromiseNodeIndex {
    node_by_span: FxHashMap<(u32, u32), NodeId>,
    nodes_by_owner: FxHashMap<NodeId, Vec<NodeId>>,
    throw_nodes_by_owner: FxHashMap<NodeId, Vec<NodeId>>,
}

impl PromiseNodeIndex {
    fn build<'a>(ctx: &LintContext<'a>) -> Self {
        let mut index = Self::default();
        let mut nearest_function_by_node = FxHashMap::default();
        for node in ctx.nodes().iter() {
            let span = node.span();
            index.node_by_span.insert((span.start, span.end), node.id());
            let parent_id = ctx.nodes().parent_id(node.id());
            let parent = ctx.nodes().get_node(parent_id);
            let owner_id = if parent_id == node.id() {
                None
            } else if matches!(
                parent.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) {
                Some(parent_id)
            } else {
                nearest_function_by_node.get(&parent_id).copied().flatten()
            };
            nearest_function_by_node.insert(node.id(), owner_id);
            if let Some(owner_id) = owner_id {
                index
                    .nodes_by_owner
                    .entry(owner_id)
                    .or_default()
                    .push(node.id());
                if matches!(node.kind(), AstKind::ThrowStatement(_)) {
                    index
                        .throw_nodes_by_owner
                        .entry(owner_id)
                        .or_default()
                        .push(node.id());
                }
            }
        }
        index
    }

    fn node_id_for_span(&self, span: Span) -> Option<NodeId> {
        self.node_by_span.get(&(span.start, span.end)).copied()
    }

    fn owned_node_ids(&self, function_id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        self.nodes_by_owner
            .get(&function_id)
            .into_iter()
            .flatten()
            .copied()
    }

    fn owned_throw_node_ids(&self, function_id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        self.throw_nodes_by_owner
            .get(&function_id)
            .into_iter()
            .flatten()
            .copied()
    }
}

#[derive(Debug, Default, Clone)]
pub struct NoPromiseThenSideEffectInEffectWithoutCatch;

declare_oxc_lint!(
    /// Warns when a rejectable promise chain mutates React state without rejection handling.
    NoPromiseThenSideEffectInEffectWithoutCatch,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Effect promise .then sets state with no catch.",
);

impl Rule for NoPromiseThenSideEffectInEffectWithoutCatch {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let effect_call_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(effect_call) = node.kind() else {
                    return None;
                };
                is_promise_effect_call(effect_call, ctx).then_some(node.id())
            })
            .collect::<Vec<_>>();
        if effect_call_ids.is_empty() {
            return;
        }
        let node_index = PromiseNodeIndex::build(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut rejectable_function_cache = FxHashMap::default();

        for effect_call_id in effect_call_ids {
            let node = ctx.nodes().get_node(effect_call_id);
            let AstKind::CallExpression(effect_call) = node.kind() else {
                continue;
            };
            let Some(callback_expression) = effect_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
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

            for chain_id in
                collect_floating_chain_ids(callback_id, ctx, &node_index, &mut resolution_cache)
            {
                let chain = ctx.nodes().get_node(chain_id);
                let chain_walk = walk_promise_chain(chain, ctx, &node_index, &mut resolution_cache);
                if !chain_walk.saw_then
                    || chain_walk.has_catch
                    || chain_walk.has_rejection_handler_argument
                {
                    continue;
                }
                let has_state_side_effect = chain_walk.has_direct_setter_then_callback
                    || chain_walk.then_callback_ids.iter().any(|callback_id| {
                        callback_has_unguarded_state_side_effect(*callback_id, ctx, &node_index)
                    });
                if !has_state_side_effect {
                    continue;
                }
                let Some(root_id) = chain_walk.root_id else {
                    continue;
                };
                let (initiator_id, has_upstream_handler) =
                    resolve_root_initiator(root_id, ctx, &node_index, &mut resolution_cache);
                if has_upstream_handler
                    || !is_provably_rejectable_expression(
                        initiator_id,
                        MAX_INITIATOR_RESOLUTION_DEPTH,
                        ctx,
                        &node_index,
                        &mut resolution_cache,
                        &mut rejectable_function_cache,
                    )
                {
                    continue;
                }
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(chain.span()));
            }
        }
    }
}

fn is_promise_effect_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if promise_effect_is_direct_react_api_call(call, "useEffect", ctx)
        || promise_effect_is_direct_react_api_call(call, "useLayoutEffect", ctx)
    {
        return true;
    }
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    if identifier.name != "useMount" {
        return false;
    }
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        entry.module_request.name() == "react-use"
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

fn promise_effect_is_direct_react_api_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return is_react_api_call(call, api_name, ctx);
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return identifier.name == api_name;
    };
    matching_react_import(symbol_id, ctx).is_some_and(|entry| {
        matches!(&entry.import_name, crate::module_record::ImportImportName::Name(imported_name)
            if imported_name.name() == api_name)
    })
}

fn promise_effect_is_react_hook_result_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    if is_react_api_call(call, api_name, ctx) {
        return true;
    }
    matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
        if identifier.name == api_name && is_global_reference(identifier, ctx))
}

fn collect_floating_chain_ids<'a>(
    callback_id: NodeId,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<NodeId> {
    let callback = ctx.nodes().get_node(callback_id);
    if let AstKind::ArrowFunctionExpression(function) = callback.kind()
        && let Some(expression) = function.get_expression()
        && let Some(expression_node) = node_for_expression(expression, ctx, node_index)
    {
        return vec![expression_node.id()];
    }

    let mut chains = Vec::new();
    for node_id in node_index.owned_node_ids(callback_id) {
        let node = ctx.nodes().get_node(node_id);
        match node.kind() {
            AstKind::VariableDeclarator(declarator) => {
                let Some(initializer) = declarator.init.as_ref() else {
                    continue;
                };
                let Some(initializer_node) = node_for_expression(initializer, ctx, node_index)
                else {
                    continue;
                };
                let initializer_node = inner_expression_node(initializer_node, ctx, node_index);
                if !has_promise_chain_then(initializer_node, ctx, node_index) {
                    continue;
                }
                if !binding_has_covering_rejection_handler(
                    &declarator.id,
                    initializer_node,
                    callback,
                    ctx,
                    node_index,
                    resolution_cache,
                ) {
                    chains.push(inner_expression_node(initializer_node, ctx, node_index).id());
                }
            }
            AstKind::ExpressionStatement(statement) => {
                let Some(mut expression_node) =
                    node_for_expression(&statement.expression, ctx, node_index)
                else {
                    continue;
                };
                if let AstKind::UnaryExpression(unary) = expression_node.kind()
                    && unary.operator == UnaryOperator::Void
                    && let Some(argument_node) =
                        node_for_expression(&unary.argument, ctx, node_index)
                {
                    expression_node = argument_node;
                }
                if let AstKind::AssignmentExpression(assignment) = expression_node.kind() {
                    let Some(right_node) = node_for_expression(&assignment.right, ctx, node_index)
                    else {
                        continue;
                    };
                    let right_node = inner_expression_node(right_node, ctx, node_index);
                    if !has_promise_chain_then(right_node, ctx, node_index) {
                        continue;
                    }
                    if assignment.operator == AssignmentOperator::Assign
                        && assignment_target_symbol_id(&assignment.left, ctx).is_some_and(
                            |symbol_id| {
                                assigned_binding_has_covering_rejection_handler(
                                    symbol_id,
                                    right_node,
                                    callback,
                                    ctx,
                                    node_index,
                                    resolution_cache,
                                )
                            },
                        )
                    {
                        continue;
                    }
                    expression_node = right_node;
                }
                let expression_node = inner_expression_node(expression_node, ctx, node_index);
                if has_promise_chain_then(expression_node, ctx, node_index) {
                    chains.push(expression_node.id());
                }
            }
            _ => {}
        }
    }
    chains.sort_unstable_by_key(|node_id| ctx.nodes().get_node(*node_id).span().start);
    chains.dedup();
    chains
}

fn has_promise_chain_then<'a>(
    chain: &AstNode<'a>,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
) -> bool {
    let mut cursor = inner_expression_node(chain, ctx, node_index);
    loop {
        let AstKind::CallExpression(call) = cursor.kind() else {
            return false;
        };
        let Some(member) = call.callee.as_member_expression() else {
            return false;
        };
        match member.static_property_name() {
            Some("then") => return true,
            Some("catch" | "finally") => {}
            _ => return false,
        }
        let Some(object_node) = node_for_expression(member.object(), ctx, node_index) else {
            return false;
        };
        cursor = inner_expression_node(object_node, ctx, node_index);
    }
}

fn binding_has_covering_rejection_handler<'a>(
    pattern: &BindingPattern<'a>,
    anchor: &AstNode<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let Some(binding) = pattern.get_binding_identifier() else {
        return false;
    };
    let handlers = collect_binding_rejection_handler_nodes(
        binding.symbol_id(),
        ctx,
        node_index,
        resolution_cache,
        &mut FxHashSet::default(),
    );
    let handler_refs = handlers
        .iter()
        .map(|node_id| ctx.nodes().get_node(*node_id))
        .collect::<Vec<_>>();
    do_nodes_cover_every_path_after_node(anchor, &handler_refs, function_node, ctx)
}

fn assigned_binding_has_covering_rejection_handler<'a>(
    symbol_id: SymbolId,
    anchor: &AstNode<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let write_references = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .collect::<Vec<_>>();
    if write_references.len() != 1 || write_references[0].node_id() == anchor.id() {
        return false;
    }
    let handlers = collect_binding_rejection_handler_nodes(
        symbol_id,
        ctx,
        node_index,
        resolution_cache,
        &mut FxHashSet::default(),
    );
    let handler_refs = handlers
        .iter()
        .map(|node_id| ctx.nodes().get_node(*node_id))
        .collect::<Vec<_>>();
    if !do_nodes_cover_every_path_after_node(anchor, &handler_refs, function_node, ctx) {
        return false;
    }
    let inside_loop = ctx
        .nodes()
        .ancestors(anchor.id())
        .skip(1)
        .take_while(|ancestor| ancestor.id() != function_node.id())
        .any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::ForStatement(_)
                    | AstKind::ForInStatement(_)
                    | AstKind::ForOfStatement(_)
                    | AstKind::WhileStatement(_)
                    | AstKind::DoWhileStatement(_)
            )
        });
    !inside_loop
        || handlers.iter().any(|handler_id| {
            let handler = ctx.nodes().get_node(*handler_id);
            ctx.nodes().cfg_id(handler.id()) == ctx.nodes().cfg_id(anchor.id())
                && handler.span().start > anchor.span().start
        })
}

fn collect_binding_rejection_handler_nodes<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
    visited: &mut FxHashSet<SymbolId>,
) -> Vec<NodeId> {
    if !visited.insert(symbol_id) {
        return Vec::new();
    }
    let mut handlers = Vec::new();
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        if let Some(call_id) =
            reference_rejection_handler_call(reference_node, ctx, node_index, resolution_cache)
        {
            handlers.push(call_id);
            continue;
        }
        let parent = ctx.nodes().parent_node(reference_node.id());
        let AstKind::VariableDeclarator(declarator) = parent.kind() else {
            continue;
        };
        if declarator
            .init
            .as_ref()
            .is_none_or(|initializer| initializer.span() != reference_node.span())
        {
            continue;
        }
        let Some(alias_binding) = declarator.id.get_binding_identifier() else {
            continue;
        };
        if !matches!(ctx.nodes().parent_kind(parent.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
            || ctx
                .scoping()
                .get_resolved_references(alias_binding.symbol_id())
                .any(|reference| reference.is_write())
        {
            continue;
        }
        handlers.extend(collect_binding_rejection_handler_nodes(
            alias_binding.symbol_id(),
            ctx,
            node_index,
            resolution_cache,
            visited,
        ));
    }
    handlers
}

fn reference_rejection_handler_call<'a>(
    reference: &AstNode<'a>,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<NodeId> {
    let member_node = ctx.nodes().parent_node(reference.id());
    let member = member_node.kind().as_member_expression_kind()?;
    if member.object().span() != reference.span() {
        return None;
    }
    let call_node = ctx.nodes().parent_node(member_node.id());
    let AstKind::CallExpression(call) = call_node.kind() else {
        return None;
    };
    if call.callee.span() != member_node.span() {
        return None;
    }
    let walk = walk_promise_chain(call_node, ctx, node_index, resolution_cache);
    (walk.has_catch || walk.has_rejection_handler_argument).then_some(call_node.id())
}

fn walk_promise_chain<'a>(
    chain: &AstNode<'a>,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> ChainWalk {
    let mut result = ChainWalk::default();
    let mut cursor = inner_expression_node(chain, ctx, node_index);
    let mut reached_terminal_then = false;
    loop {
        let AstKind::CallExpression(call) = cursor.kind() else {
            break;
        };
        let Some(member) = call.callee.as_member_expression() else {
            break;
        };
        let Some(method_name) = member.static_property_name() else {
            break;
        };
        if !matches!(method_name, "then" | "catch" | "finally") {
            break;
        }
        let rejection_argument = if method_name == "catch" {
            call.arguments.first().and_then(Argument::as_expression)
        } else {
            call.arguments.get(1).and_then(Argument::as_expression)
        };
        if !reached_terminal_then
            && method_name == "catch"
            && has_rejection_handler(
                cursor,
                rejection_argument,
                true,
                ctx,
                node_index,
                resolution_cache,
            )
        {
            result.has_catch = true;
        }
        if method_name == "then" {
            if !reached_terminal_then
                && has_rejection_handler(
                    cursor,
                    rejection_argument,
                    false,
                    ctx,
                    node_index,
                    resolution_cache,
                )
            {
                result.has_rejection_handler_argument = true;
            }
            reached_terminal_then = true;
            result.saw_then = true;
            if let Some(callback) = call.arguments.first().and_then(Argument::as_expression) {
                if let Some(callback_id) =
                    exact_local_function_id(callback, ctx, &mut Vec::new(), resolution_cache)
                {
                    result.then_callback_ids.push(callback_id);
                } else if let Expression::Identifier(identifier) = callback.get_inner_expression()
                    && is_react_hook_result_reference(
                        identifier,
                        &["useState", "useReducer"],
                        Some(1),
                        ctx,
                    )
                {
                    result.has_direct_setter_then_callback = true;
                }
            }
        }
        let Some(object_node) = node_for_expression(member.object(), ctx, node_index) else {
            break;
        };
        cursor = inner_expression_node(object_node, ctx, node_index);
    }
    result.root_id = Some(cursor.id());
    result
}

fn resolve_root_initiator<'a>(
    root_id: NodeId,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> (NodeId, bool) {
    let mut cursor_id = root_id;
    let mut has_handler = false;
    let mut visited = FxHashSet::default();
    loop {
        let cursor = ctx.nodes().get_node(cursor_id);
        let chain = walk_promise_chain(cursor, ctx, node_index, resolution_cache);
        if chain.root_id.is_some_and(|next_id| next_id != cursor_id) {
            has_handler |= chain.has_catch || chain.has_rejection_handler_argument;
            cursor_id = chain.root_id.unwrap_or(cursor_id);
            continue;
        }
        let AstKind::IdentifierReference(identifier) = cursor.kind() else {
            break;
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            break;
        };
        if !visited.insert(symbol_id) {
            break;
        }
        let Some(initializer) = direct_const_initializer(symbol_id, ctx) else {
            break;
        };
        if matches!(
            initializer.get_inner_expression(),
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        ) {
            break;
        }
        let Some(initializer_node) = node_for_expression(initializer, ctx, node_index) else {
            break;
        };
        cursor_id = inner_expression_node(initializer_node, ctx, node_index).id();
    }
    (cursor_id, has_handler)
}

fn has_rejection_handler<'a>(
    chain: &AstNode<'a>,
    argument: Option<&Expression<'a>>,
    allow_terminal_block: bool,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let Some(argument) = argument else {
        return false;
    };
    let argument_node = node_for_expression(argument, ctx, node_index)
        .map(|node| inner_expression_node(node, ctx, node_index));
    let Some(argument_node) = argument_node else {
        return false;
    };
    let handler_id = exact_local_function_id(argument, ctx, &mut Vec::new(), resolution_cache);
    if handler_id.is_some_and(|handler_id| {
        !handler_has_potentially_throwing_member_read(handler_id, ctx, node_index)
            && handler_is_known_non_rejecting(handler_id, ctx, node_index)
    }) || chain_carries_rejection_handler(chain, ctx, node_index, resolution_cache)
        && handler_id.is_some_and(|handler_id| {
            !handler_has_potentially_throwing_member_read(handler_id, ctx, node_index)
        })
    {
        return true;
    }
    if !allow_terminal_block {
        return false;
    }
    let Some(handler_id) = handler_id else {
        return matches!(
            argument_node.kind(),
            AstKind::IdentifierReference(_)
                | AstKind::StaticMemberExpression(_)
                | AstKind::ComputedMemberExpression(_)
                | AstKind::PrivateFieldExpression(_)
        ) && !matches!(argument_node.kind(), AstKind::IdentifierReference(identifier) if identifier.name == "undefined");
    };
    let handler = ctx.nodes().get_node(handler_id);
    if matches!(handler.kind(), AstKind::ArrowFunctionExpression(function) if function.get_expression().is_some())
    {
        return false;
    }
    !node_index.owned_node_ids(handler_id).any(|node_id| {
        let node = ctx.nodes().get_node(node_id);
        match node.kind() {
            AstKind::ThrowStatement(_) | AstKind::AwaitExpression(_) => true,
            AstKind::ReturnStatement(statement) => {
                statement.argument.as_ref().is_some_and(|argument| {
                    !is_known_non_rejecting_value(argument, ctx, &mut FxHashSet::default())
                })
            }
            _ => false,
        }
    })
}

fn chain_carries_rejection_handler<'a>(
    chain: &AstNode<'a>,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let mut cursor = inner_expression_node(chain, ctx, node_index);
    loop {
        let AstKind::CallExpression(call) = cursor.kind() else {
            return false;
        };
        let Some(member) = call.callee.as_member_expression() else {
            return false;
        };
        match member.static_property_name() {
            Some("catch") => {
                if call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|handler| {
                        exact_local_function_id(handler, ctx, &mut Vec::new(), resolution_cache)
                            .is_some_and(|handler_id| {
                                handler_is_known_non_rejecting(handler_id, ctx, node_index)
                            })
                    })
                {
                    return true;
                }
            }
            Some("then") => {
                if call
                    .arguments
                    .get(1)
                    .and_then(Argument::as_expression)
                    .is_some_and(|handler| {
                        exact_local_function_id(handler, ctx, &mut Vec::new(), resolution_cache)
                            .is_some_and(|handler_id| {
                                handler_is_known_non_rejecting(handler_id, ctx, node_index)
                            })
                    })
                {
                    return true;
                }
            }
            Some("finally") => {}
            _ => return false,
        }
        let Some(object_node) = node_for_expression(member.object(), ctx, node_index) else {
            return false;
        };
        cursor = inner_expression_node(object_node, ctx, node_index);
    }
}

fn handler_is_known_non_rejecting<'a>(
    handler_id: NodeId,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
) -> bool {
    let handler = ctx.nodes().get_node(handler_id);
    if let AstKind::ArrowFunctionExpression(function) = handler.kind()
        && let Some(expression) = function.get_expression()
    {
        return handler_expression_is_non_throwing(expression, ctx);
    }
    let mut found_known_call = false;
    for node_id in node_index.owned_node_ids(handler_id) {
        let node = ctx.nodes().get_node(node_id);
        match node.kind() {
            AstKind::ThrowStatement(_)
            | AstKind::AwaitExpression(_)
            | AstKind::NewExpression(_) => return false,
            AstKind::ReturnStatement(statement)
                if statement.argument.as_ref().is_some_and(|argument| {
                    !is_known_non_rejecting_value(argument, ctx, &mut FxHashSet::default())
                        && !matches!(
                            argument.get_inner_expression(),
                            Expression::CallExpression(_)
                        )
                }) =>
            {
                return false;
            }
            AstKind::CallExpression(call) => {
                if is_proven_non_throwing_call(call, ctx)
                    || matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                    if is_react_hook_result_reference(identifier, &["useState", "useReducer"], Some(1), ctx)
                        && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(|symbol_id| {
                            !ctx.scoping().get_resolved_references(symbol_id).any(|reference| reference.is_write())
                        }))
                {
                    found_known_call = true;
                } else if !is_global_promise_resolve_call(call, ctx) {
                    return false;
                }
            }
            _ => {}
        }
    }
    found_known_call
}

fn handler_expression_is_non_throwing<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => {
            is_proven_non_throwing_call(call, ctx)
                || is_global_promise_resolve_call(call, ctx)
                || matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if is_react_hook_result_reference(identifier, &["useState", "useReducer"], Some(1), ctx)
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(|symbol_id| {
                        !ctx.scoping().get_resolved_references(symbol_id).any(|reference| reference.is_write())
                    }))
        }
        _ => is_known_non_rejecting_value(expression, ctx, &mut FxHashSet::default()),
    }
}

fn handler_has_potentially_throwing_member_read<'a>(
    handler_id: NodeId,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
) -> bool {
    node_index.owned_node_ids(handler_id).any(|node_id| {
        let node = ctx.nodes().get_node(node_id);
        let Some(member) = node.kind().as_member_expression_kind() else {
            return false;
        };
        let parent = ctx.nodes().parent_node(node.id());
        if let AstKind::CallExpression(call) = parent.kind()
            && call.callee.span() == node.span()
            && (is_proven_non_throwing_call(call, ctx) || is_global_promise_resolve_call(call, ctx))
        {
            return false;
        }
        member.span().start != 0
    })
}

fn is_known_non_rejecting_value<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    if is_definitely_non_thenable_value(expression) {
        return true;
    }
    match expression.get_inner_expression() {
        Expression::Identifier(identifier)
            if identifier.name == "undefined" && is_global_reference(identifier, ctx) =>
        {
            true
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            visited.insert(symbol_id)
                && direct_unreassigned_initializer(symbol_id, ctx).is_some_and(|initializer| {
                    is_known_non_rejecting_value(initializer, ctx, visited)
                })
        }
        Expression::CallExpression(call) => {
            is_global_promise_resolve_call(call, ctx)
                && call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_none_or(|argument| is_known_non_rejecting_value(argument, ctx, visited))
        }
        _ => false,
    }
}

fn is_definitely_non_thenable_value(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::TemplateLiteral(_) => true,
        Expression::ArrayExpression(array) => array
            .elements
            .iter()
            .all(|element| !matches!(element, ArrayExpressionElement::SpreadElement(_))),
        Expression::ObjectExpression(object) => object.properties.iter().all(|property| {
            matches!(property, ObjectPropertyKind::ObjectProperty(property)
                if property.kind == oxc_ast::ast::PropertyKind::Init
                    && !property.computed
                    && is_definitely_non_thenable_value(&property.value))
        }),
        _ => false,
    }
}

fn is_global_promise_resolve_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    receiver.name == "Promise"
        && is_global_reference(receiver, ctx)
        && member.static_property_name() == Some("resolve")
}

fn is_proven_non_throwing_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    if !is_global_reference(receiver, ctx) {
        return false;
    }
    let method_name = member.static_property_name();
    receiver.name == "performance" && method_name == Some("now") && call.arguments.is_empty()
        || receiver.name == "console"
            && matches!(
                method_name,
                Some("debug" | "error" | "info" | "log" | "trace" | "warn")
            )
        || receiver.name == "Math"
            && method_name == Some("round")
            && call.arguments.len() == 1
            && call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|argument| {
                    is_proven_non_throwing_number_expression(
                        argument,
                        ctx,
                        &mut FxHashSet::default(),
                    )
                })
}

fn is_proven_non_throwing_number_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(_) => true,
        Expression::CallExpression(call) => {
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            matches!(member.object().get_inner_expression(), Expression::Identifier(receiver)
                if receiver.name == "performance" && is_global_reference(receiver, ctx))
                && member.static_property_name() == Some("now")
                && call.arguments.is_empty()
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited.insert(symbol_id) {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                && declaration.span().start < identifier.span().start
                && !ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_write())
                && declarator.init.as_ref().is_some_and(|initializer| {
                    is_proven_non_throwing_number_expression(initializer, ctx, visited)
                })
        }
        Expression::UnaryExpression(unary)
            if matches!(
                unary.operator,
                UnaryOperator::UnaryPlus | UnaryOperator::UnaryNegation
            ) =>
        {
            is_proven_non_throwing_number_expression(&unary.argument, ctx, visited)
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Addition
                    | BinaryOperator::Subtraction
                    | BinaryOperator::Multiplication
                    | BinaryOperator::Division
                    | BinaryOperator::Remainder
                    | BinaryOperator::Exponential
            ) =>
        {
            is_proven_non_throwing_number_expression(&binary.left, ctx, &mut visited.clone())
                && is_proven_non_throwing_number_expression(
                    &binary.right,
                    ctx,
                    &mut visited.clone(),
                )
        }
        _ => false,
    }
}

fn callback_has_unguarded_state_side_effect<'a>(
    callback_id: NodeId,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
) -> bool {
    node_index
        .owned_node_ids(callback_id)
        .any(|node_id| is_state_side_effect(ctx.nodes().get_node(node_id), ctx))
}

fn is_state_side_effect<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    match node.kind() {
        AstKind::CallExpression(call) => matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
            if is_react_hook_result_reference(identifier, &["useState", "useReducer"], Some(1), ctx)),
        AstKind::AssignmentExpression(assignment) => assignment.left.as_member_expression().is_some_and(|member| {
            member.static_property_name() == Some("current")
                && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                    if is_react_hook_result_reference(identifier, &["useRef"], None, ctx))
        }),
        _ => false,
    }
}

fn is_react_hook_result_reference<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    hook_names: &[&str],
    destructure_index: Option<usize>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(mut symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let mut visited = FxHashSet::default();
    loop {
        if !visited.insert(symbol_id) {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if let Some(binding) = declarator.id.get_binding_identifier()
            && binding.symbol_id() == symbol_id
            && matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
            && let Some(Expression::Identifier(alias)) = declarator
                .init
                .as_ref()
                .map(Expression::get_inner_expression)
            && let Some(alias_symbol) = ctx
                .scoping()
                .get_reference(alias.reference_id())
                .symbol_id()
        {
            symbol_id = alias_symbol;
            continue;
        }
        let binding_matches = match destructure_index {
            Some(index) => matches!(&declarator.id, BindingPattern::ArrayPattern(pattern)
                if pattern.elements.get(index).and_then(|element| element.as_ref()).and_then(BindingPattern::get_binding_identifier).is_some_and(|binding| binding.symbol_id() == symbol_id)),
            None => declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id),
        };
        if !binding_matches {
            return false;
        }
        let Some(Expression::CallExpression(hook_call)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            return false;
        };
        return hook_names
            .iter()
            .any(|hook_name| promise_effect_is_react_hook_result_call(hook_call, hook_name, ctx));
    }
}

fn is_provably_rejectable_expression<'a>(
    node_id: NodeId,
    remaining_depth: usize,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
    function_cache: &mut FxHashMap<(NodeId, usize), bool>,
) -> bool {
    let node = inner_expression_node(ctx.nodes().get_node(node_id), ctx, node_index);
    match node.kind() {
        AstKind::ImportExpression(_) => true,
        AstKind::AwaitExpression(await_expression) => {
            node_for_expression(&await_expression.argument, ctx, node_index).is_some_and(
                |argument| {
                    is_provably_rejectable_expression(
                        argument.id(),
                        remaining_depth,
                        ctx,
                        node_index,
                        resolution_cache,
                        function_cache,
                    )
                },
            )
        }
        AstKind::CallExpression(call) => match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => {
                if identifier.name == "fetch" && is_global_reference(identifier, ctx) {
                    return true;
                }
                if remaining_depth == 0 {
                    return false;
                }
                if let Some(function_id) =
                    exact_local_function_id(&call.callee, ctx, &mut Vec::new(), resolution_cache)
                {
                    return function_has_unhandled_rejectable_source(
                        function_id,
                        remaining_depth - 1,
                        ctx,
                        node_index,
                        resolution_cache,
                        function_cache,
                    );
                }
                let Some(symbol_id) = ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                else {
                    return false;
                };
                direct_const_initializer(symbol_id, ctx)
                    .map(Expression::get_inner_expression)
                    .and_then(Expression::as_member_expression)
                    .is_some_and(|member| {
                        member_lookup_rejectable(
                            member,
                            remaining_depth - 1,
                            ctx,
                            node_index,
                            resolution_cache,
                            function_cache,
                        )
                    })
            }
            _ => {
                let Some(member) = call.callee.as_member_expression() else {
                    return false;
                };
                if let Expression::Identifier(receiver) = member.object().get_inner_expression()
                    && receiver.name == "Promise"
                    && is_global_reference(receiver, ctx)
                    && matches!(member.static_property_name(), Some("all" | "race" | "any"))
                {
                    let Some(Expression::ArrayExpression(array)) = call
                        .arguments
                        .first()
                        .and_then(Argument::as_expression)
                        .map(Expression::get_inner_expression)
                    else {
                        return false;
                    };
                    return array.elements.iter().any(|element| {
                        let Some(expression) = element.as_expression() else {
                            return false;
                        };
                        let Some(element_node) = node_for_expression(expression, ctx, node_index)
                        else {
                            return false;
                        };
                        let (initiator, handled) = resolve_root_initiator(
                            element_node.id(),
                            ctx,
                            node_index,
                            resolution_cache,
                        );
                        !handled
                            && is_provably_rejectable_expression(
                                initiator,
                                remaining_depth,
                                ctx,
                                node_index,
                                resolution_cache,
                                function_cache,
                            )
                    });
                }
                remaining_depth > 0
                    && member_lookup_rejectable(
                        member,
                        remaining_depth - 1,
                        ctx,
                        node_index,
                        resolution_cache,
                        function_cache,
                    )
            }
        },
        _ => false,
    }
}

fn member_lookup_rejectable<'a>(
    member: &oxc_ast::ast::MemberExpression<'a>,
    remaining_depth: usize,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
    function_cache: &mut FxHashMap<(NodeId, usize), bool>,
) -> bool {
    let object = member.object().get_inner_expression();
    let object = if let Expression::Identifier(identifier) = object {
        ctx.scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .and_then(|symbol_id| direct_const_initializer(symbol_id, ctx))
            .map(Expression::get_inner_expression)
            .unwrap_or(object)
    } else {
        object
    };
    let Expression::ObjectExpression(object) = object else {
        return false;
    };
    let property_name = member.static_property_name();
    if property_name.is_none()
        && object
            .properties
            .iter()
            .any(|property| matches!(property, ObjectPropertyKind::SpreadProperty(_)))
    {
        return false;
    }
    let candidates = object
        .properties
        .iter()
        .filter_map(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            if let Some(expected) = property_name {
                let key_matches = match &property.key {
                    PropertyKey::StaticIdentifier(identifier) => identifier.name == expected,
                    PropertyKey::StringLiteral(literal) => literal.value == expected,
                    _ => false,
                };
                if !key_matches {
                    return None;
                }
            }
            Some(&property.value)
        })
        .collect::<Vec<_>>();
    !candidates.is_empty()
        && candidates.iter().all(|value| {
            node_for_expression(value, ctx, node_index)
                .and_then(|node| {
                    exact_local_function_id(value, ctx, &mut Vec::new(), resolution_cache)
                        .map(|id| (node, id))
                })
                .is_some_and(|(_, function_id)| {
                    function_has_unhandled_rejectable_source(
                        function_id,
                        remaining_depth,
                        ctx,
                        node_index,
                        resolution_cache,
                        function_cache,
                    )
                })
        })
}

fn function_has_unhandled_rejectable_source<'a>(
    function_id: NodeId,
    remaining_depth: usize,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
    function_cache: &mut FxHashMap<(NodeId, usize), bool>,
) -> bool {
    if let Some(cached) = function_cache.get(&(function_id, remaining_depth)) {
        return *cached;
    }
    function_cache.insert((function_id, remaining_depth), false);
    let function = ctx.nodes().get_node(function_id);
    if let AstKind::ArrowFunctionExpression(arrow) = function.kind()
        && let Some(expression) = arrow.get_expression()
        && let Some(expression_node) = node_for_expression(expression, ctx, node_index)
    {
        let chain = walk_promise_chain(expression_node, ctx, node_index, resolution_cache);
        if !chain.has_catch
            && !chain.has_rejection_handler_argument
            && chain.root_id.is_some_and(|root| {
                is_provably_rejectable_expression(
                    root,
                    remaining_depth,
                    ctx,
                    node_index,
                    resolution_cache,
                    function_cache,
                )
            })
        {
            function_cache.insert((function_id, remaining_depth), true);
            return true;
        }
    }
    for node_id in node_index.owned_node_ids(function_id) {
        let node = ctx.nodes().get_node(node_id);
        if matches!(node.kind(), AstKind::ThrowStatement(_))
            && !inside_swallowing_try(node.id(), function_id, ctx, node_index)
        {
            function_cache.insert((function_id, remaining_depth), true);
            return true;
        }
        let candidate = match node.kind() {
            AstKind::AwaitExpression(await_expression)
                if !inside_swallowing_try(node.id(), function_id, ctx, node_index) =>
            {
                node_for_expression(&await_expression.argument, ctx, node_index)
            }
            AstKind::ReturnStatement(statement) => {
                let candidate = statement
                    .argument
                    .as_ref()
                    .and_then(|argument| node_for_expression(argument, ctx, node_index));
                if candidate.is_some_and(|candidate| {
                    matches!(candidate.kind(), AstKind::AwaitExpression(_))
                        && inside_swallowing_try(candidate.id(), function_id, ctx, node_index)
                }) {
                    None
                } else {
                    candidate
                }
            }
            _ => None,
        };
        let Some(candidate) = candidate else {
            continue;
        };
        let chain = walk_promise_chain(candidate, ctx, node_index, resolution_cache);
        if !chain.has_catch
            && !chain.has_rejection_handler_argument
            && chain.root_id.is_some_and(|root| {
                is_provably_rejectable_expression(
                    root,
                    remaining_depth,
                    ctx,
                    node_index,
                    resolution_cache,
                    function_cache,
                )
            })
        {
            function_cache.insert((function_id, remaining_depth), true);
            return true;
        }
    }
    false
}

fn inside_swallowing_try<'a>(
    node_id: NodeId,
    function_id: NodeId,
    ctx: &LintContext<'a>,
    node_index: &PromiseNodeIndex,
) -> bool {
    let mut child = ctx.nodes().get_node(node_id);
    for ancestor in ctx.nodes().ancestors(node_id).skip(1) {
        if ancestor.id() == function_id {
            break;
        }
        if let AstKind::TryStatement(statement) = ancestor.kind()
            && statement.block.span.contains_inclusive(child.span())
            && statement.handler.as_ref().is_some_and(|handler| {
                !node_index.owned_throw_node_ids(function_id).any(|node_id| {
                    let node = ctx.nodes().get_node(node_id);
                    handler.body.span.contains_inclusive(node.span())
                })
            })
        {
            return true;
        }
        child = ancestor;
    }
    false
}

fn direct_const_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    if ctx
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
    matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        .then(|| declarator.init.as_ref()).flatten()
}

fn direct_unreassigned_initializer<'a>(
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

fn assignment_target_symbol_id<'a>(
    target: &oxc_ast::ast::AssignmentTarget<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let oxc_ast::ast::SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) =
        target.as_simple_assignment_target()?
    else {
        return None;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn inner_expression_node<'node, 'ast>(
    node: &'node AstNode<'ast>,
    ctx: &'node LintContext<'ast>,
    node_index: &PromiseNodeIndex,
) -> &'node AstNode<'ast> {
    let mut current = node;
    loop {
        let next = match current.kind() {
            AstKind::ParenthesizedExpression(expression) => {
                node_for_expression(&expression.expression, ctx, node_index)
            }
            AstKind::TSAsExpression(expression) => {
                node_for_expression(&expression.expression, ctx, node_index)
            }
            AstKind::TSSatisfiesExpression(expression) => {
                node_for_expression(&expression.expression, ctx, node_index)
            }
            AstKind::TSTypeAssertion(expression) => {
                node_for_expression(&expression.expression, ctx, node_index)
            }
            AstKind::TSNonNullExpression(expression) => {
                node_for_expression(&expression.expression, ctx, node_index)
            }
            AstKind::TSInstantiationExpression(expression) => {
                node_for_expression(&expression.expression, ctx, node_index)
            }
            AstKind::ChainExpression(expression) => node_index
                .node_id_for_span(expression.expression.span())
                .map(|node_id| ctx.nodes().get_node(node_id)),
            _ => None,
        };
        let Some(next) = next else {
            return current;
        };
        if next.id() == current.id() {
            return current;
        }
        current = next;
    }
}

fn node_for_expression<'node, 'ast>(
    expression: &Expression<'ast>,
    ctx: &'node LintContext<'ast>,
    node_index: &PromiseNodeIndex,
) -> Option<&'node AstNode<'ast>> {
    node_index
        .node_id_for_span(expression.span())
        .map(|node_id| ctx.nodes().get_node(node_id))
}

fn is_global_reference<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_none()
}
