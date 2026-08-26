use oxc_ast::{
    ast::{CallExpression, Expression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str = "`matchMedia()` in a useState initializer can cause an SSR crash or seed different server and hydration state. Prefer CSS media queries for layout, or use `useSyncExternalStore` with a stable server snapshot.";

#[derive(Debug, Default, Clone)]
pub struct NoMatchMediaInStateInitializer;

declare_oxc_lint!(
    /// Disallow matchMedia calls during useState initialization.
    NoMatchMediaInStateInitializer,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow matchMedia calls during useState initialization.",
);

impl Rule for NoMatchMediaInStateInitializer {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && !is_react_native_file_target(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(state_call) = node.kind() else {
            return;
        };
        if !is_react_api_call(state_call, "useState", ctx) {
            return;
        }
        let Some(initializer) = state_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let Some(initialization_span) = synchronous_initializer_span(initializer) else {
            return;
        };
        let Some(match_media_call) = find_direct_match_media_call(initialization_span, ctx) else {
            return;
        };
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(match_media_call.span));
    }
}

fn synchronous_initializer_span(expression: &Expression<'_>) -> Option<Span> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) if !function.r#async => {
            Some(function.body.span())
        }
        Expression::FunctionExpression(function) if !function.r#async && !function.generator => {
            Some(function.body.as_ref()?.span)
        }
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => None,
        expression => Some(expression.span()),
    }
}

fn find_direct_match_media_call<'a>(
    initialization_span: Span,
    ctx: &LintContext<'a>,
) -> Option<&'a CallExpression<'a>> {
    ctx.nodes()
        .iter()
        .filter(|node| initialization_span.contains_inclusive(node.span()))
        .filter_map(|node| {
            let AstKind::CallExpression(call) = node.kind() else {
                return None;
            };
            if !is_global_match_media_call(call, ctx)
                || is_inside_nested_function(node, initialization_span, ctx)
            {
                return None;
            }
            Some(call)
        })
        .min_by_key(|call| call.span.start)
}

fn is_inside_nested_function(
    node: &AstNode<'_>,
    initialization_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        initialization_span.contains_inclusive(ancestor.span())
            && matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
    })
}

fn is_global_match_media_call(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            identifier.name == "matchMedia" && identifier_is_global(identifier, ctx)
        }
        Expression::StaticMemberExpression(member) if member.property.name == "matchMedia" => {
            matches!(member.object.get_inner_expression(), Expression::Identifier(identifier)
                if matches!(identifier.name.as_str(), "window" | "globalThis")
                    && identifier_is_global(identifier, ctx))
        }
        _ => false,
    }
}

fn identifier_is_global(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_none()
}
