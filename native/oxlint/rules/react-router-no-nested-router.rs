use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This router is directly nested under another router provider.";
const REACT_ROUTER_RUNTIME_MODULE_SOURCES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];
const ROUTER_COMPONENT_NAMES: [&str; 5] = [
    "BrowserRouter",
    "HashRouter",
    "MemoryRouter",
    "Router",
    "RouterProvider",
];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoNestedRouter;

declare_oxc_lint!(
    /// Disallow a React Router provider inside another router provider.
    ReactRouterNoNestedRouter,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow nested React Router providers.",
);

impl Rule for ReactRouterNoNestedRouter {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !is_router_element(&element.opening_element, ctx)
            || !ctx.nodes().ancestors(node.id()).any(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::JSXElement(ancestor_element)
                        if is_router_element(&ancestor_element.opening_element, ctx)
                )
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.span));
    }
}

fn is_router_element<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    REACT_ROUTER_RUNTIME_MODULE_SOURCES
        .iter()
        .find_map(|module_source| {
            resolve_imported_jsx_component_name(opening_element, module_source, ctx)
        })
        .is_some_and(|component_name| ROUTER_COMPONENT_NAMES.contains(&component_name))
}
