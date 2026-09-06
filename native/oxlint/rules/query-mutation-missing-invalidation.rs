use oxc_ast::{
    AstKind,
    ast::{Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const TANSTACK_QUERY_MODULE_SOURCES: [&str; 1] = ["@tanstack/react-query"];
const QUERY_CACHE_UPDATE_METHODS: [&str; 8] = [
    "invalidateQueries",
    "setQueryData",
    "setQueriesData",
    "resetQueries",
    "refetchQueries",
    "removeQueries",
    "cancelQueries",
    "clear",
];
const QUERY_READ_HOOK_NAMES: [&str; 9] = [
    "useQuery",
    "useInfiniteQuery",
    "useSuspenseQuery",
    "useSuspenseInfiniteQuery",
    "useQueries",
    "queryOptions",
    "infiniteQueryOptions",
    "useQueryClient",
    "useUtils",
];
const QUERY_READ_METHOD_NAMES: [&str; 4] = [
    "getQueryData",
    "fetchQuery",
    "prefetchQuery",
    "ensureQueryData",
];
const MUTATION_LIFECYCLE_CALLBACK_NAMES: [&str; 4] =
    ["onSuccess", "onSettled", "onError", "onMutate"];
const READ_ONLY_MUTATION_WORDS: [&str; 11] = [
    "download",
    "export",
    "validate",
    "validation",
    "verify",
    "verification",
    "test",
    "preview",
    "oauth",
    "pairing",
    "magiclink",
];
const COMPLETION_CALLBACK_VERBS: [&str; 26] = [
    "save",
    "saved",
    "success",
    "complete",
    "completed",
    "done",
    "finish",
    "finished",
    "update",
    "updated",
    "create",
    "created",
    "delete",
    "deleted",
    "remove",
    "removed",
    "change",
    "changed",
    "submit",
    "submitted",
    "refresh",
    "refetch",
    "mutate",
    "mutated",
    "sync",
    "synced",
];
const MESSAGE: &str = "useMutation with no cache update here can leave your users looking at stale data after it runs.";

#[derive(Debug, Default, Clone)]
pub struct QueryMutationMissingInvalidation;

declare_oxc_lint!(
    /// Warns when a TanStack mutation does not synchronize query caches.
    QueryMutationMissingInvalidation,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Mutation without cache invalidation.",
);

impl Rule for QueryMutationMissingInvalidation {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let has_tanstack_query_import = ctx.nodes().iter().any(|node| {
            matches!(node.kind(), AstKind::ImportDeclaration(import)
                if query_mutation_is_tanstack_query_module(import.source.value.as_str()))
        });
        let has_query_read_usage = ctx.nodes().iter().any(|node| {
            let AstKind::CallExpression(call) = node.kind() else {
                return false;
            };
            query_mutation_call_name(&call.callee).is_some_and(|name| {
                QUERY_READ_HOOK_NAMES.contains(&name)
                    || QUERY_READ_METHOD_NAMES.contains(&name)
                    || query_mutation_is_trpc_utils_hook(name)
            })
        });
        if !has_tanstack_query_import && !has_query_read_usage {
            return;
        }

        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            if !matches!(&call.callee, Expression::Identifier(identifier) if identifier.name == "useMutation")
            {
                continue;
            }
            let Some(Expression::ObjectExpression(options)) = call
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            if !options.properties.iter().any(|property| {
                matches!(property, ObjectPropertyKind::ObjectProperty(property)
                    if property_key_identifier_name(&property.key) == Some("mutationFn"))
            }) {
                continue;
            }
            if query_mutation_is_read_only(node, options, ctx) {
                continue;
            }
            let mut visited_helper_nodes = FxHashSet::default();
            if query_mutation_has_cache_update_within(
                options.span,
                3,
                &mut visited_helper_nodes,
                ctx,
            ) {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
        }
    }
}

fn query_mutation_is_tanstack_query_module(source: &str) -> bool {
    TANSTACK_QUERY_MODULE_SOURCES.contains(&source)
        || source
            .strip_prefix("@tanstack/")
            .and_then(|rest| rest.split('/').next())
            .is_some_and(|package| package.contains("query"))
}

fn query_mutation_call_name<'a>(callee: &'a Expression<'a>) -> Option<&'a str> {
    if let Expression::Identifier(identifier) = callee {
        return Some(identifier.name.as_str());
    }
    callee.as_member_expression()?.static_property_name()
}

fn query_mutation_is_trpc_utils_hook(name: &str) -> bool {
    name.starts_with("use") && name.ends_with("Utils")
}

fn query_mutation_is_read_only<'a>(
    call_node: &AstNode<'a>,
    options: &oxc_ast::ast::ObjectExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let result_binding_name = {
        let parent = ctx.nodes().parent_node(call_node.id());
        if let AstKind::VariableDeclarator(declarator) = parent.kind() {
            declarator
                .id
                .get_binding_identifier()
                .map(|binding| binding.name.as_str())
        } else {
            None
        }
    };
    let enclosing_name = crate::ast_util::get_enclosing_function(call_node, ctx)
        .and_then(|function| component_or_hook_function_name(function, ctx));
    let mutation_function_name = query_mutation_function_callee_name(options);
    [result_binding_name, enclosing_name, mutation_function_name]
        .into_iter()
        .flatten()
        .any(query_mutation_name_is_read_only)
}

