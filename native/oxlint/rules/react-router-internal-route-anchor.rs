use oxc_ast::{
    ast::{JSXAttributeItem, JSXElementName},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use rustc_hash::FxHashSet;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::has_jsx_prop,
};

const REACT_ROUTER_RENDER_PROPERTY_NAMES: [&str; 3] = ["Component", "element", "lazy"];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterInternalRouteAnchor;

declare_oxc_lint!(
    /// Prevents document navigations to known React Router UI routes.
    ReactRouterInternalRouteAnchor,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Use React Router links for known UI routes.",
);

impl Rule for ReactRouterInternalRouteAnchor {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut ui_route_paths = FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::ObjectExpression(route_object) = node.kind() else {
                continue;
            };
            if !is_static_react_router_route_object(route_object, ctx)
                || !REACT_ROUTER_RENDER_PROPERTY_NAMES
                    .iter()
                    .any(|property_name| {
                        has_active_route_property(route_object, property_name, ctx)
                    })
            {
                continue;
            }
            if let Some(route_path) = get_static_route_full_path(route_object, ctx) {
                ui_route_paths.insert(route_path);
            }
        }
        if ui_route_paths.is_empty() {
            return;
        }

        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !matches!(
                &opening_element.name,
                JSXElementName::Identifier(identifier) if identifier.name == "a"
            ) || is_jsx_attribute_potentially_truthy(has_jsx_prop(opening_element, "download"))
            {
                continue;
            }
            if let Some(target_item) = has_jsx_prop(opening_element, "target") {
                let JSXAttributeItem::Attribute(target_attribute) = target_item else {
                    continue;
                };
                if get_string_literal_attribute_value(target_attribute) != Some("_self") {
                    continue;
                }
            }
            let Some(href_item) = has_jsx_prop(opening_element, "href") else {
                continue;
            };
            let JSXAttributeItem::Attribute(href_attribute) = href_item else {
                continue;
            };
            let Some(destination) = get_string_literal_attribute_value(href_attribute) else {
                continue;
            };
            if !destination.starts_with('/') || destination.starts_with("//") {
                continue;
            }
            let destination_path = destination
                .split(['?', '#'])
                .next()
                .unwrap_or(destination);
            if !ui_route_paths.contains(destination_path) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Anchor navigates to known UI route '{destination_path}' with a full document request."
                ))
                .with_label(opening_element.span),
            );
        }
    }
}
