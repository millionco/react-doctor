use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REQUEST_BODY_READER_NAMES: [&str; 6] =
    ["arrayBuffer", "blob", "bytes", "formData", "json", "text"];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoLoaderRequestBody;

declare_oxc_lint!(
    /// Disallows reading submitted request bodies in React Router loaders.
    ReactRouterNoLoaderRequestBody,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow reading request bodies in loaders.",
);

impl Rule for ReactRouterNoLoaderRequestBody {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(member_expression) = call_expression.callee.as_member_expression() else {
            return;
        };
        let Some(method_name) = member_expression.static_property_name() else {
            return;
        };
        if !REQUEST_BODY_READER_NAMES.contains(&method_name) {
            return;
        }
        let Some(loader_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        if !is_react_router_route_function(loader_function, "loader", ctx)
            || !is_route_request_expression(member_expression.object(), loader_function, ctx)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::error(format!(
                "loader reads request.{method_name}(), but loader requests do not carry submitted bodies."
            ))
            .with_label(call_expression.span),
        );
    }
}
