use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str =
    "Dynamically importing a server-functions file leaks server code into the client bundle.";
const SERVER_FUNCTION_FILE_SUFFIXES: [&str; 5] = [
    ".functions",
    ".functions.js",
    ".functions.jsx",
    ".functions.ts",
    ".functions.tsx",
];

#[derive(Debug, Default, Clone)]
pub struct TanstackStartNoDynamicServerFnImport;

declare_oxc_lint!(
    /// Disallow dynamic imports of TanStack Start server-function modules.
    TanstackStartNoDynamicServerFnImport,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow dynamic server-function imports.",
);

impl Rule for TanstackStartNoDynamicServerFnImport {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportExpression(import_expression) = node.kind() else {
            return;
        };
        let import_path = match &import_expression.source {
            Expression::StringLiteral(string_literal) => string_literal.value.as_str(),
            Expression::TemplateLiteral(template_literal) if template_literal.quasis.len() == 1 => {
                template_literal.quasis[0].value.raw.as_str()
            }
            _ => return,
        };
        if !SERVER_FUNCTION_FILE_SUFFIXES
            .iter()
            .any(|suffix| import_path.ends_with(suffix))
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(import_expression.span));
    }
}
