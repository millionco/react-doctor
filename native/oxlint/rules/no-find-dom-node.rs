use oxc_ast::{
    AstKind,
    ast::{Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "`findDOMNode` crashes your app in React 19 because it was removed.";

#[derive(Debug, Default, Clone)]
pub struct NoFindDomNode;

declare_oxc_lint!(
    /// Disallow calls to the removed ReactDOM.findDOMNode API.
    NoFindDomNode,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow calls to the removed ReactDOM.findDOMNode API.",
);

impl Rule for NoFindDomNode {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if let Expression::Identifier(identifier) = &call_expression.callee {
            if identifier.name == "findDOMNode"
                && ctx.module_record().import_entries.iter().any(|entry| {
                    entry.module_request.name() == "react-dom"
                        && entry.local_name.name() == identifier.name
                })
            {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(identifier.span));
            }
            return;
        }
        let Some(member_expression) = call_expression.callee.as_member_expression() else {
            return;
        };
        let Expression::Identifier(receiver) = member_expression.object() else {
            return;
        };
        if !matches!(receiver.name.as_str(), "React" | "ReactDOM" | "ReactDom") {
            return;
        }
        let property = match member_expression {
            MemberExpression::StaticMemberExpression(member_expression) => Some((
                member_expression.property.name.as_str(),
                member_expression.property.span,
            )),
            MemberExpression::ComputedMemberExpression(member_expression) => {
                let Expression::Identifier(identifier) = &member_expression.expression else {
                    return;
                };
                Some((identifier.name.as_str(), identifier.span))
            }
            MemberExpression::PrivateFieldExpression(_) => None,
        };
        let Some((property_name, property_span)) = property else {
            return;
        };
        if property_name == "findDOMNode" {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(property_span));
        }
    }
}
