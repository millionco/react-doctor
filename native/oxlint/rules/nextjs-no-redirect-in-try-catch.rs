use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const NEXTJS_NAVIGATION_FUNCTION_NAMES: [&str; 2] = ["redirect", "notFound"];

#[derive(Debug, Default, Clone)]
pub struct NextjsNoRedirectInTryCatch;

declare_oxc_lint!(
    /// Warns when a Next.js navigation control-flow error is swallowed by try-catch.
    NextjsNoRedirectInTryCatch,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when redirect or notFound is swallowed by try-catch.",
);

impl Rule for NextjsNoRedirectInTryCatch {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Expression::Identifier(callee) = &call_expression.callee else {
            return;
        };
        if !NEXTJS_NAVIGATION_FUNCTION_NAMES
            .iter()
            .any(|function_name| {
                imported_module_api_matches(
                    &call_expression.callee,
                    function_name,
                    "next/navigation",
                    ctx,
                )
            })
            || !find_guarding_try_statement(node.id(), ctx)
        {
            return;
        }

        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "{}() inside try-catch gets swallowed, so the redirect silently fails.",
                callee.name
            ))
            .with_label(call_expression.span),
        );
    }
}
