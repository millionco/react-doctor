use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "`React.Children` traversal depends on the runtime child shape, so wrapping or unwrapping a child can silently change what gets visited.";

#[derive(Debug, Default, Clone)]
pub struct NoReactChildren;

declare_oxc_lint!(
    /// Disallow traversal through React.Children.
    NoReactChildren,
    react_doctor_native,
    restriction,
    version = "0.1.0",
    short_description = "Disallow traversal through React.Children.",
);

impl Rule for NoReactChildren {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(member_expression) = call_expression.callee.get_member_expr() else {
            return;
        };
        let object = member_expression.object().get_inner_expression();

        if let Some(identifier) = object.get_identifier_reference()
            && identifier.name == "Children"
            && is_imported_from_react(identifier.name.as_str(), ctx)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(member_expression.span()));
            return;
        }

        if let Some(inner_member) = object.as_member_expression()
            && inner_member.static_property_name() == Some("Children")
            && let Some(identifier) = inner_member
                .object()
                .get_inner_expression()
                .get_identifier_reference()
            && is_imported_from_react(identifier.name.as_str(), ctx)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(member_expression.span()));
        }
    }
}

fn is_imported_from_react(local_name: &str, ctx: &LintContext) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        entry.module_request.name() == "react" && entry.local_name.name() == local_name
    })
}
