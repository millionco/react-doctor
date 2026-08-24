use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "Calling `delayRender()` during every component render creates another outstanding handle and can make rendering time out. Use `useDelayRender()` or a lazy `useState` initializer.";

#[derive(Debug, Default, Clone)]
pub struct RemotionStableDelayRenderHandle;

declare_oxc_lint!(
    /// Require stable Remotion delayRender handles.
    RemotionStableDelayRenderHandle,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require stable Remotion delayRender handles.",
);

impl Rule for RemotionStableDelayRenderHandle {
    fn run_once(&self, ctx: &LintContext<'_>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if imported_module_api_matches(&call_expression.callee, "delayRender", "remotion", ctx)
                && is_render_phase_component_or_hook(node, ctx)
                && !is_use_state_lazy_initializer(node, ctx)
            {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
            }
        }
    }
}

fn is_use_state_lazy_initializer<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let Some(enclosing_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    let callback_root = transparent_expression_root(enclosing_function, ctx);
    let parent = ctx.nodes().parent_node(callback_root.id());
    matches!(
        parent.kind(),
        AstKind::CallExpression(call_expression)
            if expression_is_argument_at(&call_expression.arguments, 0, callback_root.span())
                && is_react_api_call(call_expression, "useState", ctx)
    )
}
