use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "@vercel/og is bundled into Next.js. Import from \"next/og\" instead to avoid duplicate code and version mismatch.";

#[derive(Debug, Default, Clone)]
pub struct NextjsNoVercelOgImport;

declare_oxc_lint!(
    /// Prefer the Next.js entry point for Vercel OG.
    NextjsNoVercelOgImport,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer next/og over @vercel/og.",
);

impl Rule for NextjsNoVercelOgImport {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
            return;
        };
        if import_declaration.source.value == "@vercel/og" {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(import_declaration.span));
        }
    }
}
