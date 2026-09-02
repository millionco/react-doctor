use oxc_ast::{ast::JSXElementName, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct NextjsGlobalErrorMissingHtmlBody;

declare_oxc_lint!(
    /// Require html and body elements in Next.js global error boundaries.
    NextjsGlobalErrorMissingHtmlBody,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require a complete document in global error boundaries.",
);

impl Rule for NextjsGlobalErrorMissingHtmlBody {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once(&self, ctx: &LintContext) {
        let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
        if !is_next_file_active(ctx)
            || !is_in_project_directory(ctx, "app")
            || !is_global_error_filename(&filename)
        {
            return;
        }
        let mut has_html = false;
        let mut has_body = false;
        for node in ctx.nodes() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let JSXElementName::Identifier(identifier) = &opening_element.name else {
                continue;
            };
            match identifier.name.as_str() {
                "html" => has_html = true,
                "body" => has_body = true,
                _ => {}
            }
            if has_html && has_body {
                return;
            }
        }
        let missing_tags = match (has_html, has_body) {
            (false, false) => "<html> and <body>",
            (false, true) => "<html>",
            (true, false) => "<body>",
            (true, true) => return,
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "global-error.tsx is missing {missing_tags}. The root layout unmounts on error, so this page renders broken HTML."
            ))
            .with_label(program_estree_span(ctx.nodes().program())),
        );
    }
}

fn is_global_error_filename(filename: &str) -> bool {
    let Some((path_without_extension, extension)) = filename.rsplit_once('.') else {
        return false;
    };
    matches!(extension, "ts" | "tsx" | "js" | "jsx" | "mts" | "mjs")
        && path_without_extension.ends_with("/global-error")
}
