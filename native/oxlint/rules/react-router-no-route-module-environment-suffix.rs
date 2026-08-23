use oxc_ast::{
    ast::{ModuleExportName, Statement},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str =
    "A Framework route module must participate in both client and server module graphs.";

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoRouteModuleEnvironmentSuffix;

declare_oxc_lint!(
    /// Disallow environment suffixes on React Router route modules.
    ReactRouterNoRouteModuleEnvironmentSuffix,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow environment suffixes on React Router route modules.",
);

impl Rule for ReactRouterNoRouteModuleEnvironmentSuffix {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        is_react_router_file_active(ctx) && is_react_router_framework_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::Program(program) = node.kind() else {
            return;
        };
        let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
        if is_environment_suffixed_route_module(&filename)
            && program_has_default_export(program, ctx)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(program_estree_span(program)));
        }
    }
}

fn is_environment_suffixed_route_module(filename: &str) -> bool {
    let route_path = filename.strip_prefix("routes/").or_else(|| {
        filename
            .split_once("/routes/")
            .map(|(_, route_path)| route_path)
    });
    let Some(route_path) = route_path else {
        return false;
    };
    if route_path.contains('/') {
        return false;
    }
    [
        ".client.js",
        ".client.jsx",
        ".client.ts",
        ".client.tsx",
        ".client.cjs",
        ".client.cjsx",
        ".client.cts",
        ".client.ctsx",
        ".client.mjs",
        ".client.mjsx",
        ".client.mts",
        ".client.mtsx",
        ".server.js",
        ".server.jsx",
        ".server.ts",
        ".server.tsx",
        ".server.cjs",
        ".server.cjsx",
        ".server.cts",
        ".server.ctsx",
        ".server.mjs",
        ".server.mjsx",
        ".server.mts",
        ".server.mtsx",
    ]
    .iter()
    .any(|suffix| route_path.ends_with(suffix))
}

fn program_has_default_export(program: &oxc_ast::ast::Program, ctx: &LintContext) -> bool {
    program.body.iter().any(|statement| match statement {
        Statement::ExportDefaultDeclaration(_) => true,
        Statement::ExportNamedDeclaration(declaration) => {
            declaration.specifiers.iter().any(|specifier| {
                module_export_name_matches(&specifier.exported, "default")
                    && match &specifier.local {
                        ModuleExportName::IdentifierName(identifier) => {
                            ctx.scoping().get_root_binding(identifier.name).is_some()
                        }
                        ModuleExportName::IdentifierReference(identifier) => ctx
                            .scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                            .is_some(),
                        ModuleExportName::StringLiteral(_) => false,
                    }
            })
        }
        _ => false,
    })
}

fn module_export_name_matches(name: &ModuleExportName, expected_name: &str) -> bool {
    match name {
        ModuleExportName::IdentifierName(identifier) => identifier.name == expected_name,
        ModuleExportName::IdentifierReference(identifier) => identifier.name == expected_name,
        ModuleExportName::StringLiteral(value) => value.value == expected_name,
    }
}
