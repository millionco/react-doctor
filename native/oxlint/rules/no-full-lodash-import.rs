use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Importing all of lodash ships the whole library to your users & slows page load. Import from 'lodash/functionName' instead.";

#[derive(Debug, Default, Clone)]
pub struct NoFullLodashImport;

declare_oxc_lint!(
    /// Disallow imports from the full legacy lodash bundle.
    NoFullLodashImport,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow imports from the full legacy lodash bundle.",
);

impl Rule for NoFullLodashImport {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportDeclaration(declaration) = node.kind() else {
            return;
        };
        if declaration.source.value != "lodash"
            || declaration.import_kind.is_type()
            || is_import_absent_from_client_bundle(declaration, ctx)
            || is_outside_browser_bundle(ctx)
            || lodash_is_library_dev_page(ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(declaration.span));
    }
}

fn lodash_is_library_dev_page(ctx: &LintContext<'_>) -> bool {
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    filename
        .rsplit('/')
        .next()
        .is_some_and(|basename| basename.contains(".page."))
        && is_published_library_package(ctx.file_path())
}
