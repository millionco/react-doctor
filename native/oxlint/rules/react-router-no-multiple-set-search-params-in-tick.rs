use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REACT_ROUTER_RUNTIME_PACKAGE_NAMES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoMultipleSetSearchParamsInTick;

declare_oxc_lint!(
    /// Warns when a React Router search-parameter setter runs multiple times synchronously.
    ReactRouterNoMultipleSetSearchParamsInTick,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns on multiple synchronous search parameter updates.",
);

impl Rule for ReactRouterNoMultipleSetSearchParamsInTick {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            return;
        };
        let BindingPattern::ArrayPattern(binding_pattern) = &declarator.id else {
            return;
        };
        let Some(Expression::CallExpression(use_search_params_call)) = &declarator.init else {
            return;
        };
        let Expression::Identifier(use_search_params_identifier) = &use_search_params_call.callee
        else {
            return;
        };
        if !direct_named_import_matches(
            use_search_params_identifier,
            &["useSearchParams"],
            &REACT_ROUTER_RUNTIME_PACKAGE_NAMES,
            ctx,
        ) {
            return;
        }
        let Some(BindingPattern::BindingIdentifier(setter_binding)) =
            binding_pattern.elements.get(1).and_then(Option::as_ref)
        else {
            return;
        };
        let mut setter_calls = ctx
            .scoping()
            .get_resolved_references(setter_binding.symbol_id())
            .filter_map(|reference| {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let call_node = ctx.nodes().parent_node(reference_node.id());
                let AstKind::CallExpression(call_expression) = call_node.kind() else {
                    return None;
                };
                (matches!(&call_expression.callee, Expression::Identifier(_))
                    && call_expression.callee.span() == reference_node.span())
                .then_some(call_node)
            })
            .collect::<Vec<_>>();
        setter_calls.sort_unstable_by_key(|call_node| call_node.span().start);

        for call_index in 1..setter_calls.len() {
            let call_node = setter_calls[call_index];
            let has_earlier_synchronous_call = setter_calls[..call_index]
                .iter()
                .copied()
                .any(|previous_call| {
                    if are_nodes_in_mutually_exclusive_branches(previous_call, call_node, ctx) {
                        return false;
                    }
                    let Some(function_node) =
                        crate::ast_util::get_enclosing_function(previous_call, ctx)
                    else {
                        return false;
                    };
                    if crate::ast_util::get_enclosing_function(call_node, ctx)
                        .is_none_or(|owner| owner.id() != function_node.id())
                        || !can_node_reach_later_node_within_function(
                            previous_call,
                            call_node,
                            function_node,
                            ctx,
                        )
                    {
                        return false;
                    }
                    !has_direct_await_between(previous_call, call_node, function_node, ctx)
                });
            if has_earlier_synchronous_call {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "{}() is called more than once on the same synchronous path, so an earlier update can be discarded.",
                        setter_binding.name
                    ))
                    .with_label(call_node.span()),
                );
            }
        }
    }
}

fn has_direct_await_between(
    first_call: &AstNode<'_>,
    second_call: &AstNode<'_>,
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let first_call_start = first_call.span().start;
    let second_call_start = second_call.span().start;
    ctx.nodes().iter().any(|candidate| {
        matches!(candidate.kind(), AstKind::AwaitExpression(_))
            && candidate.span().start > first_call_start
            && candidate.span().start < second_call_start
            && crate::ast_util::get_enclosing_function(candidate, ctx)
                .is_some_and(|owner| owner.id() == function_node.id())
    })
}
