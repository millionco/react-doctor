use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "`process.exit()` in an Ink input handler bypasses Ink's terminal cleanup.";

#[derive(Debug, Default, Clone)]
pub struct InkNoBareProcessExit;

declare_oxc_lint!(
    /// Require Ink input handlers to exit through Ink's application API.
    InkNoBareProcessExit,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow bare process exits in Ink input handlers.",
);

impl Rule for InkNoBareProcessExit {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(member_expression) = call_expression.callee.as_member_expression() else {
            return;
        };
        if member_expression.static_property_name() != Some("exit")
            || !is_proven_global_namespace_reference(member_expression.object(), "process", ctx)
        {
            return;
        }
        let Some(handler_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        let handler_parent = ctx.nodes().parent_node(handler_function.id());
        let AstKind::CallExpression(use_input_call) = handler_parent.kind() else {
            return;
        };
        if !use_input_call.arguments.first().is_some_and(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == handler_function.span())
        }) || !imported_module_api_matches(&use_input_call.callee, "useInput", "ink", ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
    }
}
