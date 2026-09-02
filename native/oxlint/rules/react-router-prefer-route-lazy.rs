use oxc_ast::{
    AstKind,
    ast::{Expression, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "React.lazy defers only the component; use the route lazy property to load the full route module in parallel.";

#[derive(Debug, Default, Clone)]
pub struct ReactRouterPreferRouteLazy;

declare_oxc_lint!(
    /// Prefers React Router route lazy properties over React.lazy route components.
    ReactRouterPreferRouteLazy,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer route lazy properties over React.lazy.",
);

impl Rule for ReactRouterPreferRouteLazy {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if has_capability(ctx, "react-router-framework") {
            return;
        }
        let AstKind::ObjectExpression(route_object) = node.kind() else {
            return;
        };
        if !is_static_react_router_route_object(route_object, ctx)
            || get_static_route_property(route_object, "lazy").is_some()
        {
            return;
        }
        let Some(content_property) = get_static_route_property(route_object, "Component")
            .or_else(|| get_static_route_property(route_object, "element"))
        else {
            return;
        };
        let Some(component_symbol_id) = eager_route_component_symbol_id(content_property, ctx)
        else {
            return;
        };
        let declaration = ctx.symbol_declaration(component_symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return;
        };
        let variable_declaration = ctx.nodes().parent_node(declaration.id());
        let AstKind::VariableDeclaration(variable_declaration) = variable_declaration.kind() else {
            return;
        };
        if !variable_declaration.kind.is_const()
            || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != component_symbol_id)
        {
            return;
        }
        let Some(initializer) = &declarator.init else {
            return;
        };
        let Expression::CallExpression(initializer) = strip_parenthesized_expression(initializer)
        else {
            return;
        };
        if !is_react_api_call(initializer, "lazy", ctx) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(content_property.span));
    }
}

fn eager_route_component_symbol_id(
    content_property: &oxc_ast::ast::ObjectProperty<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    match strip_parenthesized_expression(&content_property.value) {
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id(),
        Expression::JSXElement(element) => {
            let JSXElementName::IdentifierReference(identifier) = &element.opening_element.name
            else {
                return None;
            };
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
        }
        _ => None,
    }
}
