use oxc_ast::{AstKind, ast::Statement};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This catch cannot observe downstream route errors because next() returns their rendered Response.";

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoCatchMiddlewareNext;

declare_oxc_lint!(
    /// Warns when React Router middleware tries to catch downstream route errors.
    ReactRouterNoCatchMiddlewareNext,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when middleware catches a next call.",
);

impl Rule for ReactRouterNoCatchMiddlewareNext {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
            && is_react_router_file_active(ctx)
            && is_react_router_framework_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::TryStatement(try_statement) = node.kind() else {
            return;
        };
        if try_statement.handler.is_none() || try_statement.block.body.len() != 1 {
            return;
        }
        let expression = match &try_statement.block.body[0] {
            Statement::ReturnStatement(statement) => statement.argument.as_ref(),
            Statement::ExpressionStatement(statement) => Some(&statement.expression),
            _ => None,
        };
        let Some(expression) = expression else {
            return;
        };
        let expression = match expression {
            oxc_ast::ast::Expression::AwaitExpression(await_expression) => {
                &await_expression.argument
            }
            expression => expression,
        };
        let oxc_ast::ast::Expression::CallExpression(next_call) = expression else {
            return;
        };
        let oxc_ast::ast::Expression::Identifier(next_callee) = &next_call.callee else {
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
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(try_statement.span));
    }
}
