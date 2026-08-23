use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "motionValue() creates a fresh reactive object during this render. Use useMotionValue() so React preserves the value across renders.";

#[derive(Debug, Default, Clone)]
pub struct MotionValueConstructorInRender;

declare_oxc_lint!(
    /// Disallow constructing Motion values during render.
    MotionValueConstructorInRender,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow constructing Motion values during render.",
);

impl Rule for MotionValueConstructorInRender {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if motion_react_api_path_matches(&call_expression.callee, &["motionValue"], ctx)
            && is_render_phase_component_or_hook(node, ctx)
            && !is_inside_stable_react_initializer(node, ctx)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
        }
    }
}
