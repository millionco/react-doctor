use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const MESSAGE: &str = "The `useEffect` callback is `async`, so it returns a Promise instead of a cleanup function. React calls that Promise as cleanup (a no-op) and the effect can race on unmount. Put the async work in an inner function and call it.";

#[derive(Debug, Default, Clone)]
pub struct NoAsyncEffectCallback;

declare_oxc_lint!(
    /// Disallow async React effect callbacks.
    NoAsyncEffectCallback,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow async React effect callbacks.",
);

impl Rule for NoAsyncEffectCallback {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !EFFECT_HOOK_NAMES
            .iter()
            .any(|hook_name| is_react_api_call(call_expression, hook_name, ctx))
            && !is_unbound_bare_effect_call(call_expression, ctx)
        {
            return;
        }
        let Some(callback) = call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let is_async_callback = match callback {
            Expression::ArrowFunctionExpression(function) => function.r#async,
            Expression::FunctionExpression(function) => function.r#async,
            _ => false,
        };
        if is_async_callback {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(callback.span()));
        }
    }
}

fn is_unbound_bare_effect_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = &call_expression.callee else {
        return false;
    };
    EFFECT_HOOK_NAMES.contains(&identifier.name.as_str())
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
}
