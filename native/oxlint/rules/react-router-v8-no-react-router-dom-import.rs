use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "react-router-dom is removed in React Router v8.";

#[derive(Debug, Default, Clone)]
#[allow(non_camel_case_types)]
pub struct ReactRouter_v8NoReactRouterDomImport;

pub type ReactRouterV8NoReactRouterDomImport = ReactRouter_v8NoReactRouterDomImport;

declare_oxc_lint!(
    /// Disallow the removed React Router DOM package in React Router v8.
    ReactRouter_v8NoReactRouterDomImport,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow react-router-dom in React Router v8.",
);

impl Rule for ReactRouter_v8NoReactRouterDomImport {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let span = match node.kind() {
            AstKind::ImportDeclaration(declaration)
                if declaration.source.value == "react-router-dom" =>
            {
                Some(declaration.span)
            }
            AstKind::ExportFromDeclaration(declaration)
                if declaration.source.value == "react-router-dom" =>
            {
                Some(declaration.span)
            }
            AstKind::ExportAllDeclaration(declaration)
                if declaration.source.value == "react-router-dom" =>
            {
                Some(declaration.span)
            }
            AstKind::ImportExpression(import_expression)
                if matches!(
                    &import_expression.source,
                    oxc_ast::ast::Expression::StringLiteral(source)
                        if source.value == "react-router-dom"
                ) =>
            {
                Some(import_expression.span)
            }
            _ => None,
        };
        if let Some(span) = span {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(span));
        }
    }
}
