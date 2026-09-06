use oxc_ast::{
    AstKind,
    ast::{
        Argument, AssignmentTarget, BindingPattern, Expression, Statement, VariableDeclarationKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{AstNode, context::LintContext, rule::Rule};

const SET_STATE_AFTER_AWAIT_EFFECT_HOOKS: [&str; 2] = ["useEffect", "useLayoutEffect"];
const SET_STATE_AFTER_AWAIT_STATE_HOOKS: [&str; 2] = ["useState", "useReducer"];
const SET_STATE_AFTER_AWAIT_REF_HOOKS: [&str; 1] = ["useRef"];
const SET_STATE_AFTER_AWAIT_PROMISE_CALLBACKS: [&str; 3] = ["then", "catch", "finally"];
const MESSAGE: &str = "This setter runs after `await`, so overlapping re-runs of the effect can resolve out of order and write stale state; gate it behind a cancellation/ignore flag or return a cleanup that cancels the work.";

#[derive(Debug, Default, Clone)]
pub struct NoSetStateAfterAwaitInEffect;

declare_oxc_lint!(
    /// Warns when an effect can write stale state after suspension.
    NoSetStateAfterAwaitInEffect,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "State update after await in an effect.",
);

#[derive(Default)]
struct SetStateAfterAwaitCleanup {
    boolean_writes: FxHashMap<String, bool>,
    aborted_controllers: FxHashSet<String>,
}

#[derive(Clone)]
struct SetStateAfterAwaitSnapshot {
    binding_key: String,
    counter_key: String,
}

#[derive(Default)]
struct SetStateAfterAwaitIndex {
    own_node_ids: FxHashMap<NodeId, Vec<NodeId>>,
}

impl Rule for NoSetStateAfterAwaitInEffect {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let index = set_state_after_await_build_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        for effect_node in ctx.nodes().iter() {
            let AstKind::CallExpression(effect_call) = effect_node.kind() else {
                continue;
            };
            if !set_state_after_await_is_effect_call(effect_call, ctx)
                || set_state_after_await_has_only_stable_dependencies(effect_call, ctx)
            {
                continue;
            }
            let Some(callback_expression) = effect_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) = set_state_after_await_direct_function_id(callback_expression)
            else {
                continue;
            };
            if set_state_after_await_function_is_async(callback_id, ctx) {
                continue;
            }

            let invocation_graph = set_state_after_await_invocation_graph(
                callback_id,
                &index,
                ctx,
                &mut resolution_cache,
            );
            let mut invoked_function_ids = invocation_graph.keys().copied().collect::<Vec<_>>();
            invoked_function_ids.sort_unstable_by_key(|function_id| {
                ctx.nodes().get_node(*function_id).span().start
            });
            if invoked_function_ids.into_iter().any(|function_id| {
                function_id != callback_id
                    && set_state_after_await_function_is_async(function_id, ctx)
                    && set_state_after_await_function_is_unsafe(
                        function_id,
                        callback_id,
                        &invocation_graph,
                        &index,
                        ctx,
                    )
            }) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(effect_call.span));
            }
        }
    }
}

fn set_state_after_await_is_effect_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let callee = call.callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return SET_STATE_AFTER_AWAIT_EFFECT_HOOKS.contains(&identifier.name.as_str());
        };
        return matching_react_import(symbol_id, ctx).is_some_and(|entry| {
            matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if SET_STATE_AFTER_AWAIT_EFFECT_HOOKS
                        .iter()
                        .any(|hook_name| imported_name.name() == *hook_name)
            )
        });
    }
    callee.as_member_expression().is_some_and(|member| {
        member
            .static_property_name()
            .is_some_and(|name| SET_STATE_AFTER_AWAIT_EFFECT_HOOKS.contains(&name))
            && is_react_namespace_receiver(member.object().get_inner_expression(), ctx)
    })
}

fn set_state_after_await_is_hook_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    hook_names: &[&str],
    ctx: &LintContext<'a>,
) -> bool {
    hook_names
        .iter()
        .any(|hook_name| is_react_api_call(call, hook_name, ctx))
        || matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
            if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
                && hook_names.contains(&identifier.name.as_str()))
}

fn set_state_after_await_has_only_stable_dependencies(
    effect_call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(Expression::ArrayExpression(dependencies)) = effect_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    dependencies.elements.iter().all(|element| {
        let Some(Expression::Identifier(identifier)) = element.as_expression() else {
            return false;
        };
        set_state_after_await_is_hook_result(
            identifier,
            &SET_STATE_AFTER_AWAIT_STATE_HOOKS,
            Some(1),
            ctx,
        ) || set_state_after_await_is_hook_result(
            identifier,
            &SET_STATE_AFTER_AWAIT_REF_HOOKS,
            None,
            ctx,
        ) || set_state_after_await_is_module_const(identifier, ctx)
            || set_state_after_await_is_empty_use_callback(identifier, ctx)
    })
}

fn set_state_after_await_is_hook_result(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    hook_names: &[&str],
    tuple_index: Option<usize>,
    ctx: &LintContext<'_>,
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
            && let Some(alias_symbol_id) = ctx
                .scoping()
                .get_reference(alias.reference_id())
                .symbol_id()
        {
            symbol_id = alias_symbol_id;
            continue;
        }
        let binding_matches = match tuple_index {
            Some(index) => matches!(&declarator.id, BindingPattern::ArrayPattern(pattern)
                if pattern.elements.get(index).and_then(Option::as_ref).and_then(BindingPattern::get_binding_identifier).is_some_and(|binding| binding.symbol_id() == symbol_id)),
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
        return set_state_after_await_is_hook_call(hook_call, hook_names, ctx);
    }
}

fn set_state_after_await_is_module_const(
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
    match declaration.kind() {
        AstKind::ImportSpecifier(_)
        | AstKind::ImportDefaultSpecifier(_)
        | AstKind::ImportNamespaceSpecifier(_) => true,
        AstKind::VariableDeclarator(declarator)
            if set_state_after_await_binding_pattern_has_symbol(&declarator.id, symbol_id)
                && matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const()) =>
        {
            set_state_after_await_nearest_function_id(declaration.id(), ctx).is_none()
        }
        _ => false,
    }
}

