use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REACT_ROUTER_RUNTIME_PACKAGE_NAMES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];
const MESSAGE: &str =
    "useLoaderData() can be unavailable when this error boundary handles a loader failure.";
const ROOT_ROUTE_FILENAMES: [&str; 12] = [
    "root.js",
    "root.jsx",
    "root.ts",
    "root.tsx",
    "root.mjs",
    "root.mjsx",
    "root.mts",
    "root.mtsx",
    "root.cjs",
    "root.cjsx",
    "root.cts",
    "root.ctsx",
];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoUseLoaderDataInErrorUi;

declare_oxc_lint!(
    /// Disallows useLoaderData in React Router error UI.
    ReactRouterNoUseLoaderDataInErrorUi,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow useLoaderData in error UI.",
);

impl Rule for ReactRouterNoUseLoaderDataInErrorUi {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let oxc_ast::ast::Expression::Identifier(callee) = &call_expression.callee else {
            return;
        };
        if !direct_named_import_matches(
            callee,
            &["useLoaderData"],
            &REACT_ROUTER_RUNTIME_PACKAGE_NAMES,
            ctx,
        ) {
            return;
        }
        let Some(error_ui_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        let is_error_boundary =
            is_react_router_route_function(error_ui_function, "ErrorBoundary", ctx);
        let is_framework_root_layout = has_capability(ctx, "react-router-framework")
            && is_react_router_root_route_filename(ctx)
            && is_react_router_route_function(error_ui_function, "Layout", ctx);
        if !is_error_boundary && !is_framework_root_layout {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(node.span()));
    }
}

fn is_react_router_root_route_filename(ctx: &LintContext<'_>) -> bool {
    ctx.file_path()
        .to_str()
        .and_then(|filename| filename.rsplit('/').next())
        .is_some_and(|filename| ROOT_ROUTE_FILENAMES.contains(&filename))
}
