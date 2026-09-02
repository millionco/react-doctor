use oxc_ast::{
    ast::{BindingPattern, Declaration, ModuleExportName, Statement},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str = "Default exports in route.ts are silently ignored. Next.js only recognizes named HTTP method exports (GET, POST, etc.).";
const HTTP_METHOD_NAMES: [&str; 7] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

#[derive(Debug, Default, Clone)]
pub struct NextjsNoDefaultExportInRouteHandler;

declare_oxc_lint!(
    /// Disallow default exports in Next.js App Router route handlers.
    NextjsNoDefaultExportInRouteHandler,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow default route-handler exports.",
);

impl Rule for NextjsNoDefaultExportInRouteHandler {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
        if !is_in_project_directory(ctx, "app")
            || !is_route_handler_filename(&filename)
            || !is_next_file_active(ctx)
            || program_has_named_http_method_export(ctx.nodes().program())
        {
            return;
        }
        let report_span = match node.kind() {
            AstKind::ExportDefaultDeclaration(declaration) => Some(declaration.span),
            AstKind::ExportNamedDeclaration(declaration)
                if declaration
                    .specifiers
                    .iter()
                    .any(|specifier| match &specifier.exported {
                        ModuleExportName::IdentifierName(identifier) => {
                            identifier.name == "default"
                        }
                        ModuleExportName::IdentifierReference(identifier) => {
                            identifier.name == "default"
                        }
                        ModuleExportName::StringLiteral(_) => false,
                    }) =>
            {
                Some(declaration.span)
            }
            _ => None,
        };
        if let Some(span) = report_span {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(span));
        }
    }
}

fn is_route_handler_filename(filename: &str) -> bool {
    let Some((path_without_extension, extension)) = filename.rsplit_once('.') else {
        return false;
    };
    matches!(extension, "ts" | "tsx" | "js" | "jsx" | "mts" | "mjs")
        && path_without_extension.ends_with("/route")
}

fn program_has_named_http_method_export(program: &oxc_ast::ast::Program) -> bool {
    program.body.iter().any(|statement| match statement {
        Statement::ExportDeclaration(export_declaration) => match &export_declaration.declaration {
            Declaration::FunctionDeclaration(function) => function
                .id
                .as_ref()
                .is_some_and(|identifier| is_http_method_name(identifier.name.as_str())),
            Declaration::VariableDeclaration(variable_declaration) => variable_declaration
                .declarations
                .iter()
                .any(|declarator| {
                    matches!(&declarator.id, BindingPattern::BindingIdentifier(identifier) if is_http_method_name(identifier.name.as_str()))
                }),
            _ => false,
        },
        Statement::ExportNamedDeclaration(export_declaration) => export_declaration
            .specifiers
            .iter()
            .any(|specifier| match &specifier.exported {
                ModuleExportName::IdentifierName(identifier) => {
                    is_http_method_name(identifier.name.as_str())
                }
                ModuleExportName::IdentifierReference(identifier) => {
                    is_http_method_name(identifier.name.as_str())
                }
                ModuleExportName::StringLiteral(_) => false,
            }),
        _ => false,
    })
}

fn is_http_method_name(name: &str) -> bool {
    HTTP_METHOD_NAMES.contains(&name)
}