fn set_state_after_await_binding_pattern_has_symbol(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.symbol_id() == symbol_id,
        BindingPattern::AssignmentPattern(assignment) => {
            set_state_after_await_binding_pattern_has_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ArrayPattern(pattern) => {
            pattern
                .elements
                .iter()
                .flatten()
                .any(|element| set_state_after_await_binding_pattern_has_symbol(element, symbol_id))
                || pattern.rest.as_ref().is_some_and(|rest| {
                    set_state_after_await_binding_pattern_has_symbol(&rest.argument, symbol_id)
                })
        }
        BindingPattern::ObjectPattern(pattern) => {
            pattern.properties.iter().any(|property| {
                set_state_after_await_binding_pattern_has_symbol(&property.value, symbol_id)
            }) || pattern.rest.as_ref().is_some_and(|rest| {
                set_state_after_await_binding_pattern_has_symbol(&rest.argument, symbol_id)
            })
        }
    }
}

fn set_state_after_await_is_empty_use_callback(
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
    let Some(binding) = declarator.id.get_binding_identifier() else {
        return false;
    };
    let Some(Expression::CallExpression(call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    binding.symbol_id() == symbol_id
        && is_react_api_call(call, "useCallback", ctx)
        && matches!(call.arguments.get(1).and_then(Argument::as_expression).map(Expression::get_inner_expression), Some(Expression::ArrayExpression(array)) if array.elements.is_empty())
}

fn set_state_after_await_invocation_graph(
    callback_id: NodeId,
    index: &SetStateAfterAwaitIndex,
    ctx: &LintContext<'_>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> FxHashMap<NodeId, Vec<NodeId>> {
    let mut graph = FxHashMap::default();
    let mut pending = vec![callback_id];
    while let Some(function_id) = pending.pop() {
        if graph.contains_key(&function_id) {
            continue;
        }
        let mut invoked = Vec::new();
        for node in set_state_after_await_own_nodes(function_id, index, ctx) {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            if let Some(callee_id) = set_state_after_await_resolve_invoked_function(
                &call.callee,
                node,
                ctx,
                resolution_cache,
            ) {
                invoked.push(callee_id);
            }
            let promise_callback = call
                .callee
                .get_inner_expression()
                .as_member_expression()
                .is_some_and(|member| {
                    let method_matches = match member {
                        oxc_ast::ast::MemberExpression::StaticMemberExpression(member) => {
                            SET_STATE_AFTER_AWAIT_PROMISE_CALLBACKS
                                .contains(&member.property.name.as_str())
                        }
                        oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) => {
                            matches!(member.expression.get_inner_expression(), Expression::Identifier(identifier)
                                if SET_STATE_AFTER_AWAIT_PROMISE_CALLBACKS.contains(&identifier.name.as_str()))
                        }
                        oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => false,
                    };
                    method_matches
                        && matches!(
                            member.object().get_inner_expression(),
                            Expression::CallExpression(_)
                        )
                });
            if promise_callback {
                for argument in &call.arguments {
                    let Some(expression) = argument.as_expression() else {
                        continue;
                    };
                    if let Some(callback_id) = set_state_after_await_resolve_invoked_function(
                        expression,
                        node,
                        ctx,
                        resolution_cache,
                    ) {
                        invoked.push(callback_id);
                    }
                }
            }
        }
        invoked.sort_unstable();
        invoked.dedup();
        pending.extend(invoked.iter().copied());
        graph.insert(function_id, invoked);
    }
    graph
}

fn set_state_after_await_resolve_invoked_function<'a>(
    expression: &Expression<'a>,
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<NodeId> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression
        && let Some(function_id) = set_state_after_await_mutable_function_id(
            identifier,
            call_node,
            ctx,
            &mut FxHashSet::default(),
        )
    {
        return Some(function_id);
    }
    exact_local_function_id_including_generators(expression, ctx, &mut Vec::new(), resolution_cache)
}

fn set_state_after_await_mutable_function_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    call_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited.insert(symbol_id) {
        return None;
    }
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
    let initializer = declarator.init.as_ref()?;
    let AstKind::VariableDeclaration(variable) = ctx.nodes().parent_kind(declaration.id()) else {
        return None;
    };
    if variable.kind.is_const()
        && let Expression::Identifier(alias) = initializer.get_inner_expression()
    {
        return set_state_after_await_mutable_function_id(alias, call_node, ctx, visited);
    }
    if !matches!(
        variable.kind,
        VariableDeclarationKind::Let | VariableDeclarationKind::Var
    ) || ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| reference.is_write())
    {
        return None;
    }
    let initializer_node = set_state_after_await_node_for_expression(initializer, ctx)?;
    if initializer_node.span().start >= call_node.span().start {
        return None;
    }
    set_state_after_await_direct_function_id(initializer)
}

fn set_state_after_await_direct_function_id(expression: &Expression<'_>) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    }
}

