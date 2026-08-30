use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const HEAVY_LIBRARY_NAMES: [&str; 12] = [
    "@monaco-editor/react",
    "monaco-editor",
    "recharts",
    "@react-pdf/renderer",
    "react-quill",
    "@codemirror/view",
    "@codemirror/state",
    "chart.js",
    "react-chartjs-2",
    "@toast-ui/editor",
    "draft-js",
    "mermaid",
];

#[derive(Debug, Default, Clone)]
pub struct PreferDynamicImport;

declare_oxc_lint!(
    /// Prefer loading heavy libraries on demand.
    PreferDynamicImport,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer loading heavy libraries on demand.",
);

impl Rule for PreferDynamicImport {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportDeclaration(declaration) = node.kind() else {
            return;
        };
        if is_published_library_package(ctx.file_path())
            || declaration.import_kind.is_type()
            || !HEAVY_LIBRARY_NAMES.contains(&declaration.source.value.as_str())
            || is_import_absent_from_client_bundle(declaration, ctx)
        {
            return;
        }
        let source = declaration.source.value.as_str();
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "\"{source}\" ships extra code to your users up front & slows page load. Load it on demand with React.lazy() or next/dynamic."
            ))
            .with_label(declaration.span),
        );
    }
}
