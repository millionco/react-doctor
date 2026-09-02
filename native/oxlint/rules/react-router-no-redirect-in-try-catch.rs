use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REACT_ROUTER_RESOURCE_HANDLER_PROPERTY_NAMES: [&str; 4] =
    ["action", "clientAction", "clientLoader", "loader"];
const REACT_ROUTER_RUNTIME_PACKAGE_NAMES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoRedirectInTryCatch;

declare_oxc_lint!(
    /// Disallows thrown React Router redirects inside swallowing try-catch blocks.
    ReactRouterNoRedirectInTryCatch,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow swallowed React Router redirects.",
);

impl Rule for ReactRouterNoRedirectInTryCatch {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ThrowStatement(throw_statement) = node.kind() else {
            return;
        };
        let Expression::CallExpression(redirect_call) = &throw_statement.argument else {
            return;
        };
        let Expression::Identifier(redirect_callee) = &redirect_call.callee else {
            return;
        };
        if !direct_named_import_matches(
            redirect_callee,
            &["redirect", "redirectDocument"],
            &REACT_ROUTER_RUNTIME_PACKAGE_NAMES,
            ctx,
        ) {
            return;
        }
        let Some(route_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        if !REACT_ROUTER_RESOURCE_HANDLER_PROPERTY_NAMES
            .iter()
            .any(|handler_name| {
                is_react_router_route_function(route_function, handler_name, ctx)
            })
            || !find_guarding_try_statement(node.id(), ctx)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::error(format!(
                "throw {}() is guarded by a catch block that can swallow the redirect response.",
                redirect_callee.name
            ))
            .with_label(throw_statement.span),
        );
    }
}
