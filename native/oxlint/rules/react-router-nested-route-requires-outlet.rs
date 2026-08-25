use oxc_ast::{
    AstKind,
    ast::{Expression, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str =
    "This parent route has children but its resolved inline UI does not render Outlet.";
const OUTLET_EXPORT_NAMES: [&str; 2] = ["Outlet", "useOutlet"];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNestedRouteRequiresOutlet;

declare_oxc_lint!(
    /// Requires inline parent route UI to render an outlet for nested routes.
    ReactRouterNestedRouteRequiresOutlet,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require an outlet for nested React Router routes.",
);

impl Rule for ReactRouterNestedRouteRequiresOutlet {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ObjectExpression(route_object) = node.kind() else {
            return;
        };
        if !is_static_react_router_route_object(route_object, ctx)
            || !has_active_route_property(route_object, "children", ctx)
        {
            return;
        }
        let Some(route_content) = get_resolved_inline_route_content(route_object, ctx) else {
            return;
        };
        if contains_react_router_export_usage(route_content, &OUTLET_EXPORT_NAMES, ctx) {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::error(MESSAGE).with_label(oxc_span::GetSpan::span(route_object)),
        );
    }
}

fn get_resolved_inline_route_content<'a>(
    route_object: &'a oxc_ast::ast::ObjectExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    if let Some(component_property) = get_static_route_property(route_object, "Component")
        && matches!(
            component_property.value,
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        )
    {
        return (!contains_delegated_component(&component_property.value, ctx))
            .then_some(&component_property.value);
    }
    let element_property = get_static_route_property(route_object, "element")?;
    if !matches!(
        element_property.value,
        Expression::JSXElement(_) | Expression::JSXFragment(_)
    ) || contains_delegated_component(&element_property.value, ctx)
    {
        return None;
    }
    Some(&element_property.value)
}

fn contains_delegated_component(root: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let root_span = oxc_span::GetSpan::span(root);
    ctx.nodes().iter().any(|candidate| {
        if !root_span.contains_inclusive(oxc_span::GetSpan::span(candidate))
            || is_inside_nested_react_router_usage_function(candidate, root_span, ctx)
        {
            return false;
        }
        let AstKind::JSXElement(element) = candidate.kind() else {
            return false;
        };
        is_delegated_component_name(&element.opening_element.name)
    })
}

fn is_delegated_component_name(name: &JSXElementName<'_>) -> bool {
    let identifier_name = match name {
        JSXElementName::Identifier(identifier) => identifier.name.as_str(),
        JSXElementName::IdentifierReference(identifier) => identifier.name.as_str(),
        _ => return true,
    };
    identifier_name.chars().next().is_none_or(|first_character| {
        first_character.to_uppercase().eq([first_character])
    })
}
