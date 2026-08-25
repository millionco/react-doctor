use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression},
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
const REACT_ROUTER_RUNTIME_PACKAGE_NAMES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];
const SESSION_STORAGE_FACTORY_NAMES: [&str; 5] = [
    "createCookieSessionStorage",
    "createFileSessionStorage",
    "createMemorySessionStorage",
    "createSessionStorage",
    "createWorkersKVSessionStorage",
];
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
        !is_non_production_file(ctx)
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
        if !is_react_router_action_function(route_function, ctx) {
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

fn is_react_router_session_method(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    expected_method_name: &str,
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
    let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    if !pattern.properties.iter().any(|property| {
        property.key.static_name().as_deref() == Some(expected_method_name)
            && binding_pattern_has_symbol(&property.value, symbol_id)
    }) {
        return false;
    }
    let Some(Expression::CallExpression(factory_call)) = &declarator.init else {
        return false;
    };
    let Expression::Identifier(factory_callee) = factory_call.callee.get_inner_expression() else {
        return false;
    };
    direct_named_import_matches(
        factory_callee,
        &SESSION_STORAGE_FACTORY_NAMES,
        &REACT_ROUTER_RUNTIME_PACKAGE_NAMES,
        ctx,
    )
}

fn is_react_router_session_method_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    session_symbol_id: SymbolId,
    expected_method_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(callee) = &call_expression.callee else {
        return false;
    };
    let Some(Expression::Identifier(session_argument)) = call_expression
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    ctx.scoping()
        .get_reference(session_argument.reference_id())
        .symbol_id()
        == Some(session_symbol_id)
        && is_react_router_session_method(callee, expected_method_name, ctx)
}

fn is_react_router_action_function(
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(function_node.id());
    if let AstKind::ObjectProperty(property) = parent.kind()
        && property.key.static_name().as_deref() == Some("action")
        && property.value.span() == function_node.span()
    {
        let route_object_node = ctx.nodes().parent_node(parent.id());
        return matches!(
            route_object_node.kind(),
            AstKind::ObjectExpression(route_object)
                if is_static_react_router_route_object(route_object, ctx)
        );
    }

    if let AstKind::Function(function) = function_node.kind()
        && function
            .id
            .as_ref()
            .is_some_and(|identifier| identifier.name == "action")
    {
        return matches!(parent.kind(), AstKind::ExportNamedDeclaration(_))
            && is_react_router_framework_module_filename(ctx);
    }
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return false;
    };
    if declarator.init.as_ref().is_none_or(|initializer| {
        initializer.span() != function_node.span()
    }) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.name != "action")
    {
        return false;
    }
    let declaration = ctx.nodes().parent_node(parent.id());
    if !matches!(declaration.kind(), AstKind::VariableDeclaration(_)) {
        return false;
    }
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::ExportNamedDeclaration(_)
    ) && is_react_router_framework_module_filename(ctx)
}

fn is_react_router_framework_module_filename(ctx: &LintContext<'_>) -> bool {
    let is_absolute_filename = ctx.file_path().is_absolute();
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    let root_directory = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("rootDirectory"))
        .and_then(serde_json::Value::as_str)
        .filter(|root_directory| !root_directory.is_empty())
        .map(|root_directory| root_directory.replace('\\', "/"));
    let relative_filename = if is_absolute_filename
        && let Some(root_directory) = root_directory
    {
        let root_directory = root_directory.trim_end_matches('/');
        let Some(relative_filename) = filename
            .strip_prefix(root_directory)
            .and_then(|filename| filename.strip_prefix('/'))
        else {
            return false;
        };
        relative_filename
    } else {
        filename.as_str()
    };
    let is_route = relative_filename.starts_with("app/routes/")
        || relative_filename.contains("/app/routes/");
    let basename = relative_filename.rsplit('/').next().unwrap_or_default();
    let parent = relative_filename
        .strip_suffix(basename)
        .unwrap_or_default()
        .trim_end_matches('/');
    let is_app_module = parent == "app" || parent.ends_with("/app");
    is_route
        || (is_app_module
            && (["root.js", "root.jsx", "root.ts", "root.tsx"].contains(&basename)
                || [
                    "entry.client.js",
                    "entry.client.jsx",
                    "entry.client.ts",
                    "entry.client.tsx",
                    "entry.server.js",
                    "entry.server.jsx",
                    "entry.server.ts",
                    "entry.server.tsx",
                ]
                .contains(&basename)))
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