fn set_state_after_await_function_is_async(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn set_state_after_await_function_is_unsafe(
    function_id: NodeId,
    effect_callback_id: NodeId,
    graph: &FxHashMap<NodeId, Vec<NodeId>>,
    index: &SetStateAfterAwaitIndex,
    ctx: &LintContext<'_>,
) -> bool {
    let suspensions = set_state_after_await_own_nodes(function_id, index, ctx)
        .filter(|node| {
            matches!(node.kind(), AstKind::AwaitExpression(_))
                || matches!(node.kind(), AstKind::ForOfStatement(statement) if statement.r#await)
        })
        .map(AstNode::id)
        .collect::<Vec<_>>();
    if suspensions.is_empty() {
        return false;
    }
    let setters = set_state_after_await_own_nodes(function_id, index, ctx)
        .filter(|node| {
            matches!(node.kind(), AstKind::CallExpression(call) if set_state_after_await_is_dispatch_call(call, ctx))
        })
        .map(AstNode::id)
        .collect::<Vec<_>>();
    if setters.is_empty() {
        return false;
    }

    let mut cleanup = set_state_after_await_cleanup_for_function(
        effect_callback_id,
        function_id,
        graph,
        index,
        ctx,
    );
    let controller_keys =
        set_state_after_await_declared_controller_keys(effect_callback_id, index, ctx);
    let first_suspension_start = suspensions
        .iter()
        .map(|node_id| ctx.nodes().get_node(*node_id).span().start)
        .min()
        .unwrap_or(u32::MAX);
    let mut snapshots = set_state_after_await_sequence_snapshots(
        effect_callback_id,
        function_id,
        first_suspension_start,
        index,
        ctx,
    );
    cleanup.boolean_writes.retain(|key, _| {
        !set_state_after_await_reference_is_written_after(
            key,
            function_id,
            first_suspension_start,
            index,
            ctx,
        )
    });
    snapshots.retain(|snapshot| {
        !set_state_after_await_reference_is_written_after(
            &snapshot.counter_key,
            function_id,
            first_suspension_start,
            index,
            ctx,
        )
    });

    suspensions.iter().any(|suspension_id| {
        let suspension = ctx.nodes().get_node(*suspension_id);
        setters.iter().any(|setter_id| {
            let setter = ctx.nodes().get_node(*setter_id);
            if !set_state_after_await_suspension_can_precede_setter(
                suspension,
                setter,
                function_id,
                ctx,
            ) {
                return false;
            }
            if set_state_after_await_abort_protects_suspension(
                suspension,
                &controller_keys,
                &cleanup.aborted_controllers,
                ctx,
            ) {
                return false;
            }
            !set_state_after_await_setter_is_guarded(
                *setter_id,
                suspension,
                &cleanup.boolean_writes,
                &snapshots,
                function_id,
                ctx,
            )
        })
    })
}

fn set_state_after_await_suspension_can_precede_setter(
    suspension: &AstNode<'_>,
    setter: &AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if suspension.span().contains_inclusive(setter.span()) {
        return matches!(suspension.kind(), AstKind::ForOfStatement(statement) if statement.r#await);
    }
    if setter.span().contains_inclusive(suspension.span()) {
        return true;
    }
    let function = ctx.nodes().get_node(function_id);
    can_node_reach_later_node_within_function(suspension, setter, function, ctx)
}

fn set_state_after_await_is_dispatch_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
        if set_state_after_await_is_hook_result(identifier, &SET_STATE_AFTER_AWAIT_STATE_HOOKS, Some(1), ctx))
}

fn set_state_after_await_cleanup_for_function(
    callback_id: NodeId,
    target_id: NodeId,
    graph: &FxHashMap<NodeId, Vec<NodeId>>,
    index: &SetStateAfterAwaitIndex,
    ctx: &LintContext<'_>,
) -> SetStateAfterAwaitCleanup {
    let invocation_nodes = set_state_after_await_own_nodes(callback_id, index, ctx)
        .filter(|node| {
            let AstKind::CallExpression(call) = node.kind() else {
                return false;
            };
            let mut resolution_cache = LocalFunctionResolutionCache::default();
            set_state_after_await_resolve_invoked_function(
                &call.callee,
                node,
                ctx,
                &mut resolution_cache,
            )
            .is_some_and(|direct_id| {
                set_state_after_await_graph_reaches(direct_id, target_id, graph)
            }) || (call
                .callee
                .get_inner_expression()
                .as_member_expression()
                .and_then(|member| member.static_property_name())
                .is_some_and(|name| SET_STATE_AFTER_AWAIT_PROMISE_CALLBACKS.contains(&name))
                && call.arguments.iter().any(|argument| {
                    argument
                        .as_expression()
                        .and_then(|expression| {
                            set_state_after_await_resolve_invoked_function(
                                expression,
                                node,
                                ctx,
                                &mut resolution_cache,
                            )
                        })
                        .is_some_and(|direct_id| {
                            set_state_after_await_graph_reaches(direct_id, target_id, graph)
                        })
                }))
        })
        .collect::<Vec<_>>();
    if invocation_nodes.is_empty() {
        return SetStateAfterAwaitCleanup::default();
    }

    let function = ctx.nodes().get_node(callback_id);
    let all_returns = set_state_after_await_own_nodes(callback_id, index, ctx)
        .filter(|node| matches!(node.kind(), AstKind::ReturnStatement(_)))
        .collect::<Vec<_>>();
    let cleanup_returns = set_state_after_await_own_nodes(callback_id, index, ctx)
        .filter_map(|node| {
            let AstKind::ReturnStatement(return_statement) = node.kind() else {
                return None;
            };
            let expression = return_statement.argument.as_ref()?;
            let mut resolution_cache = LocalFunctionResolutionCache::default();
            let cleanup_id =
                exact_local_function_id(expression, ctx, &mut Vec::new(), &mut resolution_cache)?;
            Some((node, cleanup_id))
        })
        .collect::<Vec<_>>();
    if cleanup_returns.is_empty() {
        return SetStateAfterAwaitCleanup::default();
    }
    let cleanup_by_return = cleanup_returns
        .iter()
        .map(|(return_node, cleanup_id)| (return_node.id(), *cleanup_id))
        .collect::<FxHashMap<_, _>>();
    let mut cleanup_ids = Vec::new();
    for invocation in invocation_nodes {
        let later_returns = all_returns
            .iter()
            .copied()
            .filter(|return_node| {
                can_node_reach_later_node_within_function(invocation, return_node, function, ctx)
            })
            .collect::<Vec<_>>();
        if !do_nodes_cover_every_path_after_node(invocation, &later_returns, function, ctx) {
            return SetStateAfterAwaitCleanup::default();
        }
        for return_node in later_returns {
            if let Some(cleanup_id) = cleanup_by_return.get(&return_node.id()) {
                cleanup_ids.push(*cleanup_id);
                continue;
            }
            if set_state_after_await_nodes_have_contradictory_guards(invocation, return_node, ctx) {
                continue;
            }
            let AstKind::CallExpression(invocation_call) = invocation.kind() else {
                return SetStateAfterAwaitCleanup::default();
            };
            let roots = set_state_after_await_direct_invoked_ids(invocation_call, invocation, ctx);
            if set_state_after_await_has_unguarded_path_to_target(
                &roots,
                target_id,
                return_node,
                index,
                ctx,
            ) {
                return SetStateAfterAwaitCleanup::default();
            }
        }
    }
    cleanup_ids.sort_unstable();
    cleanup_ids.dedup();
    set_state_after_await_intersect_cleanup_actions(&cleanup_ids, index, ctx)
}

fn set_state_after_await_direct_invoked_ids<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Vec<NodeId> {
    let mut resolution_cache = LocalFunctionResolutionCache::default();
    let mut invoked = set_state_after_await_resolve_invoked_function(
        &call.callee,
        call_node,
        ctx,
        &mut resolution_cache,
    )
    .into_iter()
    .collect::<Vec<_>>();
    let is_promise_callback = call
        .callee
        .get_inner_expression()
        .as_member_expression()
        .and_then(|member| member.static_property_name())
        .is_some_and(|name| SET_STATE_AFTER_AWAIT_PROMISE_CALLBACKS.contains(&name));
    if is_promise_callback {
        invoked.extend(call.arguments.iter().filter_map(|argument| {
            set_state_after_await_resolve_invoked_function(
                argument.as_expression()?,
                call_node,
                ctx,
                &mut resolution_cache,
            )
        }));
    }
    invoked.sort_unstable();
    invoked.dedup();
    invoked
}

fn set_state_after_await_has_unguarded_path_to_target(
    roots: &[NodeId],
    target_id: NodeId,
    no_cleanup_return: &AstNode<'_>,
    index: &SetStateAfterAwaitIndex,
    ctx: &LintContext<'_>,
) -> bool {
    let mut pending = roots.to_vec();
    let mut visited = FxHashSet::default();
    while let Some(function_id) = pending.pop() {
        if function_id == target_id {
            return true;
        }
        if !visited.insert(function_id) {
            continue;
        }
        for node in set_state_after_await_own_nodes(function_id, index, ctx) {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            if set_state_after_await_nodes_have_contradictory_guards(node, no_cleanup_return, ctx) {
                continue;
            }
            pending.extend(set_state_after_await_direct_invoked_ids(call, node, ctx));
        }
    }
    false
}

fn set_state_after_await_nodes_have_contradictory_guards(
    left: &AstNode<'_>,
    right: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let left_guards = set_state_after_await_guard_atoms(left, ctx);
    let right_guards = set_state_after_await_guard_atoms(right, ctx);
    left_guards.iter().any(|(left_key, left_value)| {
        right_guards
            .iter()
            .any(|(right_key, right_value)| left_key == right_key && left_value != right_value)
    })
}

fn set_state_after_await_guard_atoms(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Vec<(String, bool)> {
    let node_span = node.span();
    let mut atoms = Vec::new();
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
        let (test, branch_value) = match ancestor.kind() {
            AstKind::IfStatement(statement)
                if statement.consequent.span().contains_inclusive(node_span) =>
            {
                (&statement.test, true)
            }
            AstKind::IfStatement(statement)
                if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(node_span)) =>
            {
                (&statement.test, false)
            }
            AstKind::ConditionalExpression(expression)
                if expression.consequent.span().contains_inclusive(node_span) =>
            {
                (&expression.test, true)
            }
            AstKind::ConditionalExpression(expression)
                if expression.alternate.span().contains_inclusive(node_span) =>
            {
                (&expression.test, false)
            }
            AstKind::LogicalExpression(expression)
                if expression.right.span().contains_inclusive(node_span) =>
            {
                (
                    &expression.left,
                    expression.operator == LogicalOperator::And,
                )
            }
            _ => continue,
        };
        if let Some(atom) = set_state_after_await_simple_guard_atom(test, branch_value, ctx) {
            atoms.push(atom);
        }
    }
    atoms
}

