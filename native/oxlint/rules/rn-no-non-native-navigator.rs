use oxc_ast::{ast::ImportDeclarationSpecifier, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const NON_NATIVE_NAVIGATOR_PACKAGES: [&str; 2] =
    ["@react-navigation/stack", "@react-navigation/drawer"];

#[derive(Debug, Default, Clone)]
pub struct RnNoNonNativeNavigator;

declare_oxc_lint!(
    /// Disallow JavaScript-driven React Native navigators.
    RnNoNonNativeNavigator,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow JavaScript-driven React Native navigators.",
);

impl Rule for RnNoNonNativeNavigator {
    fn should_run(&self, ctx: &ContextHost) -> bool {
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
        if !NON_NATIVE_NAVIGATOR_PACKAGES.contains(&source) {
            return;
        }
        let binds_navigator_factory =
            import_declaration
                .specifiers
                .iter()
                .flatten()
                .any(|specifier| match specifier {
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(_)
                    | ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => true,
                    ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                        specifier.import_kind.is_value()
                            && is_navigator_factory_name(specifier.imported.name().as_str())
                    }
                });
        if !binds_navigator_factory {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Users get JS-driven transitions and gestures from {source}, instead of platform-native navigation behavior."
            ))
            .with_label(import_declaration.span),
        );
    }
}

fn is_navigator_factory_name(name: &str) -> bool {
    name.strip_prefix("create")
        .and_then(|suffix| suffix.strip_suffix("Navigator"))
        .is_some_and(|middle| {
            middle
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
        })
}
