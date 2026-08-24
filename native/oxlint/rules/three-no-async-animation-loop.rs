use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str = "The animation scheduler ignores this Promise, so rejected work can become unhandled and awaited work can overlap across frames. Keep the callback synchronous";
const THREE_RENDERER_CONSTRUCTOR_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];

#[derive(Debug, Default, Clone)]
pub struct ThreeNoAsyncAnimationLoop;

declare_oxc_lint!(
    /// Disallow asynchronous Three.js animation callbacks.
    ThreeNoAsyncAnimationLoop,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow asynchronous Three.js animation callbacks.",
);

impl Rule for ThreeNoAsyncAnimationLoop {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut reported_callback_spans = Vec::new();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let callback = if is_three_set_animation_loop_call(call_expression, ctx) {
                call_expression
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                    .and_then(|argument| resolve_local_react_callback(argument, ctx))
            } else if let Some(callback) =
                resolve_recursive_animation_frame_callback(call_expression, false, ctx)
            {
                callback_renders_with_three(callback.1, ctx).then_some(callback)
            } else {
                None
            };
            let Some((true, callback_span)) = callback else {
                continue;
            };
            if reported_callback_spans.contains(&callback_span) {
                continue;
            }
            reported_callback_spans.push(callback_span);
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(callback_span));
        }
    }
}

fn is_three_set_animation_loop_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    member_expression.static_property_name() == Some("setAnimationLoop")
        && three_constructor_name(
            member_expression.object(),
            &THREE_RENDERER_CONSTRUCTOR_NAMES,
            ctx,
        )
        .is_some()
}

fn callback_renders_with_three(callback_span: Span, ctx: &LintContext) -> bool {
    let mut has_three_render = false;
    for candidate in ctx
        .nodes()
        .iter()
        .filter(|candidate| callback_span.contains_inclusive(candidate.span()))
    {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        if let Some(member_expression) = call_expression.callee.as_member_expression()
            && matches!(
                member_expression.static_property_name(),
                Some("render" | "renderAsync")
            )
            && three_constructor_name(
                member_expression.object(),
                &THREE_RENDERER_CONSTRUCTOR_NAMES,
                ctx,
            )
            .is_some()
        {
            has_three_render = true;
        }
    }
    has_three_render
}
