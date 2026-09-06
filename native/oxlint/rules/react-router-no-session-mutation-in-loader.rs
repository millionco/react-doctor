use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const SESSION_MUTATOR_NAMES: [&str; 3] = ["flash", "set", "unset"];
const DESTROY_MESSAGE: &str = "loader destroys the session with destroySession(), which exposes logout to cross-site GET requests.";

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoSessionMutationInLoader;

declare_oxc_lint!(
    /// Disallows React Router loaders from mutating session state.
    ReactRouterNoSessionMutationInLoader,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow session mutation in loaders.",
);

impl Rule for ReactRouterNoSessionMutationInLoader {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
            && is_react_router_file_active(ctx)
            && is_react_router_framework_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            return;
        };
        let Some(session_binding) = declarator.id.get_binding_identifier() else {
            return;
        };
        let Some(initializer) = &declarator.init else {
            return;
        };
        let get_session_expression = match initializer {
            Expression::AwaitExpression(await_expression) => &await_expression.argument,
            expression => expression,
        };
        let Expression::CallExpression(get_session_call) = get_session_expression else {
            return;
        };
        let Expression::Identifier(get_session_callee) = &get_session_call.callee else {
            return;
        };
        if !is_react_router_session_method(get_session_callee, "getSession", ctx) {
            return;
        }
        let Some(loader_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        if !is_react_router_route_function(loader_function, "loader", ctx) {
            return;
        }

        let session_symbol_id = session_binding.symbol_id();
        for reference in ctx.scoping().get_resolved_references(session_symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let parent = ctx.nodes().parent_node(reference_node.id());
            if let AstKind::CallExpression(call_expression) = parent.kind()
                && is_react_router_session_method_call(
                    call_expression,
                    session_symbol_id,
                    "destroySession",
                    ctx,
                )
            {
                ctx.diagnostic(OxcDiagnostic::error(DESTROY_MESSAGE).with_label(parent.span()));
                continue;
            }
            match parent.kind() {
                AstKind::StaticMemberExpression(member_expression) => {
                    report_loader_session_mutation(
                        parent,
                        member_expression.property.name.as_str(),
                        ctx,
                    );
                }
                AstKind::ComputedMemberExpression(member_expression) => {
                    if let Some(method_name) = member_expression.static_property_name() {
                        report_loader_session_mutation(parent, &method_name, ctx);
                    }
                }
                _ => {}
            }
        }
    }
}

fn report_loader_session_mutation(
    member_node: &AstNode<'_>,
    method_name: &str,
    ctx: &LintContext<'_>,
) {
    if !SESSION_MUTATOR_NAMES.contains(&method_name) {
        return;
    }
    let call_node = ctx.nodes().parent_node(member_node.id());
    let AstKind::CallExpression(call_expression) = call_node.kind() else {
        return;
    };
    if call_expression.callee.span() != member_node.span() {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::error(format!(
            "loader mutates the session with {method_name}(), which can race parallel loader execution."
        ))
        .with_label(call_node.span()),
    );
}
