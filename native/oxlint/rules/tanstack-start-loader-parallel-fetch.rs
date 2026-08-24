use oxc_ast::{
    AstKind,
    ast::{Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str =
    "Sequential awaits in this loader create a request waterfall that slows the route.";

#[derive(Debug, Default, Clone)]
pub struct TanstackStartLoaderParallelFetch;

declare_oxc_lint!(
    /// Detect independent sequential awaits in TanStack Start loaders.
    TanstackStartLoaderParallelFetch,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Detect request waterfalls in TanStack Start loaders.",
);

impl Rule for TanstackStartLoaderParallelFetch {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(route_call) = node.kind() else {
            return;
        };
        let Some(options) = get_tanstack_route_options_object(route_call) else {
            return;
        };
        for property in &options.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            if property.key.static_name().as_deref() != Some("loader") {
                continue;
            }
            let body = match &property.value {
                Expression::ArrowFunctionExpression(function) => function.body.as_function_body(),
                Expression::FunctionExpression(function) => function.body.as_deref(),
                _ => None,
            };
            let Some(body) = body else {
                continue;
            };
            if find_sequential_independent_await(body, 2, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(property.span));
            }
        }
    }
}
