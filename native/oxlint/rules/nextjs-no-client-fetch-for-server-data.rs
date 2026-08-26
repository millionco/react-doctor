use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const FETCH_CALLEE_NAMES: [&str; 5] = ["fetch", "ky", "got", "wretch", "ofetch"];
const FETCH_MEMBER_OBJECT_NAMES: [&str; 6] = ["axios", "ky", "got", "ofetch", "wretch", "request"];
const SOURCE_FILE_EXTENSIONS: [&str; 6] = ["ts", "tsx", "js", "jsx", "mts", "mjs"];

#[derive(Debug, Default, Clone)]
pub struct NextjsNoClientFetchForServerData;

declare_oxc_lint!(
    /// Disallow client-side effect fetching in Next.js pages and layouts.
    NextjsNoClientFetchForServerData,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow client-side effect fetching in Next.js pages and layouts.",
);

impl Rule for NextjsNoClientFetchForServerData {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
        if !is_page_or_layout_filename(&filename) && !is_in_project_directory(ctx, "pages") {
            return;
        }
        let has_use_client_directive = ctx.nodes().iter().any(|node| {
            matches!(
                node.kind(),
                AstKind::Program(program)
                    if program
                        .directives
                        .iter()
                        .any(|directive| directive.directive == "use client")
            )
        });
        if !has_use_client_directive {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let callee_name = match &call_expression.callee {
                Expression::Identifier(identifier) => Some(identifier.name.as_str()),
                expression => expression
                    .as_member_expression()
                    .and_then(member_expression_identifier_property_name),
            };
            if !callee_name.is_some_and(|name| EFFECT_HOOK_NAMES.contains(&name)) {
                continue;
            }
            let Some(callback) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            if !matches!(
                callback,
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            ) || !effect_execution_contains_fetch_call(
                callback,
                ctx,
                &FETCH_CALLEE_NAMES,
                &FETCH_MEMBER_OBJECT_NAMES,
            ) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(
                    "useEffect + fetch in a page/layout makes your users wait through an extra round trip & loading spinner.",
                )
                .with_label(call_expression.span),
            );
        }
    }
}

fn is_page_or_layout_filename(filename: &str) -> bool {
    let Some((path_without_extension, extension)) = filename.rsplit_once('.') else {
        return false;
    };
    SOURCE_FILE_EXTENSIONS.contains(&extension)
        && (path_without_extension.ends_with("/page")
            || path_without_extension.ends_with("/layout"))
}
