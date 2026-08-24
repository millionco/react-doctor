use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "Calling `measureElement` during render reads layout before Ink commits it.";

#[derive(Debug, Default, Clone)]
pub struct InkNoMeasureElementInRender;

declare_oxc_lint!(
    /// Disallow Ink element measurement during React render.
    InkNoMeasureElementInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow Ink measurement during render.",
);

impl Rule for InkNoMeasureElementInRender {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !imported_module_api_matches(&call_expression.callee, "measureElement", "ink", ctx)
            || !is_render_phase_component_or_hook(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
    }
}
