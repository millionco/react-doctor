use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str =
    "Independent awaits run sequentially in this loader and create a navigation waterfall.";

#[derive(Debug, Default, Clone)]
pub struct ReactRouterLoaderParallelFetch;

declare_oxc_lint!(
    /// Detect independent sequential fetches in React Router loaders.
    ReactRouterLoaderParallelFetch,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Run independent React Router loader fetches in parallel.",
);

impl Rule for ReactRouterLoaderParallelFetch {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let body = match node.kind() {
            AstKind::Function(function) => function.body.as_deref(),
            AstKind::ArrowFunctionExpression(function) => function.body.as_function_body(),
            _ => None,
        };
        let Some(body) = body else {
            return;
        };
        if !is_react_router_route_function(node, "loader", ctx)
            && !is_react_router_route_function(node, "clientLoader", ctx)
        {
            return;
        }
        let Some(sequential_await_span) =
            find_sequential_independent_await(body, 2, Some(is_global_fetch_call), ctx)
        else {
            return;
        };
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(sequential_await_span));
    }
}

fn is_global_fetch_call<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let Expression::CallExpression(call_expression) = expression else {
        return false;
    };
    let Expression::Identifier(callee) = &call_expression.callee else {
        return false;
    };
    callee.name == "fetch"
        && ctx
            .scoping()
            .get_reference(callee.reference_id())
            .symbol_id()
            .is_none()
}
