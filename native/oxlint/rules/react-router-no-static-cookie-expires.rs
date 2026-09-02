use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const COOKIE_FACTORY_EXPORT_NAMES: [&str; 6] = [
    "createCookie",
    "createCookieSessionStorage",
    "createFileSessionStorage",
    "createMemorySessionStorage",
    "createSessionStorage",
    "createWorkersKVSessionStorage",
];
const REACT_ROUTER_RUNTIME_PACKAGE_NAMES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];
const MESSAGE: &str = "This cookie expiration Date is created once at module load and becomes stale for later requests.";

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoStaticCookieExpires;

declare_oxc_lint!(
    /// Disallows module-scoped cookie expiration dates based on the current time.
    ReactRouterNoStaticCookieExpires,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow stale module-scoped cookie expiration dates.",
);

impl Rule for ReactRouterNoStaticCookieExpires {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
            && is_react_router_file_active(ctx)
            && is_react_router_framework_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ObjectProperty(property) = node.kind() else {
            return;
        };
        if property.key.static_name().as_deref() != Some("expires")
            || crate::ast_util::get_enclosing_function(node, ctx).is_some()
        {
            return;
        }
        let oxc_ast::ast::Expression::NewExpression(new_expression) = &property.value else {
            return;
        };
        let oxc_ast::ast::Expression::Identifier(date_constructor) = &new_expression.callee else {
            return;
        };
        if date_constructor.name != "Date"
            || !ctx.is_reference_to_global_variable(date_constructor)
        {
            return;
        }
        let Some(expiration_argument) = new_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        if !contains_global_date_now_call(expiration_argument, ctx)
            || !ctx.nodes().ancestors(node.id()).any(|ancestor| {
                let AstKind::CallExpression(call_expression) = ancestor.kind() else {
                    return false;
                };
                let oxc_ast::ast::Expression::Identifier(callee) = &call_expression.callee else {
                    return false;
                };
                direct_named_import_matches(
                    callee,
                    &COOKIE_FACTORY_EXPORT_NAMES,
                    &REACT_ROUTER_RUNTIME_PACKAGE_NAMES,
                    ctx,
                )
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(node.span()));
    }
}

fn contains_global_date_now_call(
    expression: &oxc_ast::ast::Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let expression_span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        if candidate.span().start < expression_span.start
            || candidate.span().end > expression_span.end
        {
            return false;
        }
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return false;
        };
        let Some(member_expression) = call_expression.callee.get_member_expr() else {
            return false;
        };
        if member_expression.static_property_name() != Some("now") {
            return false;
        }
        let oxc_ast::ast::Expression::Identifier(date_identifier) = member_expression.object()
        else {
            return false;
        };
        date_identifier.name == "Date" && ctx.is_reference_to_global_variable(date_identifier)
    })
}
