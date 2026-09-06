use oxc_ast::{
    AstKind,
    ast::{Argument, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const SYNCHRONOUS_CALLBACK_METHOD_NAMES: [&str; 11] = [
    "every",
    "filter",
    "find",
    "findIndex",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
    "sort",
];
#[derive(Debug, Default, Clone)]
pub struct EffectListenerCleanupReferenceMismatch;

declare_oxc_lint!(
    /// Require effect cleanup to reuse the listener reference passed during registration.
    EffectListenerCleanupReferenceMismatch,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require effect cleanup to reuse registered listener references.",
);

impl Rule for EffectListenerCleanupReferenceMismatch {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut function_resolution_cache = LocalFunctionResolutionCache::default();
        for effect_node in ctx.nodes().iter() {
            let AstKind::CallExpression(effect_call) = effect_node.kind() else {
                continue;
            };
            if !is_proven_listener_effect_hook_call(effect_call, ctx) {
                continue;
            }
            let Some(callback_expression) = effect_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) = exact_local_function_id_including_generators(
                callback_expression,
                ctx,
                &mut Vec::new(),
                &mut function_resolution_cache,
            ) else {
                continue;
            };
            let registration_keys =
                collect_listener_registration_keys(callback_id, &node_index, ctx);
            if registration_keys.is_empty() {
                continue;
            }
            for cleanup_id in collect_listener_cleanup_function_ids(callback_id, &node_index, ctx) {
                for_each_listener_execution_node(cleanup_id, &node_index, ctx, |candidate| {
                    let AstKind::CallExpression(call) = candidate.kind() else {
                        return;
                    };
                    let Some(member) = call.callee.get_inner_expression().as_member_expression()
                    else {
                        return;
                    };
                    let Some(release_method) = static_member_expression_property_name(member)
                    else {
                        return;
                    };
                    let Some(register_method) = listener_registration_method(release_method) else {
                        return;
                    };
                    let Some(handler) = call.arguments.first().and_then(Argument::as_expression)
                    else {
                        return;
                    };
                    if !listener_handler_is_inline_function(handler) {
                        return;
                    }
                    let Some(receiver_key) = serialize_listener_reference(member.object(), ctx)
                    else {
                        return;
                    };
                    if !registration_keys.contains(&(register_method, receiver_key)) {
                        return;
                    }
                    let message = format!(
                        "Your cleanup calls `{release_method}` with a brand-new inline function that never equals the handler you added, so the cleanup exists but detaches nothing and the listener leaks; pass one shared named handler to both calls."
                    );
                    ctx.diagnostic(OxcDiagnostic::error(message).with_label(handler.span()));
                });
            }
        }
    }
}

fn is_proven_listener_effect_hook_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if EFFECT_HOOK_NAMES
        .iter()
        .any(|hook_name| is_react_api_call(call, hook_name, ctx))
    {
        return true;
    }
    matches!(
        call.callee.get_inner_expression(),
        Expression::Identifier(identifier)
            if EFFECT_HOOK_NAMES.contains(&identifier.name.as_str())
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
    )
}

fn listener_registration_method(release_method: &str) -> Option<&'static str> {
    match release_method {
        "unsubscribe" => Some("subscribe"),
        "unsub" => Some("sub"),
        "unwatch" => Some("watch"),
        "unlisten" => Some("listen"),
        _ => None,
    }
}

fn collect_listener_registration_keys(
    callback_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> FxHashSet<(&'static str, String)> {
    let mut registration_keys = FxHashSet::default();
    for_each_listener_execution_node(callback_id, node_index, ctx, |candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            return;
        };
        let Some(register_method) = static_member_expression_property_name(member) else {
            return;
        };
        let Some(register_method) = listener_canonical_registration_method(register_method) else {
            return;
        };
        let Some(handler) = call.arguments.first().and_then(Argument::as_expression) else {
            return;
        };
        if !listener_handler_is_inline_function(handler) {
            return;
        }
        let Some(receiver_key) = serialize_listener_reference(member.object(), ctx) else {
            return;
        };
        registration_keys.insert((register_method, receiver_key));
    });
    registration_keys
}

fn listener_canonical_registration_method(register_method: &str) -> Option<&'static str> {
    match register_method {
        "subscribe" => Some("subscribe"),
        "sub" => Some("sub"),
        "watch" => Some("watch"),
        "listen" => Some("listen"),
        _ => None,
    }
}

fn listener_handler_is_inline_function(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    )
}

fn serialize_listener_reference(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            Some(symbol_id.map_or_else(
                || identifier.name.to_string(),
                |symbol_id| format!("{}#{}", identifier.name, symbol_id.index()),
            ))
        }
        Expression::ThisExpression(_) => Some("this".to_string()),
        expression => {
            let member = expression.as_member_expression()?;
            let receiver = serialize_listener_reference(member.object(), ctx)?;
            let property_name = static_member_expression_property_name(member)?;
            Some(format!("{receiver}.{property_name}"))
        }
    }
}

