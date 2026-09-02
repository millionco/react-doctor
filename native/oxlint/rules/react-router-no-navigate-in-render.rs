use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REACT_ROUTER_RUNTIME_MODULE_SOURCES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoNavigateInRender;

declare_oxc_lint!(
    /// Disallow navigate calls during render.
    ReactRouterNoNavigateInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow navigate calls during render.",
);

impl Rule for ReactRouterNoNavigateInRender {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Expression::Identifier(navigate_identifier) = &call_expression.callee else {
            return;
        };
        let Some(navigate_symbol_id) = ctx
            .scoping()
            .get_reference(navigate_identifier.reference_id())
            .symbol_id()
        else {
            return;
        };
        let declaration = ctx.symbol_declaration(navigate_symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return;
        };
        if declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding_identifier| binding_identifier.symbol_id() != navigate_symbol_id)
        {
            return;
        }
        let Some(Expression::CallExpression(use_navigate_call)) = &declarator.init else {
            return;
        };
        let Expression::Identifier(use_navigate_identifier) = &use_navigate_call.callee else {
            return;
        };
        if !direct_named_import_matches(
            use_navigate_identifier,
            &["useNavigate"],
            &REACT_ROUTER_RUNTIME_MODULE_SOURCES,
            ctx,
        ) || !is_render_phase_component_or_hook(node, ctx)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "{}() runs during render and can cause navigation loops or hydration divergence.",
                navigate_identifier.name
            ))
            .with_label(call_expression.span),
        );
    }
}
