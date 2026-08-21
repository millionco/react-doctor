use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const JS_BOTTOM_SHEET_PACKAGES: [&str; 7] = [
    "react-native-bottom-sheet",
    "react-native-modal-bottom-sheet",
    "react-native-raw-bottom-sheet",
    "react-native-modalize",
    "react-native-actions-sheet",
    "react-native-bottomsheet-reanimated",
    "@discord/bottom-sheet",
];

#[derive(Debug, Default, Clone)]
pub struct RnBottomSheetPreferNative;

declare_oxc_lint!(
    /// Prefer native bottom-sheet presentation where it fits the design.
    RnBottomSheetPreferNative,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer native bottom-sheet presentation.",
);

impl Rule for RnBottomSheetPreferNative {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
            return;
        };
        if is_type_only_import(import_declaration) {
            return;
        }
        let source = import_declaration.source.value.as_str();
        if !JS_BOTTOM_SHEET_PACKAGES.contains(&source) {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Users get JS-driven sheet gestures and presentation with {source}, instead of the platform-native formSheet behavior."
            ))
            .with_label(import_declaration.span),
        );
    }
}