fn collect_listener_cleanup_function_ids(
    callback_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> Vec<NodeId> {
    let mut cleanup_ids = Vec::new();
    let callback_node = ctx.nodes().get_node(callback_id);
    if let AstKind::ArrowFunctionExpression(function) = callback_node.kind()
        && let Some(expression) = function.get_expression()
    {
        resolve_listener_cleanup_expression(expression, ctx, &mut cleanup_ids);
    }
    for &candidate_id in node_index.node_ids(callback_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        let AstKind::ReturnStatement(statement) = candidate.kind() else {
            continue;
        };
        if let Some(argument) = &statement.argument {
            resolve_listener_cleanup_expression(argument, ctx, &mut cleanup_ids);
        }
    }
    cleanup_ids
}

fn resolve_listener_cleanup_expression(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    cleanup_ids: &mut Vec<NodeId>,
) {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => cleanup_ids.push(function.node_id.get()),
        Expression::FunctionExpression(function) => cleanup_ids.push(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return;
            };
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) if function.is_function_declaration() => {
                    cleanup_ids.push(function.node_id.get());
                }
                AstKind::VariableDeclarator(declarator)
                    if declarator
                        .id
                        .get_binding_identifier()
                        .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
                {
                    let Some(initializer) = &declarator.init else {
                        return;
                    };
                    match initializer.get_inner_expression() {
                        Expression::ArrowFunctionExpression(function) => {
                            cleanup_ids.push(function.node_id.get());
                        }
                        Expression::FunctionExpression(function) => {
                            cleanup_ids.push(function.node_id.get());
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        Expression::ConditionalExpression(conditional) => {
            resolve_listener_cleanup_expression(&conditional.consequent, ctx, cleanup_ids);
            resolve_listener_cleanup_expression(&conditional.alternate, ctx, cleanup_ids);
        }
        Expression::SequenceExpression(sequence) => {
            if let Some(last_expression) = sequence.expressions.last() {
                resolve_listener_cleanup_expression(last_expression, ctx, cleanup_ids);
            }
        }
        _ => {}
    }
}

fn for_each_listener_execution_node<'a>(
    root_function_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    mut visitor: impl FnMut(&AstNode<'a>),
) {
    let root_span = ctx.nodes().get_node(root_function_id).span();
    walk_listener_execution_function(
        root_function_id,
        root_span,
        node_index,
        ctx,
        &mut FxHashSet::default(),
        &mut visitor,
    );
}

fn walk_listener_execution_function<'a>(
    function_id: NodeId,
    root_span: Span,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    active_function_ids: &mut FxHashSet<NodeId>,
    visitor: &mut impl FnMut(&AstNode<'a>),
) {
    if !active_function_ids.insert(function_id) {
        return;
    }
    for &candidate_id in node_index.node_ids(function_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        visitor(candidate);
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        if let Some(called_function_id) =
            listener_local_helper_function_id(&call.callee, ctx, &mut FxHashSet::default())
            && listener_function_is_nested_in_root(called_function_id, root_span, ctx)
        {
            walk_listener_execution_function(
                called_function_id,
                root_span,
                node_index,
                ctx,
                active_function_ids,
                visitor,
            );
        }
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            continue;
        };
        if static_member_expression_property_name(member)
            .is_none_or(|method| !SYNCHRONOUS_CALLBACK_METHOD_NAMES.contains(&method))
        {
            continue;
        }
        for argument in &call.arguments {
            let Some(callback_expression) = argument.as_expression() else {
                continue;
            };
            if let Some(callback_function_id) = listener_local_helper_function_id(
                callback_expression,
                ctx,
                &mut FxHashSet::default(),
            ) && listener_function_is_nested_in_root(callback_function_id, root_span, ctx)
            {
                walk_listener_execution_function(
                    callback_function_id,
                    root_span,
                    node_index,
                    ctx,
                    active_function_ids,
                    visitor,
                );
            }
        }
    }
    active_function_ids.remove(&function_id);
}

fn listener_function_is_nested_in_root(
    function_id: NodeId,
    root_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    root_span.contains_inclusive(ctx.nodes().get_node(function_id).span())
}

fn listener_local_helper_function_id(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) if function.is_function_declaration() => {
                    Some(function.node_id.get())
                }
                AstKind::VariableDeclarator(declarator)
                    if matches!(
                        ctx.nodes().parent_node(declaration.id()).kind(),
                        AstKind::VariableDeclaration(variable_declaration)
                            if variable_declaration.kind.is_const()
                    ) && declarator
                        .id
                        .get_binding_identifier()
                        .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
                {
                    listener_local_helper_function_id(
                        declarator.init.as_ref()?,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                _ => None,
            }
        }
        _ => None,
    }
}
