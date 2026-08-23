use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REACT_ROUTER_FACTORY_EXPORT_NAMES: [&str; 3] = [
    "createBrowserRouter",
    "createHashRouter",
    "createMemoryRouter",
];
const REACT_ROUTER_RUNTIME_MODULE_SOURCES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoRouterInRender;

declare_oxc_lint!(
    /// Disallow creating React Router routers during render.
    ReactRouterNoRouterInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow creating React Router routers during render.",
);

impl Rule for ReactRouterNoRouterInRender {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Expression::Identifier(identifier) = &call_expression.callee else {
            return;
        };
        if !is_direct_react_router_factory_import(identifier, ctx)
            || !is_render_phase_component_or_hook(node, ctx)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "{}() creates a new router during render and resets router state.",
                identifier.name
            ))
            .with_label(call_expression.span),
        );
    }
}

fn is_direct_react_router_factory_import<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    direct_named_import_matches(
        identifier,
        &REACT_ROUTER_FACTORY_EXPORT_NAMES,
        &REACT_ROUTER_RUNTIME_MODULE_SOURCES,
        ctx,
    )
}
