use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{context::{ContextHost, LintContext}, rule::Rule};

const MESSAGE: &str = "Two next() calls can execute on the same middleware path.";

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoMultipleMiddlewareNext;

declare_oxc_lint!(
    /// Disallows multiple reachable continuation calls in React Router middleware.
    ReactRouterNoMultipleMiddlewareNext,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow multiple reachable middleware continuation calls.",
);

impl Rule for ReactRouterNoMultipleMiddlewareNext {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
            && is_react_router_file_active(ctx)
            && is_react_router_framework_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut middleware_functions = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                if !matches!(
                    node.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ) {
                    return None;
                }
                get_react_router_middleware_next_symbol(node, ctx)
                    .map(|next_symbol_id| (node, next_symbol_id))
            })
            .collect::<Vec<_>>();
        middleware_functions.sort_unstable_by_key(|(node, _)| node.span().start);

        for (middleware_function, next_symbol_id) in middleware_functions {
            let mut next_calls = ctx
                .scoping()
                .get_resolved_references(next_symbol_id)
                .filter_map(|reference| {
                    let reference_node = ctx.nodes().get_node(reference.node_id());
                    let call_node = ctx.nodes().parent_node(reference_node.id());
                    let AstKind::CallExpression(call_expression) = call_node.kind() else {
                        return None;
                    };
                    if !matches!(&call_expression.callee, Expression::Identifier(_))
                        || call_expression.callee.span() != reference_node.span()
                        || crate::ast_util::get_enclosing_function(call_node, ctx)
                            .is_none_or(|function| function.id() != middleware_function.id())
                    {
                        return None;
                    }
                    Some(call_node)
                })
                .collect::<Vec<_>>();
            if next_calls.len() < 2 {
                continue;
            }
            next_calls.sort_unstable_by_key(|node| node.span().start);
            let mut second_reachable_call = None;
            let excluded_blocks = FxHashSet::default();
            for first_index in 0..next_calls.len() {
                for second_index in (first_index + 1)..next_calls.len() {
                    let first_call = next_calls[first_index];
                    let second_call = next_calls[second_index];
                    if !are_nodes_in_mutually_exclusive_branches(first_call, second_call, ctx)
                        && (cfg_block_can_reach(
                            ctx.nodes().cfg_id(first_call.id()),
                            ctx.nodes().cfg_id(second_call.id()),
                            &excluded_blocks,
                            ctx,
                        ) || cfg_block_can_reach(
                            ctx.nodes().cfg_id(second_call.id()),
                            ctx.nodes().cfg_id(first_call.id()),
                            &excluded_blocks,
                            ctx,
                        ))
                    {
                        second_reachable_call = Some(second_call);
                        break;
                    }
                }
                if second_reachable_call.is_some() {
                    break;
                }
            }
            if let Some(call_node) = second_reachable_call {
                ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(call_node.span()));
            }
        }
    }
}
