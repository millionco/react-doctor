use oxc_ast::{
    AstKind,
    ast::{Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const FORBIDDEN_LAZY_ROUTE_PROPERTY_NAMES: [&str; 6] = [
    "caseSensitive",
    "children",
    "id",
    "index",
    "lazy",
    "path",
];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoInvalidLazyRouteProperties;

declare_oxc_lint!(
    /// Disallows route-matching properties returned by React Router lazy functions.
    ReactRouterNoInvalidLazyRouteProperties,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow immutable route properties returned from lazy.",
);

impl Rule for ReactRouterNoInvalidLazyRouteProperties {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ObjectProperty(lazy_property) = node.kind() else {
            return;
        };
        if lazy_property.key.static_name().as_deref() != Some("lazy") {
            return;
        }
        let route_object_node = ctx.nodes().parent_node(node.id());
        let AstKind::ObjectExpression(route_object) = route_object_node.kind() else {
            return;
        };
        if !is_static_react_router_route_object(route_object, ctx) {
            return;
        }
        match lazy_property.value.get_inner_expression() {
            Expression::ArrowFunctionExpression(function) => {
                if let Some(expression) = function.get_expression() {
                    report_forbidden_lazy_route_properties(expression, ctx);
                } else if let Some(body) = function.get_function_body() {
                    report_forbidden_properties_from_function_returns(
                        function.node_id.get(),
                        body.span,
                        ctx,
                    );
                }
            }
            Expression::FunctionExpression(function) => {
                let Some(body) = function.body.as_deref() else {
                    return;
                };
                report_forbidden_properties_from_function_returns(
                    function.node_id.get(),
                    body.span,
                    ctx,
                );
            }
            _ => {}
        }
    }
}

fn report_forbidden_properties_from_function_returns(
    function_node_id: NodeId,
    body_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) {
    for candidate in ctx.nodes().iter() {
        if !body_span.contains_inclusive(candidate.span()) {
            continue;
        }
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        let belongs_to_function = ctx
            .nodes()
            .ancestors(candidate.id())
            .find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })
            .is_some_and(|function| function.id() == function_node_id);
        if !belongs_to_function {
            continue;
        }
        if let Some(argument) = &return_statement.argument {
            report_forbidden_lazy_route_properties(argument, ctx);
        }
    }
}

fn report_forbidden_lazy_route_properties(expression: &Expression<'_>, ctx: &LintContext<'_>) {
    let Expression::ObjectExpression(returned_object) = expression.get_inner_expression() else {
        return;
    };
    for property in &returned_object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let Some(property_name) = property.key.static_name() else {
            continue;
        };
        if !FORBIDDEN_LAZY_ROUTE_PROPERTY_NAMES.contains(&property_name.as_ref()) {
            continue;
        }
        ctx.diagnostic(
            OxcDiagnostic::error(format!(
                "lazy() cannot change the route-matching property '{property_name}'."
            ))
            .with_label(property.span),
        );
    }
}
