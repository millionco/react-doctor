use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoInvalidAbsoluteChildPath;

declare_oxc_lint!(
    /// Disallow absolute React Router child paths that escape their parent.
    ReactRouterNoInvalidAbsoluteChildPath,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow absolute child paths that escape their parent route.",
);

impl Rule for ReactRouterNoInvalidAbsoluteChildPath {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_react_router_file_active(ctx)
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
        if !route_path.starts_with('/') {
            return;
        }
        let parent_path = get_parent_route_path(route_object, ctx);
        let Some(parent_path) = parent_path else {
            return;
        };
        if parent_path == "/"
            || parent_path.contains(':')
            || parent_path.contains('*')
            || parent_path.contains('?')
            || route_path == parent_path
            || route_path
                .strip_prefix(parent_path.as_str())
                .is_some_and(|suffix| suffix.starts_with('/'))
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Absolute child path '{route_path}' does not begin with parent path '{parent_path}'."
            ))
            .with_label(path_property.span),
        );
    }
}

fn get_parent_route_path<'a>(
    route_object: &'a oxc_ast::ast::ObjectExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let route_array_node = ctx.nodes().parent_node(route_object.node_id.get());
    let AstKind::ArrayExpression(_) = route_array_node.kind() else {
        return Some("/".to_string());
    };
    let children_property_node = ctx.nodes().parent_node(route_array_node.id());
    let AstKind::ObjectProperty(_) = children_property_node.kind() else {
        return Some("/".to_string());
    };
    let parent_route_node = ctx.nodes().parent_node(children_property_node.id());
    let AstKind::ObjectExpression(parent_route) = parent_route_node.kind() else {
        return Some("/".to_string());
    };
    get_static_route_full_path(parent_route, ctx)
}
