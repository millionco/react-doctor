use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "A module-scoped `delayRender()` handle blocks all compositions and composition discovery. Move it inside the component and create it once with `useDelayRender()` or a lazy `useState` initializer.";

#[derive(Debug, Default, Clone)]
pub struct RemotionNoModuleScopeDelayRender;

declare_oxc_lint!(
    /// Disallow module-scoped Remotion delayRender calls.
    RemotionNoModuleScopeDelayRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow module-scoped Remotion delayRender calls.",
);

impl Rule for RemotionNoModuleScopeDelayRender {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if crate::ast_util::get_enclosing_function(node, ctx).is_some()
            || !imported_module_api_matches(&call_expression.callee, "delayRender", "remotion", ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
    }
}
