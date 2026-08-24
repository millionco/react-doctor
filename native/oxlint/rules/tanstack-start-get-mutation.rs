use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct TanstackStartGetMutation;

declare_oxc_lint!(
    /// Detect mutations inside GET TanStack Start server functions.
    TanstackStartGetMutation,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Detect mutations inside GET TanStack Start server functions.",
);

impl Rule for TanstackStartGetMutation {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(handler_call) = node.kind() else {
            return;
        };
        let Some(handler_member) = handler_call.callee.as_member_expression() else {
            return;
        };
        if member_expression_identifier_property_name(handler_member) != Some("handler") {
            return;
        }
        let chain_info = walk_tanstack_server_fn_chain(handler_call);
        if !chain_info.is_server_fn_chain
            || chain_info.specified_method.is_some_and(|method| {
                matches!(
                    method.to_ascii_uppercase().as_str(),
                    "POST" | "PUT" | "DELETE" | "PATCH"
                )
            })
        {
            return;
        }
        let Some(handler_expression) = handler_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .map(Expression::get_inner_expression)
        else {
            return;
        };
        let (handler_function_node_id, handler_body_span) = match handler_expression {
            Expression::ArrowFunctionExpression(function) => {
                let handler_body_span = function
                    .get_expression()
                    .map(oxc_span::GetSpan::span)
                    .or_else(|| function.get_function_body().map(|body| body.span));
                let Some(handler_body_span) = handler_body_span else {
                    return;
                };
                (function.node_id.get(), handler_body_span)
            }
            Expression::FunctionExpression(function) => {
                let Some(body) = &function.body else {
                    return;
                };
                (function.node_id.get(), body.span)
            }
            _ => return,
        };
        let Some(side_effect) = find_side_effect(handler_function_node_id, handler_body_span, ctx)
        else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This GET server function's side effect ({side_effect}) is vulnerable to CSRF attacks."
            ))
            .with_label(handler_call.span),
        );
    }
}
