use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoInvalidSplatPath;

declare_oxc_lint!(
    /// Disallow React Router splats outside the final complete path segment.
    ReactRouterNoInvalidSplatPath,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow invalid React Router splat paths.",
);

impl Rule for ReactRouterNoInvalidSplatPath {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ObjectExpression(route_object) = node.kind() else {
            return;
        };
        if !is_static_react_router_route_object(route_object, ctx) {
            return;
        }
        let Some(path_property) = get_static_route_property(route_object, "path") else {
            return;
        };
        let Some(route_path) = get_static_string_expression(&path_property.value) else {
            return;
        };
        if !route_path.contains('*') || route_path == "*" || route_path.ends_with("/*") {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Route path '{route_path}' uses a splat that is not a complete trailing segment."
            ))
            .with_label(path_property.span),
        );
    }
}
