use oxc_ast::{
    ast::{Argument, Expression, FunctionBody, Statement},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "Your component re-renders on every dispatched action when useSelector returns a new object or array.";

#[derive(Debug, Default, Clone)]
pub struct ReduxUseselectorReturnsNewCollection;

declare_oxc_lint!(
    /// Warn when useSelector directly returns a fresh object or array.
    ReduxUseselectorReturnsNewCollection,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "useSelector returns a new collection.",
);

impl Rule for ReduxUseselectorReturnsNewCollection {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::Program(program) = node.kind() else {
            return;
        };
        let (aliases, has_fallback_import) = collect_react_redux_selector_alias_names(program);
        if aliases.is_empty() && !has_fallback_import {
            return;
        }
        for candidate in ctx.nodes().iter() {
            let AstKind::CallExpression(call) = candidate.kind() else {
                continue;
            };
            let Expression::Identifier(callee) = &call.callee else {
                continue;
            };
            let is_selector = aliases.contains(callee.name.as_str())
                || (callee.name == "useSelector" && has_fallback_import);
            if !is_selector || call.arguments.len() != 1 {
                continue;
            }
            let Some(selector) = call.arguments.first().and_then(Argument::as_expression) else {
                continue;
            };
            if redux_use_selector_returns_new_collection(selector) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
            }
        }
    }
}

fn redux_use_selector_returns_new_collection(selector: &Expression<'_>) -> bool {
    match selector.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            function
                .get_expression()
                .is_some_and(redux_use_selector_is_new_collection)
                || function
                    .get_function_body()
                    .is_some_and(redux_use_selector_body_returns_new_collection)
        }
        Expression::FunctionExpression(function) => function
            .body
            .as_deref()
            .is_some_and(redux_use_selector_body_returns_new_collection),
        _ => false,
    }
}

fn redux_use_selector_body_returns_new_collection(body: &FunctionBody<'_>) -> bool {
    let Some(Statement::ReturnStatement(statement)) = body.statements.last() else {
        return false;
    };
    statement
        .argument
        .as_ref()
        .is_some_and(redux_use_selector_is_new_collection)
}

fn redux_use_selector_is_new_collection(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::ObjectExpression(_) | Expression::ArrayExpression(_)
    )
}
