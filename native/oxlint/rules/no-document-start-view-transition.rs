use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    module_record::ImportImportName,
    rule::Rule,
};

const MESSAGE: &str = "Calling `document.startViewTransition()` directly can bypass React's `<ViewTransition>` animation lifecycle.";
const REACT_VIEW_TRANSITION_EXPORT_NAMES: [&str; 2] = ["ViewTransition", "unstable_ViewTransition"];

#[derive(Debug, Default, Clone)]
pub struct NoDocumentStartViewTransition;

declare_oxc_lint!(
    /// Disallows direct View Transitions API calls in React ViewTransition files.
    NoDocumentStartViewTransition,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallows direct View Transitions API calls in React ViewTransition files.",
);

impl Rule for NoDocumentStartViewTransition {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        if !imports_react_view_transition(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                continue;
            };
            if member_expression.static_property_name() != Some("startViewTransition") {
                continue;
            }
            let Expression::Identifier(receiver) =
                member_expression.object().get_inner_expression()
            else {
                continue;
            };
            if receiver.name != "document"
                || ctx
                    .scoping()
                    .get_reference(receiver.reference_id())
                    .symbol_id()
                    .is_some()
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
        }
    }
}

fn imports_react_view_transition(ctx: &LintContext<'_>) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && entry.module_request.name() == "react"
            && matches!(
                &entry.import_name,
                ImportImportName::Name(imported_name)
                    if REACT_VIEW_TRANSITION_EXPORT_NAMES.contains(&imported_name.name())
            )
    })
}