fn query_mutation_function_callee_name<'a>(
    options: &'a oxc_ast::ast::ObjectExpression<'a>,
) -> Option<&'a str> {
    let property = options.properties.iter().find_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        (property_key_identifier_name(&property.key) == Some("mutationFn")).then_some(property)
    })?;
    let value = &property.value;
    if let Expression::Identifier(identifier) = value {
        return Some(identifier.name.as_str());
    }
    let mut body = match value {
        Expression::ArrowFunctionExpression(function) => function.get_expression()?,
        Expression::FunctionExpression(_) => return None,
        _ => return None,
    };
    if let Expression::AwaitExpression(await_expression) = body {
        body = &await_expression.argument;
    }
    let Expression::CallExpression(call) = body else {
        return None;
    };
    query_mutation_call_name(&call.callee)
}

fn query_mutation_name_is_read_only(name: &str) -> bool {
    let words = query_mutation_identifier_words(name);
    for (index, word) in words.iter().enumerate() {
        if word == "sign" {
            if !matches!(
                words.get(index + 1).map(String::as_str),
                Some("in" | "up" | "out" | "off")
            ) {
                return true;
            }
            continue;
        }
        if READ_ONLY_MUTATION_WORDS.contains(&word.as_str())
            || words.get(index + 1).is_some_and(|next| {
                READ_ONLY_MUTATION_WORDS.contains(&format!("{word}{next}").as_str())
            })
        {
            return true;
        }
    }
    false
}

fn query_mutation_identifier_words(identifier: &str) -> Vec<String> {
    let characters = identifier.chars().collect::<Vec<_>>();
    let mut words = Vec::new();
    let mut index = 0;
    while index < characters.len() {
        if !characters[index].is_ascii_alphanumeric() {
            index += 1;
            continue;
        }
        let start = index;
        if characters[index].is_ascii_digit() {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_digit() {
                index += 1;
            }
        } else if characters[index].is_ascii_uppercase() {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_uppercase() {
                if index + 1 < characters.len() && characters[index + 1].is_ascii_lowercase() {
                    break;
                }
                index += 1;
            }
            while index < characters.len() && characters[index].is_ascii_lowercase() {
                index += 1;
            }
        } else {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_lowercase() {
                index += 1;
            }
        }
        words.push(
            characters[start..index]
                .iter()
                .collect::<String>()
                .to_ascii_lowercase(),
        );
    }
    words
}

fn query_mutation_has_cache_update_within<'a>(
    root_span: oxc_span::Span,
    remaining_depth: usize,
    visited_helper_nodes: &mut FxHashSet<oxc_semantic::NodeId>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes()
        .iter()
        .filter(|candidate| root_span.contains_inclusive(candidate.span()))
        .any(|candidate| {
            query_mutation_node_indicates_cache_update(
                candidate,
                remaining_depth,
                visited_helper_nodes,
                ctx,
            )
        })
}

fn query_mutation_node_indicates_cache_update<'a>(
    node: &AstNode<'a>,
    remaining_depth: usize,
    visited_helper_nodes: &mut FxHashSet<oxc_semantic::NodeId>,
    ctx: &LintContext<'a>,
) -> bool {
    match node.kind() {
        AstKind::AssignmentExpression(assignment) => {
            query_mutation_assignment_is_location_href(&assignment.left)
        }
        AstKind::CallExpression(call) => {
            if query_mutation_is_full_page_navigation_call(call)
                || query_mutation_callable_syncs_cache(
                    &call.callee,
                    remaining_depth,
                    visited_helper_nodes,
                    ctx,
                )
            {
                return true;
            }
            call.arguments.iter().any(|argument| {
                argument
                    .as_expression()
                    .is_some_and(|expression| query_mutation_is_query_client_value(expression, ctx))
            })
        }
        AstKind::ObjectProperty(property)
            if property_key_identifier_name(&property.key)
                .is_some_and(|name| MUTATION_LIFECYCLE_CALLBACK_NAMES.contains(&name)) =>
        {
            (matches!(&property.value, Expression::Identifier(_))
                || property.value.as_member_expression().is_some())
                && query_mutation_callable_syncs_cache(
                    &property.value,
                    remaining_depth,
                    visited_helper_nodes,
                    ctx,
                )
        }
        _ => false,
    }
}