fn set_state_after_await_simple_guard_atom(
    expression: &Expression<'_>,
    branch_value: bool,
    ctx: &LintContext<'_>,
) -> Option<(String, bool)> {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            set_state_after_await_simple_guard_atom(&unary.argument, !branch_value, ctx)
        }
        expression => {
            resolve_expression_key(expression, ctx, &mut Vec::new()).map(|key| (key, branch_value))
        }
    }
}

fn set_state_after_await_graph_reaches(
    source_id: NodeId,
    target_id: NodeId,
    graph: &FxHashMap<NodeId, Vec<NodeId>>,
) -> bool {
    let mut pending = vec![source_id];
    let mut visited = FxHashSet::default();
    while let Some(function_id) = pending.pop() {
        if function_id == target_id {
            return true;
        }
        if visited.insert(function_id)
            && let Some(next) = graph.get(&function_id)
        {
            pending.extend(next.iter().copied());
        }
    }
    false
}

fn set_state_after_await_intersect_cleanup_actions(
    cleanup_ids: &[NodeId],
    index: &SetStateAfterAwaitIndex,
    ctx: &LintContext<'_>,
) -> SetStateAfterAwaitCleanup {
    let mut analyses = cleanup_ids
        .iter()
        .map(|cleanup_id| set_state_after_await_cleanup_actions(*cleanup_id, index, ctx))
        .collect::<Vec<_>>();
    let Some(first) = analyses.pop() else {
        return SetStateAfterAwaitCleanup::default();
    };
    let boolean_writes = first
        .boolean_writes
        .into_iter()
        .filter(|(key, value)| {
            analyses
                .iter()
                .all(|analysis| analysis.boolean_writes.get(key) == Some(value))
        })
        .collect();
    let aborted_controllers = first
        .aborted_controllers
        .into_iter()
        .filter(|key| {
            analyses
                .iter()
                .all(|analysis| analysis.aborted_controllers.contains(key))
        })
        .collect();
    SetStateAfterAwaitCleanup {
        boolean_writes,
        aborted_controllers,
    }
}

fn set_state_after_await_cleanup_actions(
    cleanup_id: NodeId,
    index: &SetStateAfterAwaitIndex,
    ctx: &LintContext<'_>,
) -> SetStateAfterAwaitCleanup {
    let mut cleanup = SetStateAfterAwaitCleanup::default();
    for node in set_state_after_await_own_nodes(cleanup_id, index, ctx) {
        if !set_state_after_await_action_is_unconditional(node.id(), cleanup_id, ctx) {
            continue;
        }
        if !set_state_after_await_is_direct_cleanup_action(node.id(), cleanup_id, ctx) {
            continue;
        }
        match node.kind() {
            AstKind::AssignmentExpression(assignment)
                if matches!(
                    assignment.right.get_inner_expression(),
                    Expression::BooleanLiteral(_)
                ) =>
            {
                let Expression::BooleanLiteral(value) = assignment.right.get_inner_expression()
                else {
                    continue;
                };
                if let Some(key) = set_state_after_await_assignment_key(&assignment.left, ctx) {
                    cleanup.boolean_writes.insert(key, value.value);
                }
            }
            AstKind::CallExpression(call) => {
                let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                    continue;
                };
                if member.static_property_name() == Some("abort")
                    && let Some(key) = resolve_expression_key(member.object(), ctx, &mut Vec::new())
                {
                    cleanup.aborted_controllers.insert(key);
                }
            }
            _ => {}
        }
    }
    cleanup
}

fn set_state_after_await_is_direct_cleanup_action(
    node_id: NodeId,
    cleanup_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    match ctx.nodes().parent_kind(node_id) {
        AstKind::ExpressionStatement(_) => true,
        AstKind::ArrowFunctionExpression(arrow) => arrow.node_id.get() == cleanup_id,
        _ => false,
    }
}

