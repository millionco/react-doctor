use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const DEPRECATED_MODULES: [&str; 16] = [
    "AsyncStorage",
    "Picker",
    "PickerIOS",
    "DatePickerIOS",
    "DatePickerAndroid",
    "ProgressBarAndroid",
    "ProgressViewIOS",
    "SafeAreaView",
    "Slider",
    "ViewPagerAndroid",
    "WebView",
    "NetInfo",
    "CameraRoll",
    "Clipboard",
    "ImageEditor",
    "MaskedViewIOS",
];

#[derive(Debug, Default, Clone)]
pub struct RnNoDeprecatedModules;

declare_oxc_lint!(
    /// Disallow modules removed from React Native core.
    RnNoDeprecatedModules,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow modules removed from React Native core.",
);

impl Rule for RnNoDeprecatedModules {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
            return;
        };
        if import_declaration.source.value != "react-native" {
            return;
        }
        for_each_value_import(import_declaration, |import_specifier| {
            let imported_name = import_specifier.imported.name();
            if !DEPRECATED_MODULES.contains(&imported_name.as_str()) {
                return;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users hit a crash from \"{imported_name}\", which was removed from react-native."
                ))
                .with_label(import_specifier.span),
            );
        });
    }
}
