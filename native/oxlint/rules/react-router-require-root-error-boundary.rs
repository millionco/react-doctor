use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str = "This top-level route branch has no error boundary, so failures fall through to React Router's generic default UI.";

#[derive(Debug, Default, Clone)]
pub struct ReactRouterRequireRootErrorBoundary;

declare_oxc_lint!(
    /// Require an error boundary on each top-level React Router branch.
    ReactRouterRequireRootErrorBoundary,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require root route error boundaries.",
);

impl Rule for ReactRouterRequireRootErrorBoundary {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ObjectExpression(route_object) = node.kind() else {
            return;
        };
        if !is_static_react_router_route_object(route_object, ctx)
            || !is_top_level_route_object(route_object, ctx)
            || has_active_route_property(route_object, "ErrorBoundary", ctx)
            || has_active_route_property(route_object, "errorElement", ctx)
            || has_active_route_property(route_object, "lazy", ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(route_object.span));
    }
}

fn is_top_level_route_object<'a>(
    route_object: &'a oxc_ast::ast::ObjectExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let route_array_node = ctx.nodes().parent_node(route_object.node_id.get());
    if !matches!(route_array_node.kind(), AstKind::ArrayExpression(_)) {
        return false;
    }
    matches!(
        ctx.nodes().parent_node(route_array_node.id()).kind(),
        AstKind::CallExpression(_)
    )
}
