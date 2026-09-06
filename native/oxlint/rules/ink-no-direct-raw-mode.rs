use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "Changing terminal raw mode during render is an untracked side effect.";

#[derive(Debug, Default, Clone)]
pub struct InkNoDirectRawMode;

declare_oxc_lint!(
    /// Disallow changing Ink terminal raw mode during React render.
    InkNoDirectRawMode,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow Ink raw-mode changes during render.",
);

impl Rule for InkNoDirectRawMode {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !is_ink_set_raw_mode_call(call_expression, ctx)
            || !is_render_phase_component_or_hook(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
    }
}

fn is_ink_set_raw_mode_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if let Some(member_expression) = call_expression.callee.as_member_expression() {
        if member_expression.static_property_name() != Some("setRawMode") {
            return false;
        }
        let stdin_object = member_expression.object().get_inner_expression();
        return is_use_stdin_call(stdin_object, ctx)
            || matches!(
                stdin_object,
                Expression::Identifier(identifier)
                    if identifier_initializer(identifier, ctx)
                        .is_some_and(|initializer| is_use_stdin_call(initializer, ctx))
            );
    }
    let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression() else {
        return false;
    };
    identifier.name == "setRawMode"
        && identifier_initializer(identifier, ctx)
            .is_some_and(|initializer| is_use_stdin_call(initializer, ctx))
}

fn is_use_stdin_call<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let Expression::CallExpression(call_expression) = expression.get_inner_expression() else {
        return false;
    };
    imported_module_api_matches(&call_expression.callee, "useStdin", "ink", ctx)
}
