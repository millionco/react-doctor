use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str =
    "next/head silently does nothing in the App Router, so your meta tags never render.";

#[derive(Debug, Default, Clone)]
pub struct NextjsNoHeadImport;

declare_oxc_lint!(
    /// Disallow next/head imports in Next.js App Router files.
    NextjsNoHeadImport,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow next/head imports in the App Router.",
);

impl Rule for NextjsNoHeadImport {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
            return;
        };
        if import_declaration.source.value != "next/head"
            || !is_in_project_directory(ctx, "app")
            || !is_next_file_active(ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(import_declaration.span));
    }
}