fn set_state_after_await_action_is_unconditional(
    node_id: NodeId,
    cleanup_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id).skip(1) {
        if ancestor.id() == cleanup_id {
            return true;
        }
        match ancestor.kind() {
            AstKind::FunctionBody(body) => {
                if !set_state_after_await_cleanup_prefix_is_unconditional(
                    &body.statements,
                    ctx.nodes().get_node(node_id).span(),
                    cleanup_id,
                    ctx,
                ) {
                    return false;
                }
            }
            AstKind::BlockStatement(block) => {
                if !set_state_after_await_cleanup_prefix_is_unconditional(
                    &block.body,
                    ctx.nodes().get_node(node_id).span(),
                    cleanup_id,
                    ctx,
                ) {
                    return false;
                }
            }
            AstKind::IfStatement(_)
            | AstKind::ConditionalExpression(_)
            | AstKind::LogicalExpression(_)
            | AstKind::SwitchCase(_)
            | AstKind::ForStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_)
            | AstKind::WhileStatement(_)
            | AstKind::DoWhileStatement(_)
            | AstKind::CatchClause(_) => return false,
            AstKind::TryStatement(statement) => {
                let span = ctx.nodes().get_node(node_id).span();
                if !statement
                    .finalizer
                    .as_ref()
                    .is_some_and(|finalizer| finalizer.span.contains_inclusive(span))
                {
                    return false;
                }
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
    }
    false
}

fn set_state_after_await_cleanup_prefix_is_unconditional(
    statements: &[Statement<'_>],
    action_span: oxc_span::Span,
    cleanup_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for statement in statements {
        if statement.span().contains_inclusive(action_span) {
            return true;
        }
        if statement.span().start >= action_span.start {
            return true;
        }
        match statement {
            Statement::ExpressionStatement(_) => {}
            Statement::BlockStatement(block) => {
                if !set_state_after_await_cleanup_prefix_is_unconditional(
                    &block.body,
                    action_span,
                    cleanup_id,
                    ctx,
                ) {
                    return false;
                }
            }
            Statement::TryStatement(statement) => {
                if ctx.nodes().iter().any(|node| {
                    statement.span.contains_inclusive(node.span())
                        && set_state_after_await_nearest_function_id(node.id(), ctx)
                            == Some(cleanup_id)
                        && matches!(
                            node.kind(),
                            AstKind::ReturnStatement(_) | AstKind::ThrowStatement(_)
                        )
                }) {
                    return false;
                }
            }
            _ => return false,
        }
    }
    true
}

fn set_state_after_await_assignment_key(
    target: &AssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match target {
        AssignmentTarget::AssignmentTargetIdentifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .map(|symbol_id| format!("symbol:{}", symbol_id.index())),
        AssignmentTarget::StaticMemberExpression(member) => {
            let object = resolve_expression_key(&member.object, ctx, &mut Vec::new())?;
            Some(format!("{object}.{}", member.property.name))
        }
        AssignmentTarget::ComputedMemberExpression(member) => {
            let object = resolve_expression_key(&member.object, ctx, &mut Vec::new())?;
            let property = match member.expression.get_inner_expression() {
                Expression::StringLiteral(literal) => literal.value.to_string(),
                _ => return None,
            };
            Some(format!("{object}.{property}"))
        }
        _ => None,
    }
}

fn set_state_after_await_reference_is_written_after(
    reference_key: &str,
    function_id: NodeId,
    minimum_start: u32,
    index: &SetStateAfterAwaitIndex,
    ctx: &LintContext<'_>,
) -> bool {
    set_state_after_await_reference_is_written_in_function(
        reference_key,
        function_id,
        Some(minimum_start),
        index,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn set_state_after_await_reference_is_written_in_function(
    reference_key: &str,
    function_id: NodeId,
    minimum_start: Option<u32>,
    index: &SetStateAfterAwaitIndex,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<NodeId>,
) -> bool {
    if !visited.insert(function_id) {
        return false;
    }
    for node in set_state_after_await_own_nodes(function_id, index, ctx) {
        if minimum_start.is_some_and(|start| node.span().start <= start) {
            continue;
        }
        if let AstKind::IdentifierReference(identifier) = node.kind() {
            let reference = ctx.scoping().get_reference(identifier.reference_id());
            if reference.is_write()
                && reference.symbol_id().is_some_and(|symbol_id| {
                    format!("symbol:{}", symbol_id.index()) == reference_key
                })
            {
                return true;
            }
        }
        let written_key = match node.kind() {
            AstKind::AssignmentExpression(assignment) => {
                set_state_after_await_assignment_key(&assignment.left, ctx)
            }
            AstKind::UpdateExpression(update) => {
                set_state_after_await_simple_target_key(&update.argument, ctx)
            }
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                resolve_expression_key(&unary.argument, ctx, &mut Vec::new())
            }
            _ => None,
        };
        if written_key.as_deref().is_some_and(|written_key| {
            written_key == reference_key || reference_key.starts_with(&format!("{written_key}."))
        }) {
            return true;
        }
        let AstKind::CallExpression(call) = node.kind() else {
            continue;
        };
        if set_state_after_await_call_mutates_reference(call, reference_key, ctx) {
            return true;
        }
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        if let Some(invoked_id) = set_state_after_await_resolve_invoked_function(
            &call.callee,
            node,
            ctx,
            &mut resolution_cache,
        ) && set_state_after_await_reference_is_written_in_function(
            reference_key,
            invoked_id,
            None,
            index,
            ctx,
            visited,
        ) {
            return true;
        }
    }
    false
}

fn set_state_after_await_call_mutates_reference(
    call: &oxc_ast::ast::CallExpression<'_>,
    reference_key: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(method_name) = member.static_property_name() else {
        return false;
    };
    let Expression::Identifier(namespace) = member.object().get_inner_expression() else {
        return false;
    };
    let is_object_mutation = namespace.name == "Object"
        && matches!(
            method_name,
            "assign" | "defineProperties" | "defineProperty"
        );
    let is_reflect_mutation = namespace.name == "Reflect"
        && matches!(method_name, "defineProperty" | "deleteProperty" | "set");
    if (!is_object_mutation && !is_reflect_mutation)
        || ctx
            .scoping()
            .get_reference(namespace.reference_id())
            .symbol_id()
            .is_some()
    {
        return false;
    }
    call.arguments
        .first()
        .and_then(Argument::as_expression)
        .and_then(|target| resolve_expression_key(target, ctx, &mut Vec::new()))
        .is_some_and(|target_key| {
            target_key == reference_key || reference_key.starts_with(&format!("{target_key}."))
        })
}

fn set_state_after_await_declared_controller_keys(
    callback_id: NodeId,
    index: &SetStateAfterAwaitIndex,
    ctx: &LintContext<'_>,
) -> FxHashSet<String> {
    set_state_after_await_own_nodes(callback_id, index, ctx)
        .filter_map(|node| {
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                return None;
            };
            let binding = declarator.id.get_binding_identifier()?;
            let Expression::NewExpression(construction) =
                declarator.init.as_ref()?.get_inner_expression()
            else {
                return None;
            };
            matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "AbortController"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
            .then(|| format!("symbol:{}", binding.symbol_id().index()))
        })
        .collect()
}

fn set_state_after_await_abort_protects_suspension(
    suspension: &AstNode<'_>,
    declared: &FxHashSet<String>,
    aborted: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::AwaitExpression(await_expression) = suspension.kind() else {
        return false;
    };
    ctx.nodes().iter().any(|node| {
        if !await_expression
            .argument
            .span()
            .contains_inclusive(node.span())
        {
            return false;
        }
        let Some(member) = (match node.kind() {
            AstKind::StaticMemberExpression(member) => Some(member),
            _ => None,
        }) else {
            return false;
        };
        if member.property.name != "signal" {
            return false;
        }
        resolve_expression_key(&member.object, ctx, &mut Vec::new())
            .is_some_and(|key| declared.contains(&key) && aborted.contains(&key))
    })
}

fn set_state_after_await_sequence_snapshots(
    callback_id: NodeId,
    function_id: NodeId,
    first_suspension_start: u32,
    index: &SetStateAfterAwaitIndex,
    ctx: &LintContext<'_>,
) -> Vec<SetStateAfterAwaitSnapshot> {
    [callback_id, function_id]
        .into_iter()
        .flat_map(|owner_id| set_state_after_await_own_nodes(owner_id, index, ctx))
        .filter_map(|node| {
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                return None;
            };
            if node.span().start >= first_suspension_start {
                return None;
            }
            let binding = declarator.id.get_binding_identifier()?;
            let Expression::UpdateExpression(update) =
                declarator.init.as_ref()?.get_inner_expression()
            else {
                return None;
            };
            if update.operator.as_str() != "++" {
                return None;
            }
            let counter_key = set_state_after_await_simple_target_key(&update.argument, ctx)?;
            Some(SetStateAfterAwaitSnapshot {
                binding_key: format!("symbol:{}", binding.symbol_id().index()),
                counter_key,
            })
        })
        .collect()
}

