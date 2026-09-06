use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::Span;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "`document.write()` blocks parsing, is ignored (or wipes the page) after load, and is flagged by browsers as a performance anti-pattern. Build DOM nodes or set `innerHTML`/`textContent` on a target element instead.";

fn no_document_write_diagnostic(span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(MESSAGE).with_label(span)
}

#[derive(Debug, Default, Clone)]
pub struct NoDocumentWrite;

declare_oxc_lint!(
    /// Disallow `document.write()` and `document.writeln()`.
    NoDocumentWrite,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow document.write and document.writeln.",
);

impl Rule for NoDocumentWrite {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(member_expression) = call_expression
            .callee
            .get_inner_expression()
            .get_member_expr()
        else {
            return;
        };
        if !matches!(
            member_expression.static_property_name(),
            Some("write" | "writeln")
        ) {
            return;
        }
        let Expression::Identifier(document_identifier) =
            member_expression.object().get_inner_expression()
        else {
            return;
        };
        if document_identifier.name != "document"
            || !ctx.is_reference_to_global_variable(document_identifier)
        {
            return;
        }
        ctx.diagnostic(no_document_write_diagnostic(call_expression.span));
    }
}
