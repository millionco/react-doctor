use oxc_ast::{
    ast::{Argument, Expression, JSXAttributeValue, JSXElementName, MemberExpression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::has_jsx_prop,
    AstNode,
};

const MESSAGE: &str = "ServerRouter and the React stream do not receive the same CSP nonce.";
const REACT_ROUTER_RUNTIME_PACKAGE_NAMES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterCspNonceConsistency;

declare_oxc_lint!(
    /// Requires one request-scoped nonce across React Router server rendering.
    ReactRouterCspNonceConsistency,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require matching server-rendering CSP nonces.",
);

impl Rule for ReactRouterCspNonceConsistency {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(render_call) = node.kind() else {
            return;
        };
        let Expression::Identifier(render_callee) = &render_call.callee else {
            return;
        };
        if !direct_named_import_matches(
            render_callee,
            &["renderToPipeableStream", "renderToReadableStream"],
            &["react-dom/server"],
            ctx,
        ) {
            return;
        }
        let Some(render_root) = render_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let Some(server_router_nonce) = find_server_router_nonce(render_root, ctx) else {
            return;
        };
        let stream_nonce = get_stream_nonce_expression(render_call);
        if server_router_nonce.is_none() && stream_nonce.is_none() {
            return;
        }
        let same_nonce = match (server_router_nonce, stream_nonce) {
            (Some(ServerRouterNonce::String(first)), Some(Expression::StringLiteral(second))) => {
                first == second.value
            }
            (Some(ServerRouterNonce::Expression(first)), Some(second)) => {
                csp_nonce_expressions_are_equal(first, second, ctx)
            }
            _ => false,
        };
        if !same_nonce {
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(render_call.span));
        }
    }
}

enum ServerRouterNonce<'a> {
    String(&'a str),
    Expression(&'a Expression<'a>),
}

fn find_server_router_nonce<'a>(
    render_root: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<Option<ServerRouterNonce<'a>>> {
    let mut server_router_nonce = None;
    let mut server_router_count = 0;
    for candidate in ctx.nodes().iter() {
        let AstKind::JSXOpeningElement(opening_element) = candidate.kind() else {
            continue;
        };
        if !render_root.span().contains_inclusive(opening_element.span) {
            continue;
        }
        let JSXElementName::IdentifierReference(_) = &opening_element.name else {
            continue;
        };
        if !REACT_ROUTER_RUNTIME_PACKAGE_NAMES
            .iter()
            .any(|module_source| {
                resolve_imported_jsx_component_name(opening_element, module_source, ctx)
                    == Some("ServerRouter")
            })
        {
            continue;
        }
        server_router_count += 1;
        server_router_nonce = get_server_router_nonce(opening_element);
    }
    (server_router_count == 1).then_some(server_router_nonce)
}

fn get_server_router_nonce<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
) -> Option<ServerRouterNonce<'a>> {
    let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) =
        has_jsx_prop(opening_element, "nonce")?
    else {
        return None;
    };
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(literal) => {
            Some(ServerRouterNonce::String(literal.value.as_str()))
        }
        JSXAttributeValue::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .map(ServerRouterNonce::Expression),
        _ => None,
    }
}

fn get_stream_nonce_expression<'a>(
    render_call: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<&'a Expression<'a>> {
    let Argument::ObjectExpression(options) = render_call.arguments.get(1)? else {
        return None;
    };
    options.properties.iter().find_map(|property| {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        (property.key.static_name().as_deref() == Some("nonce")).then_some(&property.value)
    })
}

fn csp_nonce_expressions_are_equal<'a>(
    first: &Expression<'a>,
    second: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let first = first.get_inner_expression();
    let second = second.get_inner_expression();
    match (first, second) {
        (Expression::ThisExpression(_), Expression::ThisExpression(_))
        | (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::Identifier(first), Expression::Identifier(second)) => {
            resolve_const_identifier_root_symbol(first, ctx).is_some_and(|first_symbol| {
                resolve_const_identifier_root_symbol(second, ctx) == Some(first_symbol)
            })
        }
        (Expression::StringLiteral(first), Expression::StringLiteral(second)) => {
            first.value == second.value
        }
        (Expression::BooleanLiteral(first), Expression::BooleanLiteral(second)) => {
            first.value == second.value
        }
        (Expression::NumericLiteral(first), Expression::NumericLiteral(second)) => {
            first.value == second.value
        }
        (Expression::BigIntLiteral(first), Expression::BigIntLiteral(second)) => {
            first.value == second.value
        }
        (Expression::CallExpression(first), Expression::CallExpression(second)) => {
            csp_nonce_expressions_are_equal(&first.callee, &second.callee, ctx)
                && first.arguments.len() == second.arguments.len()
                && first.arguments.iter().zip(&second.arguments).all(
                    |(first_argument, second_argument)| {
                        let (Some(first_argument), Some(second_argument)) = (
                            first_argument.as_expression(),
                            second_argument.as_expression(),
                        ) else {
                            return false;
                        };
                        csp_nonce_expressions_are_equal(first_argument, second_argument, ctx)
                    },
                )
        }
        _ => match (first.as_member_expression(), second.as_member_expression()) {
            (Some(first), Some(second)) => csp_nonce_members_are_equal(first, second, ctx),
            _ => false,
        },
    }
}

fn csp_nonce_members_are_equal<'a>(
    first: &MemberExpression<'a>,
    second: &MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match (first, second) {
        (
            MemberExpression::StaticMemberExpression(first),
            MemberExpression::StaticMemberExpression(second),
        ) => {
            first.property.name == second.property.name
                && csp_nonce_expressions_are_equal(&first.object, &second.object, ctx)
        }
        (
            MemberExpression::ComputedMemberExpression(first),
            MemberExpression::ComputedMemberExpression(second),
        ) => {
            csp_nonce_expressions_are_equal(&first.object, &second.object, ctx)
                && csp_nonce_expressions_are_equal(&first.expression, &second.expression, ctx)
        }
        (
            MemberExpression::PrivateFieldExpression(first),
            MemberExpression::PrivateFieldExpression(second),
        ) => {
            first.field.name == second.field.name
                && csp_nonce_expressions_are_equal(&first.object, &second.object, ctx)
        }
        _ => false,
    }
}
