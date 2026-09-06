use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const LEGACY_EXPO_PACKAGES: [&str; 4] = [
    "expo-av",
    "expo-permissions",
    "expo-app-loading",
    "react-native-fast-image",
];

#[derive(Debug, Default, Clone)]
pub struct RnNoLegacyExpoPackages;

declare_oxc_lint!(
    /// Disallow unmaintained legacy Expo packages.
    RnNoLegacyExpoPackages,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow unmaintained legacy Expo packages.",
);

impl Rule for RnNoLegacyExpoPackages {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
            return;
        };
        if is_type_only_import(import_declaration) {
            return;
        }
        let source = import_declaration.source.value.as_str();
        let Some(package_name) = LEGACY_EXPO_PACKAGES.iter().find(|package_name| {
            source == **package_name
                || source
                    .strip_prefix(**package_name)
                    .is_some_and(|suffix| suffix.starts_with('/'))
        }) else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users are exposed to unfixed bugs when \"{package_name}\" is no longer maintained."
            ))
            .with_label(import_declaration.span),
        );
    }
}
