use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "Your app breaks in React 19 because `ReactDOM.render` returns nothing there.";

#[derive(Debug, Default, Clone)]
pub struct NoRenderReturnValue;

declare_oxc_lint!(
    /// Disallow using the return value of `ReactDOM.render()`.
    NoRenderReturnValue,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow using the ReactDOM.render return value.",
);

impl Rule for NoRenderReturnValue {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Expression::StaticMemberExpression(member_expression) =
            call_expression.callee.get_inner_expression()
        else {
            return;
        };
        let Expression::Identifier(receiver) = member_expression.object.get_inner_expression()
        else {
            return;
        };
        if receiver.name != "ReactDOM" || member_expression.property.name != "render" {
            return;
        }
        let parent = ctx.nodes().parent_node(node.id());
        if !matches!(
            parent.kind(),
            AstKind::VariableDeclarator(_)
                | AstKind::ObjectProperty(_)
                | AstKind::ReturnStatement(_)
                | AstKind::AssignmentExpression(_)
                | AstKind::ArrowFunctionExpression(_)
        ) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.callee.span()));
    }
}
