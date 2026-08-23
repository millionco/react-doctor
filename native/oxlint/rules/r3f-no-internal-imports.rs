use oxc_ast::{AstKind, ast::TSModuleReference};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::Span;

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

#[derive(Debug, Default, Clone)]
pub struct R3FNoInternalImports;

impl RuleMeta for R3FNoInternalImports {
    const NAME: &'static str = "r3f-no-internal-imports";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow imports from private React Three Fiber paths.",
    };
}

impl Rule for R3FNoInternalImports {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let source_and_span = match node.kind() {
            AstKind::ImportDeclaration(declaration) => {
                Some((declaration.source.value.as_str(), declaration.source.span))
            }
            AstKind::ExportFromDeclaration(declaration) => {
                Some((declaration.source.value.as_str(), declaration.source.span))
            }
            AstKind::ExportAllDeclaration(declaration) => {
                Some((declaration.source.value.as_str(), declaration.source.span))
            }
            AstKind::ImportExpression(import_expression) => {
                let oxc_ast::ast::Expression::StringLiteral(source) = &import_expression.source
                else {
                    return;
                };
                Some((source.value.as_str(), source.span))
            }
            AstKind::TSImportEqualsDeclaration(declaration) => {
                let TSModuleReference::ExternalModuleReference(reference) =
                    &declaration.module_reference
                else {
                    return;
                };
                Some((reference.expression.value.as_str(), declaration.span))
            }
            AstKind::CallExpression(call_expression) => call_expression
                .common_js_require()
                .map(|source| (source.value.as_str(), source.span)),
            _ => None,
        };
        let Some((source, span)) = source_and_span else {
            return;
        };
        report_private_r3f_source(source, span, ctx);
    }
}

fn report_private_r3f_source(source: &str, span: Span, ctx: &LintContext<'_>) {
    if !source.starts_with("@react-three/fiber/dist/")
        && !source.starts_with("@react-three/fiber/src/")
    {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "Importing {source} couples this code to private package layout that can change between releases. Use a documented public entry point"
        ))
        .with_label(span),
    );
}
