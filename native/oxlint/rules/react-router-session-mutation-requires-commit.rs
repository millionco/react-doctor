use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This action has a path that returns after changing a session without serializing it to a Set-Cookie header.";
const SESSION_MUTATOR_NAMES: [&str; 3] = ["flash", "set", "unset"];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterSessionMutationRequiresCommit;

declare_oxc_lint!(
    /// Requires React Router action session mutations to reach a returned Set-Cookie header.
    ReactRouterSessionMutationRequiresCommit,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require action session mutations to be committed.",
);

impl Rule for ReactRouterSessionMutationRequiresCommit {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
            && is_react_router_file_active(ctx)
            && is_react_router_framework_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            return;
        };
        let BindingPattern::BindingIdentifier(session_binding) = &declarator.id else {
            return;
        };
        let Some(initializer) = &declarator.init else {
            return;
        };
        let get_session_expression = match initializer {
            Expression::AwaitExpression(await_expression) => &await_expression.argument,
            expression => expression,
        };
        let Expression::CallExpression(get_session_call) = get_session_expression else {
            return;
        };
        let Expression::Identifier(get_session_callee) = &get_session_call.callee else {
            return;
        };
        if !is_react_router_session_method(get_session_callee, "getSession", ctx) {
            return;
        }
        let Some(route_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        if !is_react_router_route_function(route_function, "action", ctx) {
            return;
        }

        let session_symbol_id = session_binding.symbol_id();
        let mut mutation_nodes = session_mutation_nodes(session_symbol_id, route_function, ctx);
        if mutation_nodes.is_empty() {
            return;
        }
        mutation_nodes.sort_unstable_by_key(|mutation_node| mutation_node.span().start);
        let serialized_cookie_sinks =
            serialized_cookie_sink_nodes(session_symbol_id, route_function, ctx);
        let Some(uncommitted_mutation) = mutation_nodes.into_iter().find(|mutation_node| {
            !do_nodes_cover_every_path_after_node(
                mutation_node,
                &serialized_cookie_sinks,
                route_function,
                ctx,
            )
        }) else {
            return;
        };
        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(uncommitted_mutation.span()));
    }
}

fn session_mutation_nodes<'a, 'ctx>(
    session_symbol_id: SymbolId,
    route_function: &AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Vec<&'ctx AstNode<'a>> {
    let mut mutation_nodes = Vec::new();
    for reference in ctx.scoping().get_resolved_references(session_symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        if crate::ast_util::get_enclosing_function(reference_node, ctx)
            .is_none_or(|owner| owner.id() != route_function.id())
        {
            continue;
        }
        let parent = ctx.nodes().parent_node(reference_node.id());
        if let AstKind::CallExpression(call_expression) = parent.kind()
            && is_react_router_session_method_call(
                call_expression,
                session_symbol_id,
                "destroySession",
                ctx,
            )
            && is_node_reachable_within_function(parent, route_function, ctx)
        {
            mutation_nodes.push(parent);
            continue;
        }
        let (object_span, is_mutator) = match parent.kind() {
            AstKind::StaticMemberExpression(member_expression) => (
                member_expression.object.span(),
                SESSION_MUTATOR_NAMES.contains(&member_expression.property.name.as_str()),
            ),
            AstKind::ComputedMemberExpression(member_expression) => (
                member_expression.object.span(),
                member_expression
                    .static_property_name()
                    .is_some_and(|name| SESSION_MUTATOR_NAMES.contains(&name.as_str())),
            ),
            _ => continue,
        };
        if object_span != reference_node.span() || !is_mutator {
            continue;
        }
        let call_node = ctx.nodes().parent_node(parent.id());
        let AstKind::CallExpression(call_expression) = call_node.kind() else {
            continue;
        };
        if call_expression.callee.span() == parent.span()
            && is_node_reachable_within_function(call_node, route_function, ctx)
        {
            mutation_nodes.push(parent);
        }
    }
    mutation_nodes
}

fn serialized_cookie_sink_nodes<'a, 'ctx>(
    session_symbol_id: SymbolId,
    route_function: &AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Vec<&'ctx AstNode<'a>> {
    let mut serialized_cookie_sinks = Vec::new();
    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        if crate::ast_util::get_enclosing_function(candidate, ctx)
            .is_none_or(|owner| owner.id() != route_function.id())
            || (!is_react_router_session_method_call(
                call_expression,
                session_symbol_id,
                "commitSession",
                ctx,
            ) && !is_react_router_session_method_call(
                call_expression,
                session_symbol_id,
                "destroySession",
                ctx,
            ))
        {
            continue;
        }
        serialized_cookie_sinks.extend(find_serialized_cookie_sinks(
            candidate,
            route_function,
            ctx,
        ));
    }
    serialized_cookie_sinks
}

fn find_serialized_cookie_sinks<'a, 'ctx>(
    commit_call: &'ctx AstNode<'a>,
    route_function: &AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Vec<&'ctx AstNode<'a>> {
    if is_returned_set_cookie_value(commit_call, route_function, ctx) {
        return vec![commit_call];
    }
    let parent = ctx.nodes().parent_node(commit_call.id());
    let awaited_value = if matches!(parent.kind(), AstKind::AwaitExpression(_)) {
        parent
    } else {
        commit_call
    };
    let declarator_node = ctx.nodes().parent_node(awaited_value.id());
    let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
        return Vec::new();
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != awaited_value.span())
    {
        return Vec::new();
    }
    let Some(cookie_binding) = declarator.id.get_binding_identifier() else {
        return Vec::new();
    };
    let declaration = ctx.nodes().parent_node(declarator_node.id());
    if !matches!(
        declaration.kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) {
        return Vec::new();
    }
    ctx.scoping()
        .get_resolved_references(cookie_binding.symbol_id())
        .filter_map(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            (crate::ast_util::get_enclosing_function(reference_node, ctx)
                .is_some_and(|owner| owner.id() == route_function.id())
                && is_returned_set_cookie_value(reference_node, route_function, ctx))
            .then_some(reference_node)
        })
        .collect()
}

fn is_returned_set_cookie_value(
    node: &AstNode<'_>,
    route_function: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut ancestor = ctx.nodes().parent_node(node.id());
    let set_cookie_property = loop {
        if ancestor.id() == route_function.id() {
            return false;
        }
        if let AstKind::ObjectProperty(property) = ancestor.kind()
            && property
                .key
                .static_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("set-cookie"))
            && property.value.span().contains_inclusive(node.span())
        {
            break ancestor;
        }
        ancestor = ctx.nodes().parent_node(ancestor.id());
    };

    ancestor = ctx.nodes().parent_node(set_cookie_property.id());
    while ancestor.id() != route_function.id() {
        if matches!(ancestor.kind(), AstKind::ReturnStatement(_)) {
            return true;
        }
        ancestor = ctx.nodes().parent_node(ancestor.id());
    }
    matches!(
        route_function.kind(),
        AstKind::ArrowFunctionExpression(arrow_function)
            if arrow_function.is_expression()
                && arrow_function.body.span().contains_inclusive(set_cookie_property.span())
    )
}
