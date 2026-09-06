use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str =
    "Direct fetch() in a route loader runs on the client too with no type safety.";

#[derive(Debug, Default, Clone)]
pub struct TanstackStartNoDirectFetchInLoader;

declare_oxc_lint!(
    /// Disallow direct fetch calls in TanStack Start route loaders.
    TanstackStartNoDirectFetchInLoader,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow direct fetch calls in route loaders.",
);

impl Rule for TanstackStartNoDirectFetchInLoader {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(fetch_call) = node.kind() else {
            return;
        };
        let oxc_ast::ast::Expression::Identifier(fetch_identifier) = &fetch_call.callee else {
            return;
        };
        if fetch_identifier.name != "fetch" {
            return;
        }
        for _ in 0..count_enclosing_tanstack_route_loaders(node, ctx) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(fetch_call.span));
        }
    }
}

fn count_enclosing_tanstack_route_loaders(node: &AstNode<'_>, ctx: &LintContext<'_>) -> usize {
    ctx.nodes()
        .ancestors(node.id())
        .filter(|ancestor| {
            let AstKind::ObjectProperty(loader_property) = ancestor.kind() else {
                return false;
            };
            if loader_property.key.static_name().as_deref() != Some("loader") {
                return false;
            }
            let options_node = ctx.nodes().parent_node(ancestor.id());
            let AstKind::ObjectExpression(options_object) = options_node.kind() else {
                return false;
            };
            let route_call_node = ctx.nodes().parent_node(options_node.id());
            let AstKind::CallExpression(route_call) = route_call_node.kind() else {
                return false;
            };
            get_tanstack_route_options_object(route_call)
                .is_some_and(|candidate| candidate.node_id == options_object.node_id)
        })
        .count()
}
