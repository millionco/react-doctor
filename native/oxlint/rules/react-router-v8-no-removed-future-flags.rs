use oxc_ast::{
    ast::{
        BindingPattern, Declaration, Expression, ObjectExpression, ObjectPropertyKind, Program,
        Statement,
    },
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const REMOVED_FUTURE_FLAG_NAMES: [&str; 6] = [
    "unstable_previewServerPrerendering",
    "v8_middleware",
    "v8_passThroughRequests",
    "v8_splitRouteModules",
    "v8_trailingSlashAwareDataRequests",
    "v8_viteEnvironmentApi",
];

#[derive(Debug, Default, Clone)]
#[allow(non_camel_case_types)]
pub struct ReactRouter_v8NoRemovedFutureFlags;

pub type ReactRouterV8NoRemovedFutureFlags = ReactRouter_v8NoRemovedFutureFlags;

declare_oxc_lint!(
    /// Disallow React Router future flags removed in v8.
    ReactRouter_v8NoRemovedFutureFlags,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow removed React Router v8 future flags.",
);

impl Rule for ReactRouter_v8NoRemovedFutureFlags {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        is_react_router_file_active(ctx) && is_react_router_framework_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::Program(program) = node.kind() else {
            return;
        };
        if !is_react_router_config_filename(&ctx.file_path().to_string_lossy()) {
            return;
        }
        let Some(config) = find_default_exported_object_expression(program) else {
            return;
        };
        let Some(future_property) = get_static_route_property(config, "future") else {
            return;
        };
        let Expression::ObjectExpression(future_options) =
            future_property.value.get_inner_expression()
        else {
            return;
        };
        for property in &future_options.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            let Some(property_name) = property.key.static_name() else {
                continue;
            };
            if !REMOVED_FUTURE_FLAG_NAMES.contains(&property_name.as_ref()) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "future.{property_name} is removed in React Router v8."
                ))
                .with_label(property.span),
            );
        }
    }
}

fn is_react_router_config_filename(filename: &str) -> bool {
    let filename = filename.replace('\\', "/");
    [
        "react-router.config.js",
        "react-router.config.ts",
        "react-router.config.cjs",
        "react-router.config.cts",
        "react-router.config.mjs",
        "react-router.config.mts",
    ]
    .iter()
    .any(|config_filename| {
        filename == *config_filename || filename.ends_with(&format!("/{config_filename}"))
    })
}

fn find_default_exported_object_expression<'a>(
    program: &'a Program<'a>,
) -> Option<&'a ObjectExpression<'a>> {
    let exported_expression = program.body.iter().find_map(|statement| {
        let Statement::ExportDefaultDeclaration(declaration) = statement else {
            return None;
        };
        declaration.declaration.as_expression()
    })?;
    match exported_expression.get_inner_expression() {
        Expression::ObjectExpression(object_expression) => Some(object_expression),
        Expression::Identifier(identifier) => {
            find_top_level_object_binding(program, identifier.name.as_str())
        }
        _ => None,
    }
}

fn find_top_level_object_binding<'a>(
    program: &'a Program<'a>,
    binding_name: &str,
) -> Option<&'a ObjectExpression<'a>> {
    program.body.iter().find_map(|statement| {
        let variable_declaration = match statement {
            Statement::VariableDeclaration(declaration) => Some(declaration.as_ref()),
            Statement::ExportDeclaration(declaration) => match &declaration.declaration {
                Declaration::VariableDeclaration(variable_declaration) => {
                    Some(variable_declaration.as_ref())
                }
                _ => None,
            },
            _ => None,
        }?;
        variable_declaration
            .declarations
            .iter()
            .find_map(|declarator| {
                let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                    return None;
                };
                if identifier.name != binding_name {
                    return None;
                }
                match declarator.init.as_ref()?.get_inner_expression() {
                    Expression::ObjectExpression(object_expression) => {
                        Some(object_expression.as_ref())
                    }
                    _ => None,
                }
            })
    })
}
