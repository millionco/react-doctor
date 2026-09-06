use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This renderer uses the device's raw pixel ratio without a cap. Bound the ratio to limit the rendered pixel count on high-density displays";
const THREE_RENDERER_CONSTRUCTOR_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];

#[derive(Debug, Default, Clone)]
pub struct ThreeCapDevicePixelRatio;

declare_oxc_lint!(
    /// Require a cap on Three.js device pixel ratios.
    ThreeCapDevicePixelRatio,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Require a cap on Three.js device pixel ratios.",
);

impl Rule for ThreeCapDevicePixelRatio {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(member_expression) = call_expression.callee.as_member_expression() else {
            return;
        };
        if member_expression.static_property_name() != Some("setPixelRatio")
            || three_constructor_name(
                member_expression.object(),
                &THREE_RENDERER_CONSTRUCTOR_NAMES,
                ctx,
            )
            .is_none()
        {
            return;
        }
        let Some(raw_pixel_ratio_span) = call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .and_then(|argument| resolve_raw_device_pixel_ratio(argument, ctx))
        else {
            return;
        };
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(raw_pixel_ratio_span));
    }
}
