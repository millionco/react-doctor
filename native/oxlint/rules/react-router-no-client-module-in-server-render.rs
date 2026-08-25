use oxc_ast::{
    AstKind,
    ast::{JSXElementName, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoClientModuleInServerRender;

declare_oxc_lint!(
    /// Disallows rendering client-only module imports during server rendering.
    ReactRouterNoClientModuleInServerRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow rendering client-only modules on the server.",
);

impl Rule for ReactRouterNoClientModuleInServerRender {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_non_production_file(ctx)
            && is_react_router_file_active(ctx)
            && is_react_router_framework_file_active(ctx)
            && !is_client_only_file(&ctx.file_path().to_string_lossy().replace('\\', "/"))
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let JSXElementName::IdentifierReference(identifier) = &opening_element.name else {
            return;
        };
        let Some(import_entry) = resolve_identifier_import(identifier, ctx) else {
            return;
        };
        let module_source = import_entry.module_request.name();
        if !is_client_module(module_source)
            || is_inside_imported_client_only_render_prop(node, ctx)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::error(format!(
                "Component from '{module_source}' is rendered on the server even though its module is client-only."
            ))
            .with_label(opening_element.span),
        );
    }
}

fn is_client_only_file(filename: &str) -> bool {
    let filename = filename.rsplit('/').next().unwrap_or(filename);
    [
        ".client.js",
        ".client.jsx",
        ".client.ts",
        ".client.tsx",
        ".client.cjs",
        ".client.cjsx",
        ".client.cts",
        ".client.ctsx",
        ".client.mjs",
        ".client.mjsx",
        ".client.mts",
        ".client.mtsx",
    ]
    .iter()
    .any(|suffix| filename.ends_with(suffix))
}

fn is_client_module(module_source: &str) -> bool {
    let segment = module_source.rsplit('/').next().unwrap_or(module_source);
    segment
        .match_indices(".client")
        .any(|(client_marker_index, _)| {
            client_marker_index > 0
                && segment[client_marker_index + ".client".len()..]
                    .as_bytes()
                    .first()
                    .is_none_or(|character| *character == b'.')
        })
}

fn is_client_only_boundary_module(module_source: &str) -> bool {
    let segment = module_source.rsplit('/').next().unwrap_or(module_source);
    segment == "client-only" || segment.starts_with("client-only.")
}

fn is_inside_imported_client_only_render_prop(
    opening_element_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().ancestors(opening_element_node.id()).any(|ancestor| {
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        let expression_container_node = ctx.nodes().parent_node(ancestor.id());
        let AstKind::JSXExpressionContainer(expression_container) =
            expression_container_node.kind()
        else {
            return false;
        };
        if !matches!(
            &expression_container.expression,
            JSXExpression::ArrowFunctionExpression(_) | JSXExpression::FunctionExpression(_)
        ) || expression_container.expression.span() != ancestor.span()
        {
            return false;
        }
        let client_only_element_node = ctx.nodes().parent_node(expression_container_node.id());
        let AstKind::JSXElement(client_only_element) = client_only_element_node.kind() else {
            return false;
        };
        let JSXElementName::IdentifierReference(client_only_identifier) =
            &client_only_element.opening_element.name
        else {
            return false;
        };
        resolve_identifier_import(client_only_identifier, ctx).is_some_and(|import_entry| {
            is_client_only_boundary_module(import_entry.module_request.name())
        })
    })
}
