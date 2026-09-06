use oxc_ast::{
    ast::{BindingPattern, Expression, FormalParameter, FunctionType},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str = "The meta data field was removed in React Router v8; use loaderData.";
const REACT_ROUTER_RUNTIME_PACKAGE_NAMES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];

#[derive(Debug, Default, Clone)]
#[allow(non_camel_case_types)]
pub struct ReactRouter_v8NoMetaDataField;

pub type ReactRouterV8NoMetaDataField = ReactRouter_v8NoMetaDataField;

declare_oxc_lint!(
    /// Disallows the removed React Router v8 meta data field.
    ReactRouter_v8NoMetaDataField,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow the removed React Router v8 meta data field.",
);

impl Rule for ReactRouter_v8NoMetaDataField {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::Function(function) if function.r#type == FunctionType::FunctionDeclaration => {
                report_meta_function_data_properties(node, function.params.items.first(), ctx);
            }
            AstKind::Function(function) => {
                if matches!(
                    ctx.nodes().parent_node(node.id()).kind(),
                    AstKind::VariableDeclarator(_)
                ) {
                    report_meta_function_data_properties(node, function.params.items.first(), ctx);
                }
            }
            AstKind::ArrowFunctionExpression(function) => {
                if matches!(
                    ctx.nodes().parent_node(node.id()).kind(),
                    AstKind::VariableDeclarator(_)
                ) {
                    report_meta_function_data_properties(node, function.params.items.first(), ctx);
                }
            }
            AstKind::VariableDeclarator(declarator) => {
                report_use_matches_data_properties(declarator, ctx);
            }
            _ => {}
        }
    }
}

fn report_meta_function_data_properties(
    function_node: &AstNode<'_>,
    first_parameter: Option<&FormalParameter<'_>>,
    ctx: &LintContext<'_>,
) {
    if !has_capability(ctx, "react-router-framework")
        || !is_react_router_route_function(function_node, "meta", ctx)
    {
        return;
    }
    if let Some(first_parameter) = first_parameter {
        report_data_properties(&first_parameter.pattern, ctx);
    }
}

fn report_use_matches_data_properties<'a>(
    declarator: &oxc_ast::ast::VariableDeclarator<'a>,
    ctx: &LintContext<'a>,
) {
    let Some(Expression::CallExpression(use_matches_call)) = &declarator.init else {
        return;
    };
    let Expression::Identifier(use_matches_callee) = &use_matches_call.callee else {
        return;
    };
    if !direct_named_import_matches(
        use_matches_callee,
        &["useMatches"],
        &REACT_ROUTER_RUNTIME_PACKAGE_NAMES,
        ctx,
    ) {
        return;
    }
    if let BindingPattern::ArrayPattern(pattern) = &declarator.id {
        for element in pattern.elements.iter().flatten() {
            report_data_properties(element, ctx);
        }
    } else {
        report_data_properties(&declarator.id, ctx);
    }
}

fn report_data_properties(pattern: &BindingPattern<'_>, ctx: &LintContext<'_>) {
    let BindingPattern::ObjectPattern(pattern) = pattern else {
        return;
    };
    for property in &pattern.properties {
        if property.key.static_name().as_deref() == Some("data") {
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(property.span));
        }
    }
}
