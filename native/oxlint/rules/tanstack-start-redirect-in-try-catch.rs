use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct TanstackStartRedirectInTryCatch;

declare_oxc_lint!(
    /// Detect swallowed TanStack Start redirects.
    TanstackStartRedirectInTryCatch,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Detect TanStack Start redirects inside swallowing try blocks.",
);

impl Rule for TanstackStartRedirectInTryCatch {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ThrowStatement(throw_statement) = node.kind() else {
            return;
        };
        let Expression::CallExpression(call_expression) = &throw_statement.argument else {
            return;
        };
        let Expression::Identifier(callee) = &call_expression.callee else {
            return;
        };
        if !matches!(callee.name.as_str(), "redirect" | "notFound")
            || !find_guarding_try_statement(node.id(), ctx)
        {
            return;
        }

        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "throw {}() inside a try block gets swallowed, so the redirect silently fails.",
                callee.name
            ))
            .with_label(throw_statement.span),
        );
    }
}
