use oxc_ast::{
    ast::{Argument, Expression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const OBJECT_FREEZE_OR_SEAL_METHOD_NAMES: [&str; 2] = ["freeze", "seal"];

#[derive(Debug, Default, Clone)]
pub struct ServerCacheWithObjectLiteral;

declare_oxc_lint!(
    /// Disallow fresh object arguments to React cache wrappers.
    ServerCacheWithObjectLiteral,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow fresh object arguments to React cache wrappers.",
);

impl Rule for ServerCacheWithObjectLiteral {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut cached_function_declaration_starts = FxHashMap::default();
        for node in ctx.nodes().iter() {
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                continue;
            };
            let Some(identifier) = declarator.id.get_binding_identifier() else {
                continue;
            };
            let Some(Expression::CallExpression(call_expression)) = &declarator.init else {
                continue;
            };
            if !is_react_cache_call(call_expression) {
                continue;
            }
            cached_function_declaration_starts
                .entry(identifier.name.as_str())
                .or_insert(node.span().start);
        }
        if cached_function_declaration_starts.is_empty() {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Expression::Identifier(callee) = &call_expression.callee else {
                continue;
            };
            let Some(declaration_start) =
                cached_function_declaration_starts.get(callee.name.as_str())
            else {
                continue;
            };
            if *declaration_start > node.span().start {
                continue;
            }
            let Some(first_argument) = call_expression
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            if !matches!(
                unwrap_object_integrity_expression(
                    first_argument,
                    ctx,
                    &OBJECT_FREEZE_OR_SEAL_METHOD_NAMES,
                ),
                Expression::ObjectExpression(_)
            ) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(
                    "Passing a new object to React.cache() each render misses the cache, so it refetches every request.",
                )
                .with_label(call_expression.span),
            );
        }
    }
}

fn is_react_cache_call(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    match &call_expression.callee {
        Expression::Identifier(identifier) => identifier.name == "cache",
        Expression::StaticMemberExpression(member_expression) => {
            member_expression.property.name == "cache"
                && matches!(
                    &member_expression.object,
                    Expression::Identifier(identifier) if identifier.name == "React"
                )
        }
        Expression::ComputedMemberExpression(member_expression) => {
            matches!(
                &member_expression.object,
                Expression::Identifier(identifier) if identifier.name == "React"
            ) && matches!(
                &member_expression.expression,
                Expression::Identifier(identifier) if identifier.name == "cache"
            )
        }
        _ => false,
    }
}
