use oxc_ast::{AstKind, ast::ImportDeclarationSpecifier};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str = "React 19 removed createFactory. Use JSX or createElement instead.";
const REACT_MODULE_SOURCES: [&str; 1] = ["react"];

#[derive(Debug, Default, Clone)]
pub struct NoReact19DeprecatedApis;

declare_oxc_lint!(
    /// Disallow React APIs removed in React 19.
    NoReact19DeprecatedApis,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow React APIs removed in React 19.",
);

impl Rule for NoReact19DeprecatedApis {
    fn run_once(&self, ctx: &LintContext<'_>) {
        for node in ctx.nodes().iter() {
            let diagnostic_span = match node.kind() {
                AstKind::ImportDeclaration(import_declaration)
                    if import_declaration.source.value == "react"
                        && !import_declaration.import_kind.is_type() =>
                {
                    import_declaration
                        .specifiers
                        .iter()
                        .flatten()
                        .find_map(|specifier| {
                            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier
                            else {
                                return None;
                            };
                            (specifier.imported.name() == "createFactory"
                                && !specifier.import_kind.is_type())
                            .then_some(specifier.span)
                        })
                }
                AstKind::StaticMemberExpression(member_expression)
                    if member_expression.property.name == "createFactory"
                        && module_api_path_matches(
                            &member_expression.object,
                            &[],
                            &REACT_MODULE_SOURCES,
                            true,
                            ctx,
                        ) =>
                {
                    Some(member_expression.span)
                }
                _ => None,
            };
            let Some(diagnostic_span) = diagnostic_span else {
                continue;
            };
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(diagnostic_span));
            return;
        }
    }
}
