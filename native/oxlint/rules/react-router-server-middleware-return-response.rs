use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Server middleware discards the Response returned by next().";

#[derive(Debug, Default, Clone)]
pub struct ReactRouterServerMiddlewareReturnResponse;

declare_oxc_lint!(
    /// Requires React Router server middleware to return a response after calling next.
    ReactRouterServerMiddlewareReturnResponse,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require server middleware to return a response.",
);

impl Rule for ReactRouterServerMiddlewareReturnResponse {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
            && is_react_router_file_active(ctx)
            && is_react_router_framework_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(next_call) = node.kind() else {
            return;
        };
        let Expression::Identifier(next_callee) = &next_call.callee else {
            return;
        };
        let Some(middleware_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        let Some(next_symbol_id) =
            get_react_router_middleware_next_symbol(middleware_function, ctx)
        else {
            return;
        };
        if ctx
            .scoping()
            .get_reference(next_callee.reference_id())
            .symbol_id()
            != Some(next_symbol_id)
        {
            return;
        }
        let parent = ctx.nodes().parent_node(node.id());
        let awaited_node = if matches!(parent.kind(), AstKind::AwaitExpression(_)) {
            parent
        } else {
            node
        };
        let Some(response_receipt_statement) = response_receipt_statement(awaited_node, ctx) else {
            return;
        };
        let return_nodes = ctx
            .nodes()
            .iter()
            .filter(|candidate| {
                matches!(
                    candidate.kind(),
                    AstKind::ReturnStatement(return_statement)
                        if return_statement.argument.is_some()
                )
            })
            .collect::<Vec<_>>();
        if do_nodes_cover_every_path_after_node(
            response_receipt_statement,
            &return_nodes,
            middleware_function,
            ctx,
        ) {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::error(MESSAGE).with_label(response_receipt_statement.span()),
        );
    }
}

fn response_receipt_statement<'a, 'ctx>(
    awaited_node: &AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx AstNode<'a>> {
    let parent = ctx.nodes().parent_node(awaited_node.id());
    match parent.kind() {
        AstKind::ExpressionStatement(_) => Some(parent),
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == awaited_node.span()) =>
        {
            let declaration = ctx.nodes().parent_node(parent.id());
            matches!(declaration.kind(), AstKind::VariableDeclaration(_)).then_some(declaration)
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.right.span() == awaited_node.span() =>
        {
            let statement = ctx.nodes().parent_node(parent.id());
            matches!(statement.kind(), AstKind::ExpressionStatement(_)).then_some(statement)
        }
        _ => None,
    }
}
