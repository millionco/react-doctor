use oxc_ast::{
    ast::{BindingPattern, Declaration, Expression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str = "Edge runtime limits OG image generation. Node.js runtime supports more fonts, filesystem access, and larger response sizes.";

#[derive(Debug, Default, Clone)]
pub struct NextjsNoEdgeOgRuntime;

declare_oxc_lint!(
    /// Disallow the Edge runtime in Next.js social image routes.
    NextjsNoEdgeOgRuntime,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow the Edge runtime in social image routes.",
);

impl Rule for NextjsNoEdgeOgRuntime {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ExportDeclaration(export_declaration) = node.kind() else {
            return;
        };
        let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
        if !is_og_image_filename(&filename) || !is_next_file_active(ctx) {
            return;
        }
        let Declaration::VariableDeclaration(variable_declaration) =
            &export_declaration.declaration
        else {
            return;
        };
        let has_edge_runtime = variable_declaration.declarations.iter().any(|declarator| {
            matches!(&declarator.id, BindingPattern::BindingIdentifier(identifier) if identifier.name == "runtime")
                && matches!(&declarator.init, Some(Expression::StringLiteral(value)) if value.value == "edge")
        });
        if has_edge_runtime {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(export_declaration.span));
        }
    }
}

fn is_og_image_filename(filename: &str) -> bool {
    let Some(file_name) = filename.rsplit('/').next() else {
        return false;
    };
    let Some((stem, extension)) = file_name.rsplit_once('.') else {
        return false;
    };
    if !matches!(extension, "ts" | "tsx" | "js" | "jsx" | "mts" | "mjs") {
        return false;
    }
    ["opengraph-image", "twitter-image"].iter().any(|prefix| {
        stem.strip_prefix(prefix)
            .is_some_and(|suffix| suffix.chars().all(|character| character.is_ascii_digit()))
    })
}