fn set_state_after_await_simple_target_key(
    target: &oxc_ast::ast::SimpleAssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match target {
        oxc_ast::ast::SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .map(|symbol_id| format!("symbol:{}", symbol_id.index())),
        oxc_ast::ast::SimpleAssignmentTarget::StaticMemberExpression(member) => {
            let object = resolve_expression_key(&member.object, ctx, &mut Vec::new())?;
            Some(format!("{object}.{}", member.property.name))
        }
        _ => None,
    }
}

fn set_state_after_await_setter_is_guarded<'a>(
    setter_id: NodeId,
    suspension: &AstNode<'a>,
    cleanup_writes: &FxHashMap<String, bool>,
    snapshots: &[SetStateAfterAwaitSnapshot],
    function_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let setter = ctx.nodes().get_node(setter_id);
    for ancestor in ctx.nodes().ancestors(setter_id).skip(1) {
        if ancestor.id() == function_id {
            break;
        }
        let guarded = match ancestor.kind() {
            AstKind::IfStatement(statement) => {
                if statement
                    .consequent
                    .span()
                    .contains_inclusive(setter.span())
                {
                    set_state_after_await_guard_forces_safe(
                        &statement.test,
                        true,
                        cleanup_writes,
                        snapshots,
                        ctx,
                    )
                } else if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(setter.span()))
                {
                    set_state_after_await_guard_forces_safe(
                        &statement.test,
                        false,
                        cleanup_writes,
                        snapshots,
                        ctx,
                    )
                } else {
                    false
                }
            }
            AstKind::ConditionalExpression(expression) => {
                let expected = expression
                    .consequent
                    .span()
                    .contains_inclusive(setter.span());
                set_state_after_await_guard_forces_safe(
                    &expression.test,
                    expected,
                    cleanup_writes,
                    snapshots,
                    ctx,
                )
            }
            AstKind::LogicalExpression(expression)
                if expression.right.span().contains_inclusive(setter.span()) =>
            {
                let expected = expression.operator == LogicalOperator::And;
                set_state_after_await_guard_forces_safe(
                    &expression.left,
                    expected,
                    cleanup_writes,
                    snapshots,
                    ctx,
                )
            }
            _ => false,
        };
        if guarded {
            return true;
        }
    }
    set_state_after_await_has_prior_exit_guard(
        setter_id,
        suspension.span().start,
        cleanup_writes,
        snapshots,
        function_id,
        ctx,
    ) || set_state_after_await_finalizer_predecessors_are_guarded(
        setter_id,
        suspension,
        cleanup_writes,
        snapshots,
        function_id,
        ctx,
    )
}

fn set_state_after_await_finalizer_predecessors_are_guarded<'a>(
    setter_id: NodeId,
    suspension: &AstNode<'a>,
    cleanup_writes: &FxHashMap<String, bool>,
    snapshots: &[SetStateAfterAwaitSnapshot],
    function_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let setter_span = ctx.nodes().get_node(setter_id).span();
    let Some(try_statement) = ctx.nodes().ancestors(setter_id).find_map(|ancestor| {
        let AstKind::TryStatement(statement) = ancestor.kind() else {
            return None;
        };
        statement
            .finalizer
            .as_ref()
            .is_some_and(|finalizer| finalizer.span.contains_inclusive(setter_span))
            .then_some(statement)
    }) else {
        return false;
    };
    if !try_statement
        .block
        .span
        .contains_inclusive(suspension.span())
    {
        return false;
    }
    let Some(handler) = &try_statement.handler else {
        return false;
    };
    let try_guard_ids = set_state_after_await_safe_exit_guards_in_span(
        try_statement.block.span,
        suspension.span().start,
        cleanup_writes,
        snapshots,
        function_id,
        ctx,
    );
    let try_guards = try_guard_ids
        .iter()
        .map(|node_id| ctx.nodes().get_node(*node_id))
        .collect::<Vec<_>>();
    if try_guards.is_empty()
        || (!do_nodes_cover_every_path_after_node(
            suspension,
            &try_guards,
            ctx.nodes().get_node(function_id),
            ctx,
        ) && !set_state_after_await_later_statement_contains_guard(
            suspension,
            &try_guards,
            &try_statement.block.body,
        ))
    {
        return false;
    }
    let catch_guard_ids = set_state_after_await_safe_exit_guards_in_span(
        handler.body.span,
        handler.body.span.start,
        cleanup_writes,
        snapshots,
        function_id,
        ctx,
    );
    let catch_guards = catch_guard_ids
        .iter()
        .map(|node_id| ctx.nodes().get_node(*node_id))
        .collect::<Vec<_>>();
    let Some(catch_node) = ctx.nodes().iter().find(|node| {
        node.span() == handler.span() && matches!(node.kind(), AstKind::CatchClause(_))
    }) else {
        return false;
    };
    !catch_guards.is_empty()
        && do_nodes_cover_every_path_after_node(
            catch_node,
            &catch_guards,
            ctx.nodes().get_node(function_id),
            ctx,
        )
}

