use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "moment.js ships 300 kb+ to your users & slows page load. Use \"date-fns\" or \"dayjs\" instead.";

#[derive(Debug, Default, Clone)]
pub struct NoMoment;

declare_oxc_lint!(
    /// Disallow runtime imports of moment.js.
    NoMoment,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow runtime imports of moment.js.",
);

impl Rule for NoMoment {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
            return;
        };
        if import_declaration.source.value == "moment" && !is_type_only_import(import_declaration) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(import_declaration.span));
        }
    }
}
