use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const ANIMATION_CALLBACK_NAMES: [&str; 2] = ["requestAnimationFrame", "setInterval"];

#[derive(Debug, Default, Clone)]
pub struct NoGlobalCssVariableAnimation;

declare_oxc_lint!(
    /// Disallows animating inherited CSS variables on the document root.
    NoGlobalCssVariableAnimation,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallows animating inherited CSS variables on the document root.",
);

impl Rule for NoGlobalCssVariableAnimation {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(set_property_call) = node.kind() else {
            return;
        };
        if !is_document_root_set_property_call(set_property_call, ctx) {
            return;
        }
        let Some(Expression::StringLiteral(variable_name)) = set_property_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        if !variable_name.value.starts_with("--") {
            return;
        }
        let Some(animation_callback_name) = ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
            let AstKind::CallExpression(animation_call) = ancestor.kind() else {
                return None;
            };
            let Expression::Identifier(callee) = animation_call.callee.get_inner_expression()
            else {
                return None;
            };
            if !ANIMATION_CALLBACK_NAMES.contains(&callee.name.as_str())
                || !animation_call
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                    .is_some_and(|callback| callback.span().contains_inclusive(node.span()))
            {
                return None;
            }
            Some(callee.name.as_str())
        }) else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This forces every element using \"{}\" to recompute its styles each frame because {animation_callback_name} changes it every frame, so set it on just the element that needs it",
                variable_name.value
            ))
            .with_label(set_property_call.span),
        );
    }
}

fn is_document_root_set_property_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(set_property_member) = call_expression.callee.as_member_expression() else {
        return false;
    };
    if set_property_member.static_property_name() != Some("setProperty") {
        return false;
    }
    let Some(style_member) = set_property_member
        .object()
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if style_member.static_property_name() != Some("style") {
        return false;
    }
    let Some(target_member) = style_member
        .object()
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if !matches!(
        target_member.static_property_name(),
        Some("documentElement" | "body")
    ) {
        return false;
    }
    let Expression::Identifier(document) = target_member.object().get_inner_expression() else {
        return false;
    };
    document.name == "document"
        && ctx
            .scoping()
            .get_reference(document.reference_id())
            .symbol_id()
            .is_none()
}
