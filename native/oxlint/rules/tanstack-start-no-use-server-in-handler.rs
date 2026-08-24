use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "\"use server\" inside a createServerFn handler duplicates TanStack Start's server boundary, so the route can fail to compile.";

#[derive(Debug, Default, Clone)]
pub struct TanstackStartNoUseServerInHandler;

declare_oxc_lint!(
    /// Disallow use server directives inside TanStack Start handlers.
    TanstackStartNoUseServerInHandler,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow use server directives inside server-function handlers.",
);

impl Rule for TanstackStartNoUseServerInHandler {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(handler_call) = node.kind() else {
            return;
        };
        let Expression::StaticMemberExpression(handler_member) = &handler_call.callee else {
            return;
        };
        if handler_member.property.name != "handler" {
            return;
        }
        let Some(handler_function) = handler_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let (function_body, function_span) = match handler_function {
            Expression::ArrowFunctionExpression(function) => {
                let Some(function_body) = function.body.as_function_body() else {
                    return;
                };
                (function_body, function.span)
            }
            Expression::FunctionExpression(function) => {
                let Some(function_body) = function.body.as_deref() else {
                    return;
                };
                (function_body, function.span)
            }
            _ => return,
        };
        let has_use_server_directive = function_body
            .directives
            .iter()
            .any(|directive| directive.directive == "use server")
            || function_body.statements.iter().any(|statement| {
                matches!(
                    statement,
                    oxc_ast::ast::Statement::ExpressionStatement(expression_statement)
                        if matches!(
                            &expression_statement.expression,
                            Expression::StringLiteral(string_literal)
                                if string_literal.value == "use server"
                        )
                )
            });
        if !has_use_server_directive {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(function_span));
    }
}
