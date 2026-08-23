use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str = "This error boundary silently does nothing without 'use client'. Next.js requires error.tsx to be a Client Component.";
const SOURCE_FILE_EXTENSIONS: [&str; 6] = ["ts", "tsx", "js", "jsx", "mts", "mjs"];

#[derive(Debug, Default, Clone)]
pub struct NextjsErrorBoundaryMissingUseClient;

declare_oxc_lint!(
    /// Require use client in Next.js App Router error boundaries.
    NextjsErrorBoundaryMissingUseClient,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require use client in App Router error boundaries.",
);

impl Rule for NextjsErrorBoundaryMissingUseClient {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::Program(program) = node.kind() else {
            return;
        };
        let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
        if !is_in_project_directory(ctx, "app")
            || !is_next_file_active(ctx)
            || !is_error_boundary_filename(&filename)
            || program
                .directives
                .iter()
                .any(|directive| directive.directive == "use client")
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(program_estree_span(program)));
    }
}

fn program_estree_span(program: &oxc_ast::ast::Program) -> Span {
    let start = program
        .directives
        .first()
        .map(GetSpan::span)
        .or_else(|| program.body.first().map(GetSpan::span))
        .map_or(0, |first_span| first_span.start);
    Span::new(start, program.span.end)
}

fn is_error_boundary_filename(filename: &str) -> bool {
    let Some((path_without_extension, extension)) = filename.rsplit_once('.') else {
        return false;
    };
    SOURCE_FILE_EXTENSIONS.contains(&extension)
        && (path_without_extension.ends_with("/error")
            || path_without_extension.ends_with("/global-error"))
}