fn query_mutation_callable_syncs_cache<'a>(
    callable: &'a Expression<'a>,
    remaining_depth: usize,
    visited_helper_nodes: &mut FxHashSet<oxc_semantic::NodeId>,
    ctx: &LintContext<'a>,
) -> bool {
    if let Expression::Identifier(identifier) = callable {
        let name = identifier.name.as_str();
        if QUERY_CACHE_UPDATE_METHODS.contains(&name)
            && query_mutation_identifier_is_from_cache_hook(identifier, ctx)
        {
            return true;
        }
        if let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            && let Some(function_node_id) = query_mutation_symbol_function_node_id(symbol_id, ctx)
        {
            if remaining_depth == 0 || !visited_helper_nodes.insert(function_node_id) {
                return false;
            }
            return query_mutation_has_cache_update_within(
                ctx.nodes().get_node(function_node_id).span(),
                remaining_depth - 1,
                visited_helper_nodes,
                ctx,
            );
        }
        return query_mutation_name_suggests_cache_sync(name)
            || query_mutation_is_delegated_completion_callback(name);
    }
    let Some(member) = callable.as_member_expression() else {
        return false;
    };
    let oxc_ast::ast::MemberExpression::StaticMemberExpression(member) = member else {
        return false;
    };
    let method_name = member.property.name.as_str();
    if QUERY_CACHE_UPDATE_METHODS.contains(&method_name) {
        return true;
    }
    if method_name == "invalidate" {
        return query_mutation_member_root_identifier(&member.object)
            .is_some_and(|root| query_mutation_identifier_is_from_cache_hook(root, ctx));
    }
    query_mutation_name_suggests_cache_sync(method_name)
}

fn query_mutation_symbol_function_node_id<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::NodeId> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let span = match declaration.kind() {
        AstKind::Function(function) => function.body.as_ref()?.span,
        AstKind::VariableDeclarator(declarator) => {
            query_mutation_function_body_span(binding_pattern_initializer_for_symbol(
                &declarator.id,
                symbol_id,
                declarator.init.as_ref(),
            )?)?
        }
        AstKind::FormalParameter(parameter) => query_mutation_function_body_span(
            binding_pattern_initializer_for_symbol(&parameter.pattern, symbol_id, None)?,
        )?,
        _ => return None,
    };
    ctx.nodes()
        .iter()
        .find(|candidate| {
            candidate.span() == span && matches!(candidate.kind(), AstKind::FunctionBody(_))
        })
        .map(AstNode::id)
}

fn query_mutation_function_body_span(expression: &Expression<'_>) -> Option<oxc_span::Span> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.body.span()),
        Expression::FunctionExpression(function) => Some(function.body.as_ref()?.span),
        _ => None,
    }
}

fn query_mutation_identifier_is_from_cache_hook<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
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
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return false;
    };
    query_mutation_call_name(&call.callee)
        .is_some_and(|name| name == "useQueryClient" || query_mutation_is_trpc_utils_hook(name))
}

fn query_mutation_is_query_client_value<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    identifier.name == "queryClient"
        || query_mutation_identifier_is_from_cache_hook(identifier, ctx)
}

fn query_mutation_member_root_identifier<'a>(
    mut expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    loop {
        if let Expression::Identifier(identifier) = expression {
            return Some(identifier);
        }
        if let Expression::ChainExpression(chain) = expression {
            expression = chain.expression.as_member_expression()?.object();
            continue;
        }
        expression = expression.as_member_expression()?.object();
    }
}

fn query_mutation_name_suggests_cache_sync(name: &str) -> bool {
    let lowercase = name.to_ascii_lowercase();
    lowercase.contains("invalidat")
        || lowercase.contains("refetch")
        || lowercase.contains("querycache")
}

fn query_mutation_is_delegated_completion_callback(name: &str) -> bool {
    name.starts_with("on")
        && name.as_bytes().get(2).is_some_and(u8::is_ascii_uppercase)
        && query_mutation_identifier_words(name)
            .iter()
            .any(|word| COMPLETION_CALLBACK_VERBS.contains(&word.as_str()))
}

fn query_mutation_assignment_is_location_href(target: &oxc_ast::ast::AssignmentTarget<'_>) -> bool {
    let Some(member) = target.as_member_expression() else {
        return false;
    };
    if member.static_property_name() != Some("href") {
        return false;
    }
    let receiver = member.object().get_inner_expression();
    matches!(receiver, Expression::Identifier(identifier) if identifier.name == "location")
        || receiver
            .as_member_expression()
            .is_some_and(|receiver| receiver.static_property_name() == Some("location"))
}

fn query_mutation_is_full_page_navigation_call(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    if !matches!(
        member.static_property_name(),
        Some("assign" | "reload" | "replace")
    ) {
        return false;
    }
    query_mutation_member_chain_has_location(member.object())
}

fn query_mutation_member_chain_has_location(mut expression: &Expression<'_>) -> bool {
    loop {
        let expression_inner = expression.get_inner_expression();
        let Some(member) = expression_inner.as_member_expression() else {
            return matches!(expression_inner, Expression::Identifier(identifier) if identifier.name == "location");
        };
        if member.static_property_name() == Some("location") {
            return true;
        }
        expression = member.object();
    }
}
