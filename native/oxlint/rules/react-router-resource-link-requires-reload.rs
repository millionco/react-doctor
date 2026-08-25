use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXAttributeValue, JSXElementName},
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
const REACT_ROUTER_RESOURCE_HANDLER_PROPERTY_NAMES: [&str; 4] = [
    "action",
    "clientAction",
    "clientLoader",
    "loader",
];
const REACT_ROUTER_RUNTIME_PACKAGE_NAMES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterResourceLinkRequiresReload;

declare_oxc_lint!(
    /// Requires document reloads for links to React Router resource routes.
    ReactRouterResourceLinkRequiresReload,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require document reloads for resource links.",
);

impl Rule for ReactRouterResourceLinkRequiresReload {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut resource_route_paths = FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::ObjectExpression(route_object) = node.kind() else {
                continue;
            };
            if !is_static_react_router_route_object(route_object, ctx)
                || !REACT_ROUTER_RESOURCE_HANDLER_PROPERTY_NAMES
                    .iter()
                    .any(|property_name| {
                        has_active_route_property(route_object, property_name, ctx)
                    })
                || REACT_ROUTER_RENDER_PROPERTY_NAMES
                    .iter()
                    .any(|property_name| {
                        has_active_route_property(route_object, property_name, ctx)
                    })
                || has_active_route_property(route_object, "children", ctx)
            {
                continue;
            }
            if let Some(route_path) = get_static_route_full_path(route_object, ctx) {
                resource_route_paths.insert(route_path);
            }
        }
        if resource_route_paths.is_empty() {
            return;
        }

        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let JSXElementName::IdentifierReference(_) = &opening_element.name else {
                continue;
            };
            let Some(imported_name) = REACT_ROUTER_RUNTIME_PACKAGE_NAMES.iter().find_map(
                |module_source| {
                    resolve_imported_jsx_component_name(opening_element, module_source, ctx)
                        .filter(|imported_name| matches!(*imported_name, "Link" | "NavLink"))
                },
            ) else {
                continue;
            };
            if is_jsx_attribute_potentially_truthy(has_jsx_prop(
                opening_element,
                "reloadDocument",
            )) || is_jsx_attribute_potentially_truthy(has_jsx_prop(opening_element, "download"))
            {
                continue;
            }
            if let Some(target_attribute) = has_jsx_prop(opening_element, "target")
                && resource_link_string_attribute_value(target_attribute) != Some("_self")
            {
                continue;
            }
            let Some(to_attribute) = has_jsx_prop(opening_element, "to") else {
                continue;
            };
            let Some(destination) = resource_link_string_attribute_value(to_attribute) else {
                continue;
            };
            if has_url_scheme(destination) || destination.starts_with("//") {
                continue;
            }
            let destination_path = destination
                .split(['?', '#'])
                .next()
                .unwrap_or_default();
            if !resource_route_paths.contains(destination_path) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "{imported_name} to '{destination}' is intercepted as an SPA navigation instead of a document request."
                ))
                .with_label(opening_element.span),
            );
        }
    }
}

fn resource_link_string_attribute_value<'a>(
    attribute: &'a JSXAttributeItem<'a>,
) -> Option<&'a str> {
    let JSXAttributeItem::Attribute(attribute) = attribute else {
        return None;
    };
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(literal) => Some(literal.value.as_str()),
        JSXAttributeValue::ExpressionContainer(container) => {
            match strip_parenthesized_expression(container.expression.as_expression()?) {
                Expression::StringLiteral(literal) => Some(literal.value.as_str()),
                Expression::TemplateLiteral(template)
                    if template.expressions.is_empty() && template.quasis.len() == 1 =>
                {
                    let quasi = &template.quasis[0];
                    Some(
                        quasi
                            .value
                            .cooked
                            .as_ref()
                            .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str()),
                    )
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn has_url_scheme(destination: &str) -> bool {
    let Some((scheme, _)) = destination.split_once(':') else {
        return false;
    };
    !scheme.is_empty()
        && scheme
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic())
        && scheme.bytes().skip(1).all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-')
        })
}
