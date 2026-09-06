use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "PanResponder runs gesture handling on the JS thread, which stutters under load. Use react-native-gesture-handler (`Gesture.Pan()`) so gestures run on the native UI thread.";

#[derive(Debug, Default, Clone)]
pub struct RnNoPanresponder;

declare_oxc_lint!(
    /// Prefer native-thread gesture handling over PanResponder.
    RnNoPanresponder,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer native-thread gesture handling over PanResponder.",
);

impl Rule for RnNoPanresponder {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
            return;
        };
        if import_declaration.source.value != "react-native" {
            return;
        }
        for_each_value_import(import_declaration, |import_specifier| {
            if import_specifier.imported.name() == "PanResponder" {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(import_specifier.span));
            }
        });
    }
}