fn set_state_after_await_later_statement_contains_guard(
    suspension: &AstNode<'_>,
    guards: &[&AstNode<'_>],
    statements: &[Statement<'_>],
) -> bool {
    let Some(suspension_statement_index) = statements
        .iter()
        .position(|statement| statement.span().contains_inclusive(suspension.span()))
    else {
        return false;
    };
    guards.iter().any(|guard| {
        statements
            .iter()
            .skip(suspension_statement_index + 1)
            .any(|statement| statement.span() == guard.span())
    })
}

fn set_state_after_await_safe_exit_guards_in_span(
    span: oxc_span::Span,
    minimum_start: u32,
    cleanup_writes: &FxHashMap<String, bool>,
    snapshots: &[SetStateAfterAwaitSnapshot],
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Vec<NodeId> {
    ctx.nodes()
        .iter()
        .filter(|node| {
            node.span().start >= minimum_start
                && span.contains_inclusive(node.span())
                && set_state_after_await_nearest_function_id(node.id(), ctx) == Some(function_id)
        })
        .filter(|node| {
            let AstKind::IfStatement(guard) = node.kind() else {
                return false;
            };
            (statement_always_exits(&guard.consequent)
                && set_state_after_await_guard_forces_safe(
                    &guard.test,
                    false,
                    cleanup_writes,
                    snapshots,
                    ctx,
                ))
                || guard.alternate.as_ref().is_some_and(|alternate| {
                    statement_always_exits(alternate)
                        && set_state_after_await_guard_forces_safe(
                            &guard.test,
                            true,
                            cleanup_writes,
                            snapshots,
                            ctx,
                        )
                })
        })
        .map(AstNode::id)
        .collect()
}

fn set_state_after_await_has_prior_exit_guard(
    setter_id: NodeId,
    suspension_start: u32,
    cleanup_writes: &FxHashMap<String, bool>,
    snapshots: &[SetStateAfterAwaitSnapshot],
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let setter_span = ctx.nodes().get_node(setter_id).span();
    ctx.nodes().ancestors(setter_id).skip(1).any(|ancestor| {
        if ancestor.id() == function_id {
            return false;
        }
        let statements: &[Statement<'_>] = match ancestor.kind() {
            AstKind::FunctionBody(body) => &body.statements,
            AstKind::BlockStatement(block) => &block.body,
            _ => return false,
        };
        statements.iter().any(|statement| {
            if statement.span().start <= suspension_start
                || statement.span().start >= setter_span.start
            {
                return false;
            }
            let Statement::IfStatement(guard) = statement else {
                return false;
            };
            (statement_always_exits(&guard.consequent)
                && set_state_after_await_guard_forces_safe(
                    &guard.test,
                    false,
                    cleanup_writes,
                    snapshots,
                    ctx,
                ))
                || guard.alternate.as_ref().is_some_and(|alternate| {
                    statement_always_exits(alternate)
                        && set_state_after_await_guard_forces_safe(
                            &guard.test,
                            true,
                            cleanup_writes,
                            snapshots,
                            ctx,
                        )
                })
        })
    })
}

fn set_state_after_await_guard_forces_safe<'a>(
    expression: &Expression<'a>,
    branch_value: bool,
    cleanup_writes: &FxHashMap<String, bool>,
    snapshots: &[SetStateAfterAwaitSnapshot],
    ctx: &LintContext<'a>,
) -> bool {
    set_state_after_await_guard_forces_safe_inner(
        expression,
        branch_value,
        cleanup_writes,
        snapshots,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn set_state_after_await_guard_forces_safe_inner<'a>(
    expression: &Expression<'a>,
    branch_value: bool,
    cleanup_writes: &FxHashMap<String, bool>,
    snapshots: &[SetStateAfterAwaitSnapshot],
    ctx: &LintContext<'a>,
    visited_predicates: &mut FxHashSet<NodeId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            set_state_after_await_guard_forces_safe_inner(
                &unary.argument,
                !branch_value,
                cleanup_writes,
                snapshots,
                ctx,
                visited_predicates,
            )
        }
        Expression::LogicalExpression(logical) => {
            if !set_state_after_await_is_side_effect_free_guard(
                expression,
                ctx,
                &mut FxHashSet::default(),
            ) {
                return false;
            }
            let left = set_state_after_await_guard_forces_safe_inner(
                &logical.left,
                branch_value,
                cleanup_writes,
                snapshots,
                ctx,
                visited_predicates,
            );
            let right = set_state_after_await_guard_forces_safe_inner(
                &logical.right,
                branch_value,
                cleanup_writes,
                snapshots,
                ctx,
                visited_predicates,
            );
            match logical.operator {
                LogicalOperator::And => {
                    if branch_value {
                        left || right
                    } else {
                        left && right
                    }
                }
                LogicalOperator::Or => {
                    if branch_value {
                        left && right
                    } else {
                        left || right
                    }
                }
                _ => false,
            }
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Equality
                    | BinaryOperator::StrictEquality
                    | BinaryOperator::Inequality
                    | BinaryOperator::StrictInequality
            ) =>
        {
            if set_state_after_await_sequence_comparison(binary, branch_value, snapshots, ctx) {
                return true;
            }
            let equality = matches!(
                binary.operator,
                BinaryOperator::Equality | BinaryOperator::StrictEquality
            );
            let (candidate, literal) = match (
                binary.left.get_inner_expression(),
                binary.right.get_inner_expression(),
            ) {
                (candidate, Expression::BooleanLiteral(literal)) => (candidate, literal.value),
                (Expression::BooleanLiteral(literal), candidate) => (candidate, literal.value),
                _ => return false,
            };
            let expected = if equality { literal } else { !literal };
            set_state_after_await_atomic_cleanup_guard(
                candidate,
                branch_value == expected,
                cleanup_writes,
                ctx,
            )
        }
        Expression::CallExpression(call) if call.arguments.is_empty() => {
            let mut resolution_cache = LocalFunctionResolutionCache::default();
            let Some(predicate_id) =
                exact_local_function_id(&call.callee, ctx, &mut Vec::new(), &mut resolution_cache)
            else {
                return false;
            };
            if !visited_predicates.insert(predicate_id) {
                return false;
            }
            let result = set_state_after_await_predicate_return_expression(predicate_id, ctx)
                .is_some_and(|returned| {
                    set_state_after_await_guard_forces_safe_inner(
                        returned,
                        branch_value,
                        cleanup_writes,
                        snapshots,
                        ctx,
                        visited_predicates,
                    )
                });
            visited_predicates.remove(&predicate_id);
            result
        }
        candidate => {
            set_state_after_await_atomic_cleanup_guard(candidate, branch_value, cleanup_writes, ctx)
        }
    }
}

fn set_state_after_await_is_side_effect_free_guard<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_predicates: &mut FxHashSet<NodeId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::StringLiteral(_) => true,
        expression if expression.as_member_expression().is_some() => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            member.static_property_name() == Some("current")
                && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                    if set_state_after_await_is_hook_result(identifier, &SET_STATE_AFTER_AWAIT_REF_HOOKS, None, ctx))
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            set_state_after_await_is_side_effect_free_guard(
                &unary.argument,
                ctx,
                visited_predicates,
            )
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Equality
                    | BinaryOperator::StrictEquality
                    | BinaryOperator::Inequality
                    | BinaryOperator::StrictInequality
            ) =>
        {
            set_state_after_await_is_side_effect_free_guard(&binary.left, ctx, visited_predicates)
                && set_state_after_await_is_side_effect_free_guard(
                    &binary.right,
                    ctx,
                    visited_predicates,
                )
        }
        Expression::LogicalExpression(logical) => {
            set_state_after_await_is_side_effect_free_guard(&logical.left, ctx, visited_predicates)
                && set_state_after_await_is_side_effect_free_guard(
                    &logical.right,
                    ctx,
                    visited_predicates,
                )
        }
        Expression::CallExpression(call) if call.arguments.is_empty() => {
            let mut resolution_cache = LocalFunctionResolutionCache::default();
            let Some(predicate_id) =
                exact_local_function_id(&call.callee, ctx, &mut Vec::new(), &mut resolution_cache)
            else {
                return false;
            };
            if !visited_predicates.insert(predicate_id) {
                return false;
            }
            let result = set_state_after_await_predicate_return_expression(predicate_id, ctx)
                .is_some_and(|returned| {
                    set_state_after_await_is_side_effect_free_guard(
                        returned,
                        ctx,
                        visited_predicates,
                    )
                });
            visited_predicates.remove(&predicate_id);
            result
        }
        _ => false,
    }
}

