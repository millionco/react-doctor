use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const DESCENDANT_ROUTE_EXPORT_NAMES: [&str; 2] = ["Routes", "useRoutes"];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterDescendantRoutesRequireSplat;

declare_oxc_lint!(
    /// Requires a splat on routes that mount descendant React Router trees.
    ReactRouterDescendantRoutesRequireSplat,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require splats on routes with descendant route trees.",
);

impl Rule for ReactRouterDescendantRoutesRequireSplat {
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
        if route_path == "*" || route_path.ends_with("/*") {
            return;
        }
        let route_content = get_inline_route_content(route_object);
        if route_content.is_none_or(|content| {
            !contains_react_router_export_usage(
                content,
                &DESCENDANT_ROUTE_EXPORT_NAMES,
                ctx,
            )
        }) {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::error(format!(
                "Route path '{route_path}' mounts a descendant route tree but does not end with /*."
            ))
            .with_label(path_property.span),
        );
    }
}

fn get_inline_route_content<'a>(
    route_object: &'a oxc_ast::ast::ObjectExpression<'a>,
) -> Option<&'a Expression<'a>> {
    if let Some(component_property) = get_static_route_property(route_object, "Component")
        && matches!(
            component_property.value,
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        )
    {
        return Some(&component_property.value);
    }
    get_static_route_property(route_object, "element").map(|property| &property.value)
}
