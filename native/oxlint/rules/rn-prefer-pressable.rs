use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const TOUCHABLE_COMPONENTS: [&str; 4] = [
    "TouchableOpacity",
    "TouchableHighlight",
    "TouchableWithoutFeedback",
    "TouchableNativeFeedback",
];

#[derive(Debug, Default, Clone)]
pub struct RnPreferPressable;

declare_oxc_lint!(
    /// Prefer Pressable over frozen Touchable components.
    RnPreferPressable,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prefer Pressable over frozen Touchable components.",
);

impl Rule for RnPreferPressable {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
            return;
        };
        if !matches!(
            import_declaration.source.value.as_str(),
            "react-native" | "react-native-gesture-handler"
        ) {
            return;
        }
        for_each_value_import(import_declaration, |import_specifier| {
            let imported_name = import_specifier.imported.name();
            if !TOUCHABLE_COMPONENTS.contains(&imported_name.as_str()) {
                return;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users miss <Pressable>'s flexible press feedback when you use {imported_name}, which is old & frozen."
                ))
                .with_label(import_specifier.span),
            );
        });
    }
}
