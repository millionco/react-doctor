use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const EXCLUSIVE_ROUTE_PROPERTY_PAIRS: [(&str, &str); 3] = [
    ("Component", "element"),
    ("ErrorBoundary", "errorElement"),
    ("HydrateFallback", "hydrateFallbackElement"),
];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterValidRouteObject;

declare_oxc_lint!(
    /// Disallow incompatible properties on a React Router route object.
    ReactRouterValidRouteObject,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow contradictory React Router route objects.",
);

impl Rule for ReactRouterValidRouteObject {
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
        let is_index_route = get_static_route_property(route_object, "index").is_some_and(|property| {
            matches!(&property.value, Expression::BooleanLiteral(literal) if literal.value)
        });
        if is_index_route {
            if let Some(children_property) =
                get_active_route_property(route_object, "children", ctx)
            {
                ctx.diagnostic(
                    OxcDiagnostic::warn("An index route cannot also declare children.")
                        .with_label(children_property.span),
                );
            }
        }
        for (component_property_name, element_property_name) in EXCLUSIVE_ROUTE_PROPERTY_PAIRS {
            if get_active_route_property(route_object, component_property_name, ctx).is_none()
                || get_active_route_property(route_object, element_property_name, ctx).is_none()
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Route declares both {component_property_name} and {element_property_name}; only one is used."
                ))
                .with_label(route_object.span),
            );
        }
    }
}

fn get_active_route_property<'a>(
    route_object: &'a oxc_ast::ast::ObjectExpression<'a>,
    property_name: &str,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::ObjectProperty<'a>> {
    get_static_route_property(route_object, property_name)
        .filter(|property| !is_definitely_falsy_expression(&property.value, ctx))
}