fn set_state_after_await_predicate_return_expression<'node, 'ast>(
    function_id: NodeId,
    ctx: &'node LintContext<'ast>,
) -> Option<&'node Expression<'ast>> {
    let function = ctx.nodes().get_node(function_id);
    match function.kind() {
        AstKind::ArrowFunctionExpression(arrow)
            if !arrow.r#async && arrow.params.items.is_empty() =>
        {
            if let Some(expression) = arrow.get_expression() {
                return Some(expression);
            }
            let body = arrow.body.as_function_body()?;
            if body.statements.len() != 1 {
                return None;
            }
            let Statement::ReturnStatement(return_statement) = &body.statements[0] else {
                return None;
            };
            return_statement.argument.as_ref()
        }
        AstKind::Function(function)
            if !function.r#async
                && !function.generator
                && function.params.items.is_empty()
                && function
                    .body
                    .as_ref()
                    .is_some_and(|body| body.statements.len() == 1) =>
        {
            let Statement::ReturnStatement(return_statement) =
                &function.body.as_ref()?.statements[0]
            else {
                return None;
            };
            return_statement.argument.as_ref()
        }
        _ => None,
    }
}

fn set_state_after_await_atomic_cleanup_guard(
    expression: &Expression<'_>,
    branch_value: bool,
    cleanup_writes: &FxHashMap<String, bool>,
    ctx: &LintContext<'_>,
) -> bool {
    resolve_expression_key(expression, ctx, &mut Vec::new())
        .and_then(|key| cleanup_writes.get(&key).copied())
        .is_some_and(|cleanup_value| cleanup_value != branch_value)
}

fn set_state_after_await_sequence_comparison(
    binary: &oxc_ast::ast::BinaryExpression<'_>,
    branch_value: bool,
    snapshots: &[SetStateAfterAwaitSnapshot],
    ctx: &LintContext<'_>,
) -> bool {
    let mismatch_when_true = matches!(
        binary.operator,
        BinaryOperator::Inequality | BinaryOperator::StrictInequality
    );
    let stale_run_forces_opposite_branch = branch_value != mismatch_when_true;
    if !stale_run_forces_opposite_branch {
        return false;
    }
    let left = resolve_expression_key(&binary.left, ctx, &mut Vec::new());
    let right = resolve_expression_key(&binary.right, ctx, &mut Vec::new());
    snapshots.iter().any(|snapshot| {
        left.as_deref() == Some(snapshot.binding_key.as_str())
            && right.as_deref() == Some(snapshot.counter_key.as_str())
            || right.as_deref() == Some(snapshot.binding_key.as_str())
                && left.as_deref() == Some(snapshot.counter_key.as_str())
    })
}

fn set_state_after_await_build_index(ctx: &LintContext<'_>) -> SetStateAfterAwaitIndex {
    let mut index = SetStateAfterAwaitIndex::default();
    for node in ctx.nodes().iter() {
        if let Some(function_id) = set_state_after_await_nearest_function_id(node.id(), ctx) {
            index
                .own_node_ids
                .entry(function_id)
                .or_default()
                .push(node.id());
        }
    }
    index
}

fn set_state_after_await_own_nodes<'node, 'ast>(
    function_id: NodeId,
    index: &'node SetStateAfterAwaitIndex,
    ctx: &'node LintContext<'ast>,
) -> impl Iterator<Item = &'node AstNode<'ast>> + 'node {
    index
        .own_node_ids
        .get(&function_id)
        .into_iter()
        .flatten()
        .map(|node_id| ctx.nodes().get_node(*node_id))
}

fn set_state_after_await_nearest_function_id(
    node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).skip(1).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn set_state_after_await_node_for_expression<'node, 'ast>(
    expression: &Expression<'ast>,
    ctx: &'node LintContext<'ast>,
) -> Option<&'node AstNode<'ast>> {
    ctx.nodes()
        .iter()
        .find(|node| node.span() == expression.span())
}
