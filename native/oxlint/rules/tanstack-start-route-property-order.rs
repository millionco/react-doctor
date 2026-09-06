use oxc_ast::{AstKind, ast::ObjectPropertyKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const ROUTE_PROPERTY_ORDER: [&str; 15] = [
    "params",
    "validateSearch",
    "loaderDeps",
    "search.middlewares",
    "ssr",
    "context",
    "beforeLoad",
    "loader",
    "onEnter",
    "onStay",
    "onLeave",
    "head",
    "scripts",
    "headers",
    "remountDeps",
];

#[derive(Debug, Default, Clone)]
pub struct TanstackStartRoutePropertyOrder;

declare_oxc_lint!(
    /// Enforce the route property order required for TanStack Router type inference.
    TanstackStartRoutePropertyOrder,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Enforce TanStack route property order.",
);

impl Rule for TanstackStartRoutePropertyOrder {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(route_call) = node.kind() else {
            return;
        };
        let Some(options_object) = get_tanstack_route_options_object(route_call) else {
            return;
        };
        let mut last_property_index = None;
        for property in &options_object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            let Some(property_name) = property.key.static_name() else {
                continue;
            };
            let Some(current_property_index) = ROUTE_PROPERTY_ORDER
                .iter()
                .position(|candidate| *candidate == property_name)
            else {
                continue;
            };
            if let Some(last_property_index) = last_property_index
                && current_property_index < last_property_index
            {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Ordering route property \"{}\" after \"{}\" breaks type inference.",
                        property_name, ROUTE_PROPERTY_ORDER[last_property_index],
                    ))
                    .with_label(options_object.span()),
                );
                return;
            }
            last_property_index = Some(current_property_index);
        }
    }
}
