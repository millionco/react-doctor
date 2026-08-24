use oxc_ast::{
    AstKind,
    ast::{
        Expression, ImportDeclarationSpecifier, JSXElementName, JSXMemberExpression,
        JSXMemberExpressionObject, MemberExpression,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use rustc_hash::FxHashSet;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const TANSTACK_ROUTER_PACKAGE: &str = "@tanstack/react-router";
const HEAD_CONTENT_COMPONENT_NAME: &str = "HeadContent";

#[derive(Debug, Default, Clone)]
pub struct TanstackStartMissingHeadContent;

declare_oxc_lint!(
    /// Require HeadContent in TanStack Start root routes.
    TanstackStartMissingHeadContent,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require HeadContent in TanStack Start root routes.",
);

impl Rule for TanstackStartMissingHeadContent {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        is_tanstack_root_route_filename(&ctx.file_path().to_string_lossy())
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut head_content_component_names =
            FxHashSet::from_iter([HEAD_CONTENT_COMPONENT_NAME.to_string()]);
        let mut tanstack_router_namespace_names = FxHashSet::default();

        for node in ctx.nodes().iter() {
            let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
                continue;
            };
            let is_tanstack_router_import = import_declaration.source.value == TANSTACK_ROUTER_PACKAGE;
            for specifier in import_declaration.specifiers.iter().flatten() {
                match specifier {
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier)
                        if is_tanstack_router_import =>
                    {
                        tanstack_router_namespace_names.insert(specifier.local.name.to_string());
                    }
                    ImportDeclarationSpecifier::ImportSpecifier(specifier)
                        if specifier.imported.name() == HEAD_CONTENT_COMPONENT_NAME =>
                    {
                        head_content_component_names.insert(specifier.local.name.to_string());
                    }
                    _ => {}
                }
            }
        }

        for node in ctx.nodes().iter() {
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                continue;
            };
            let Some(alias) = declarator.id.get_binding_identifier() else {
                continue;
            };
            let Some(initializer) = &declarator.init else {
                continue;
            };
            match initializer {
                Expression::Identifier(identifier) => {
                    if head_content_component_names.contains(identifier.name.as_str()) {
                        head_content_component_names.insert(alias.name.to_string());
                    }
                    if tanstack_router_namespace_names.contains(identifier.name.as_str()) {
                        tanstack_router_namespace_names.insert(alias.name.to_string());
                    }
                }
                expression => {
                    let Some(member_expression) = expression.as_member_expression() else {
                        continue;
                    };
                    let Some(root_name) = member_expression_root_name(member_expression) else {
                        continue;
                    };
                    if tanstack_router_namespace_names.contains(root_name)
                        && member_expression_identifier_property_name(member_expression)
                            == Some(HEAD_CONTENT_COMPONENT_NAME)
                    {
                        head_content_component_names.insert(alias.name.to_string());
                    }
                }
            }
        }

        let mut has_head_content_element = false;
        let mut has_document_head_element = false;
        let mut has_custom_head_child_element = false;
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            match &opening_element.name {
                JSXElementName::Identifier(identifier) => {
                    if identifier.name == "head" {
                        has_document_head_element = true;
                    }
                    if head_content_component_names.contains(identifier.name.as_str()) {
                        has_head_content_element = true;
                    }
                }
                JSXElementName::IdentifierReference(identifier) => {
                    if head_content_component_names.contains(identifier.name.as_str()) {
                        has_head_content_element = true;
                    }
                }
                JSXElementName::MemberExpression(member_expression) => {
                    if jsx_member_root_name(member_expression).is_some_and(|root_name| {
                        tanstack_router_namespace_names.contains(root_name)
                    }) && member_expression.property.name == HEAD_CONTENT_COMPONENT_NAME
                    {
                        has_head_content_element = true;
                    }
                }
                _ => {}
            }

            if is_inside_document_head_element(node.id(), ctx)
                && jsx_element_name_is_custom(&opening_element.name)
            {
                has_custom_head_child_element = true;
            }
        }

        if has_document_head_element
            && !has_head_content_element
            && !has_custom_head_child_element
        {
            ctx.diagnostic(
                OxcDiagnostic::warn(
                    "Without <HeadContent /> in the __root route, your route head() meta tags never render.",
                )
                .with_label(program_estree_span(ctx.nodes().program())),
            );
        }
    }
}

fn member_expression_root_name<'a>(member_expression: &'a MemberExpression<'a>) -> Option<&'a str> {
    match member_expression.object() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => member_expression_root_name(expression.as_member_expression()?),
    }
}

fn jsx_member_root_name<'a>(member_expression: &'a JSXMemberExpression<'a>) -> Option<&'a str> {
    match &member_expression.object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        JSXMemberExpressionObject::MemberExpression(member_expression) => {
            jsx_member_root_name(member_expression)
        }
        JSXMemberExpressionObject::ThisExpression(_) => None,
    }
}

fn jsx_element_name_is_custom(element_name: &JSXElementName<'_>) -> bool {
    let root_name = match element_name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        JSXElementName::MemberExpression(member_expression) => jsx_member_root_name(member_expression),
        _ => None,
    };
    root_name
        .and_then(|name| name.chars().next())
        .is_some_and(char::is_uppercase)
}

fn is_inside_document_head_element(
    node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().ancestors(node_id).any(|ancestor| {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            return false;
        };
        matches!(
            &element.opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "head"
        )
    })
}
