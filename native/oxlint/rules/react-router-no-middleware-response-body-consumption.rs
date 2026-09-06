use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const RESPONSE_BODY_READER_NAMES: [&str; 6] =
    ["arrayBuffer", "blob", "bytes", "formData", "json", "text"];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoMiddlewareResponseBodyConsumption;

declare_oxc_lint!(
    /// Warns when React Router middleware consumes the outgoing response body.
    ReactRouterNoMiddlewareResponseBodyConsumption,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when middleware consumes a next response body.",
);

impl Rule for ReactRouterNoMiddlewareResponseBodyConsumption {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
            && is_react_router_file_active(ctx)
            && is_react_router_framework_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(next_call) = node.kind() else {
            return;
        };
        let Expression::Identifier(next_callee) = &next_call.callee else {
            return;
        };
        let Some(middleware_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        let Some(next_symbol_id) =
            get_react_router_middleware_next_symbol(middleware_function, ctx)
        else {
            return;
        };
        if ctx
            .scoping()
            .get_reference(next_callee.reference_id())
            .symbol_id()
            != Some(next_symbol_id)
        {
            return;
        }
        let awaited_node = ctx.nodes().parent_node(node.id());
        if !matches!(awaited_node.kind(), AstKind::AwaitExpression(_)) {
            return;
        }
        let declarator_node = ctx.nodes().parent_node(awaited_node.id());
        let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
            return;
        };
        let Some(response_binding) = declarator.id.get_binding_identifier() else {
            return;
        };
        for response_reference in ctx
            .scoping()
            .get_resolved_references(response_binding.symbol_id())
        {
            let response_reference_node = ctx.nodes().get_node(response_reference.node_id());
            let member_node = ctx.nodes().parent_node(response_reference_node.id());
            let AstKind::StaticMemberExpression(member_expression) = member_node.kind() else {
                let AstKind::ComputedMemberExpression(member_expression) = member_node.kind()
                else {
                    continue;
                };
                let Some(method_name) = member_expression.static_property_name() else {
                    continue;
                };
                report_response_body_reader(
                    member_node,
                    &method_name,
                    response_binding.name.as_str(),
                    ctx,
                );
                continue;
            };
            let method_name = member_expression.property.name.as_str();
            report_response_body_reader(
                member_node,
                method_name,
                response_binding.name.as_str(),
                ctx,
            );
        }
    }
}

fn report_response_body_reader(
    member_node: &AstNode<'_>,
    method_name: &str,
    response_name: &str,
    ctx: &LintContext<'_>,
) {
    if !RESPONSE_BODY_READER_NAMES.contains(&method_name) {
        return;
    }
    let call_node = ctx.nodes().parent_node(member_node.id());
    let AstKind::CallExpression(call_expression) = call_node.kind() else {
        return;
    };
    if call_expression.callee.span() != member_node.span() {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "{response_name}.{method_name}() consumes the Response body returned by next()."
        ))
        .with_label(call_expression.span),
    );
}
