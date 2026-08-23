use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "URL.createObjectURL() creates a disposable browser resource during render. Move it to an effect or event and call URL.revokeObjectURL() during cleanup.";

#[derive(Debug, Default, Clone)]
pub struct NoCreateObjectUrlInRender;

declare_oxc_lint!(
    /// Disallow creating object URLs during render.
    NoCreateObjectUrlInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow creating object URLs during render.",
);

impl Rule for NoCreateObjectUrlInRender {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(member_expression) = call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()
        else {
            return;
        };
        let Expression::Identifier(identifier) = member_expression.object().get_inner_expression()
        else {
            return;
        };
        if identifier.name == "URL"
            && ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_none()
            && member_expression.static_property_name() == Some("createObjectURL")
            && is_render_phase_component_or_hook(node, ctx)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
        }
    }
}
