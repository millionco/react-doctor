use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "The root element returned by `<Static>` needs a `key`.";

#[derive(Debug, Default, Clone)]
pub struct InkStaticRequiresKey;

declare_oxc_lint!(
    /// Require keys on item roots returned by Ink Static components.
    InkStaticRequiresKey,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require keys on Ink Static item roots.",
);

impl Rule for InkStaticRequiresKey {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(static_element) = node.kind() else {
            return;
        };
        if resolve_imported_jsx_component_name(&static_element.opening_element, "ink", ctx)
            != Some("Static")
        {
            return;
        }
        for child in &static_element.children {
            let oxc_ast::ast::JSXChild::ExpressionContainer(container) = child else {
                continue;
            };
            let Some(render_function) = container.expression.as_expression() else {
                continue;
            };
            report_missing_static_item_keys(render_function, ctx);
        }
    }
}

fn report_missing_static_item_keys<'a>(render_function: &Expression<'a>, ctx: &LintContext<'a>) {
    match render_function {
        Expression::ArrowFunctionExpression(function) => {
            if let Some(Expression::JSXElement(element)) = function.get_expression() {
                report_missing_static_item_key(element, ctx);
                return;
            }
            let Some(body) = function.get_function_body() else {
                return;
            };
            report_missing_keys_in_return_statements(function.node_id.get(), body.span, ctx);
        }
        Expression::FunctionExpression(function) => {
            let Some(body) = function.body.as_deref() else {
                return;
            };
            report_missing_keys_in_return_statements(function.node_id.get(), body.span, ctx);
        }
        _ => {}
    }
}

fn report_missing_keys_in_return_statements(
    render_function_node_id: oxc_semantic::NodeId,
    body_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) {
    for candidate in ctx.nodes().iter() {
        if !body_span.contains_inclusive(candidate.span())
            || nearest_function_node_id(candidate, ctx) != Some(render_function_node_id)
        {
            continue;
        }
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        let Some(Expression::JSXElement(element)) = &return_statement.argument else {
            continue;
        };
        report_missing_static_item_key(element, ctx);
    }
}

fn nearest_function_node_id(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}

fn report_missing_static_item_key(element: &oxc_ast::ast::JSXElement<'_>, ctx: &LintContext<'_>) {
    if find_jsx_attribute(&element.opening_element, "key").is_none() {
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}
