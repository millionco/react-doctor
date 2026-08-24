use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule};

const DOM_ROUTER_COMPONENT_NAMES: [&str; 4] = ["BrowserRouter", "HashRouter", "Link", "NavLink"];
const DOM_ROUTER_FACTORY_NAMES: [&str; 2] = ["createBrowserRouter", "createHashRouter"];
const ROUTER_MODULE_SOURCES: [&str; 2] = ["react-router", "react-router-dom"];

#[derive(Debug, Default, Clone)]
pub struct InkNoDomRouter;

declare_oxc_lint!(
    /// Disallow DOM routers inside Ink trees.
    InkNoDomRouter,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow DOM routers inside Ink trees.",
);

impl Rule for InkNoDomRouter {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let ink_tree = module_jsx_tree_index("ink", ctx);
        if ink_tree.is_empty() {
            return;
        }
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::JSXOpeningElement(opening_element) => {
                    let Some(component_name) =
                        ROUTER_MODULE_SOURCES.iter().find_map(|module_source| {
                            resolve_imported_jsx_component_name(opening_element, module_source, ctx)
                        })
                    else {
                        continue;
                    };
                    if !DOM_ROUTER_COMPONENT_NAMES.contains(&component_name) {
                        continue;
                    }
                    let Some(element_span) = owning_jsx_element_span(node, ctx) else {
                        continue;
                    };
                    if ink_tree.contains_or_is_inside(element_span) {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(format!(
                                "`{component_name}` depends on DOM history; use a memory router with Ink."
                            ))
                            .with_label(opening_element.span),
                        );
                    }
                }
                AstKind::CallExpression(call_expression) => {
                    let Expression::Identifier(identifier) =
                        call_expression.callee.get_inner_expression()
                    else {
                        continue;
                    };
                    let Some(factory_name) = DOM_ROUTER_FACTORY_NAMES.iter().find(|factory_name| {
                        direct_named_import_matches(
                            identifier,
                            &[*factory_name],
                            &ROUTER_MODULE_SOURCES,
                            ctx,
                        )
                    }) else {
                        continue;
                    };
                    if ink_tree.is_inside(call_expression.span) {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(format!(
                                "`{factory_name}` requires a DOM; use `createMemoryRouter` with Ink."
                            ))
                            .with_label(call_expression.span),
                        );
                    }
                }
                _ => {}
            }
        }
    }
}
