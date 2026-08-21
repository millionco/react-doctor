use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct RnPreferReanimated;

declare_oxc_lint!(
    /// Prefer Reanimated over React Native JS-thread animation APIs.
    RnPreferReanimated,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer Reanimated over JS-thread animation APIs.",
);

impl Rule for RnPreferReanimated {
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
            let message = match imported_name.as_str() {
                "LayoutAnimation" => {
                    "Your users see stutter when LayoutAnimation runs on the JS thread."
                }
                "Animated" => {
                    "Your users see stutter when Animated from react-native runs on the JS thread."
                }
                _ => return,
            };
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(import_specifier.span));
        });
    }
}
