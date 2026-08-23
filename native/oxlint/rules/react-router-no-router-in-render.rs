use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REACT_ROUTER_FACTORY_EXPORT_NAMES: [&str; 3] = [
    "createBrowserRouter",
    "createHashRouter",
    "createMemoryRouter",
];
const REACT_ROUTER_RUNTIME_MODULE_SOURCES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoRouterInRender;

declare_oxc_lint!(
    /// Disallow creating React Router routers during render.
    ReactRouterNoRouterInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow creating React Router routers during render.",
);

impl Rule for ReactRouterNoRouterInRender {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Expression::Identifier(identifier) = &call_expression.callee else {
            return;
        };
        if !is_direct_react_router_factory_import(identifier, ctx)
            || !is_render_phase_component_or_hook(node, ctx)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "{}() creates a new router during render and resets router state.",
                identifier.name
            ))
            .with_label(call_expression.span),
        );
    }
}

fn is_direct_react_router_factory_import<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    if !matches!(
        declaration.kind(),
        AstKind::ImportSpecifier(_) | AstKind::ImportDefaultSpecifier(_)
    ) {
        return false;
    }
    ctx.module_record().import_entries.iter().any(|entry| {
        if entry.is_type
            || !REACT_ROUTER_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
            || ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                != Some(symbol_id)
        {
            return false;
        }
        match &entry.import_name {
            crate::module_record::ImportImportName::Name(imported_name) => {
                REACT_ROUTER_FACTORY_EXPORT_NAMES.contains(&imported_name.name())
            }
            _ => false,
        }
    })
}
