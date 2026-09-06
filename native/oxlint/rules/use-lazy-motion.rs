use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "Importing \"motion\" ships about 30 kb of extra code and slows page load. Use \"m\" with LazyMotion instead.";

#[derive(Debug, Default, Clone)]
pub struct UseLazyMotion;

declare_oxc_lint!(
    /// Prefer LazyMotion over the full Motion component bundle.
    UseLazyMotion,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer LazyMotion over the full Motion component bundle.",
);

impl Rule for UseLazyMotion {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
            return;
        };
        if !matches!(
            import_declaration.source.value.as_str(),
            "framer-motion" | "motion/react"
        ) {
            return;
        }
        let mut has_full_motion_import = false;
        for_each_value_import(import_declaration, |import_specifier| {
            if import_specifier.imported.name() == "motion" {
                has_full_motion_import = true;
            }
        });
        if has_full_motion_import {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(import_declaration.span));
        }
    }
}
