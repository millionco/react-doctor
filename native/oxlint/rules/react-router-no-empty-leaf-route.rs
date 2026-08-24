use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const ROUTE_RENDER_PROPERTY_NAMES: [&str; 3] = ["Component", "element", "lazy"];
const ROUTE_RESOURCE_HANDLER_PROPERTY_NAMES: [&str; 4] =
    ["action", "clientAction", "clientLoader", "loader"];
const MESSAGE: &str =
    "This leaf route has no UI and no resource handler, so it renders a null outlet.";

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoEmptyLeafRoute;

declare_oxc_lint!(
    /// Warns when a React Router leaf route renders no UI or resource response.
    ReactRouterNoEmptyLeafRoute,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when a React Router leaf route is empty.",
);

impl Rule for ReactRouterNoEmptyLeafRoute {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ObjectExpression(route_object) = node.kind() else {
            return;
        };
        if !is_static_react_router_route_object(route_object, ctx)
            || has_active_route_property(route_object, "children", ctx)
            || (get_static_route_property(route_object, "path").is_none()
                && get_static_route_property(route_object, "index").is_none())
            || ROUTE_RENDER_PROPERTY_NAMES
                .iter()
                .any(|property_name| has_active_route_property(route_object, property_name, ctx))
            || ROUTE_RESOURCE_HANDLER_PROPERTY_NAMES
                .iter()
                .any(|property_name| has_active_route_property(route_object, property_name, ctx))
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(route_object.span));
    }
}
