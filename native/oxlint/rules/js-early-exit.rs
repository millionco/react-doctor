use oxc_ast::{ast::Statement, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const DEEP_NESTING_THRESHOLD: usize = 3;

#[derive(Debug, Default, Clone)]
pub struct JsEarlyExit;

declare_oxc_lint!(
    /// Prefer early exits over deeply nested single-branch conditions.
    JsEarlyExit,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer early exits over deeply nested single-branch conditions.",
);

impl Rule for JsEarlyExit {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::IfStatement(if_statement) = node.kind() else {
            return;
        };
        if if_statement.alternate.is_some() {
            return;
        }
        let mut nested_if_count = 0;
        let mut current_statement = &if_statement.consequent;
        loop {
            let Statement::BlockStatement(block_statement) = current_statement else {
                break;
            };
            let [Statement::IfStatement(inner_if_statement)] = block_statement.body.as_slice()
            else {
                break;
            };
            if inner_if_statement.alternate.is_some() {
                break;
            }
            nested_if_count += 1;
            current_statement = &inner_if_statement.consequent;
        }
        if nested_if_count < DEEP_NESTING_THRESHOLD {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This is hard to follow because there are {} levels of nested if statements, so return early to keep it flat",
                nested_if_count + 1
            ))
            .with_label(if_statement.span),
        );
    }
}
