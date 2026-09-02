use oxc_ast::{
    AstKind,
    ast::{ArrayExpressionElement, CallExpression, ChainElement, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::is_react_hook_name,
};

const EAGER_CALL_RESOLUTION_DEPTH_LIMIT: usize = 4;
const TRIVIAL_DATE_GETTER_NAMES: [&str; 20] = [
    "now",
    "getTime",
    "getFullYear",
    "getMonth",
    "getDate",
    "getDay",
    "getHours",
    "getMinutes",
    "getSeconds",
    "getMilliseconds",
    "getTimezoneOffset",
    "getUTCFullYear",
    "getUTCMonth",
    "getUTCDate",
    "getUTCDay",
    "getUTCHours",
    "getUTCMinutes",
    "getUTCSeconds",
    "getUTCMilliseconds",
    "valueOf",
];
const TRIVIAL_INITIALIZER_NAMES: [&str; 7] = [
    "Boolean",
    "String",
    "Number",
    "Array",
    "Object",
    "parseInt",
    "parseFloat",
];

#[derive(Debug, Default, Clone)]
pub struct RerenderLazyStateInit;

declare_oxc_lint!(
    /// Warns when a useState initializer reruns an expensive call on every render.
    RerenderLazyStateInit,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when a useState initializer reruns an expensive call on every render.",
);

impl Rule for RerenderLazyStateInit {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(state_call) = node.kind() else {
            return;
        };
        if !is_react_hook_call(state_call, &["useState"], ctx) {
            return;
        }
        let Some(initializer) = state_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let Some(eager_call) = find_eager_state_initializer_call(initializer, 0) else {
            return;
        };
        let callee = eager_call.callee.get_inner_expression();
        let member_property_name = callee
            .as_member_expression()
            .and_then(oxc_ast::ast::MemberExpression::static_property_name);
        let callee_name = match callee {
            Expression::Identifier(identifier) => identifier.name.as_str(),
            _ => member_property_name.unwrap_or("fn"),
        };
        if TRIVIAL_INITIALIZER_NAMES.contains(&callee_name)
            || member_property_name.is_some_and(|property_name| {
                eager_call.arguments.is_empty()
                    && TRIVIAL_DATE_GETTER_NAMES.contains(&property_name)
            })
            || is_react_hook_name(callee_name)
        {
            return;
        }
        let call_description = format!("{callee_name}()");
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "useState({call_description}) re-runs {call_description} on every render & throws the result away."
            ))
            .with_label(eager_call.span),
        );
    }
}

fn find_eager_state_initializer_call<'a>(
    expression: &'a Expression<'a>,
    depth: usize,
) -> Option<&'a CallExpression<'a>> {
    if depth > EAGER_CALL_RESOLUTION_DEPTH_LIMIT {
        return None;
    }
    match expression.get_inner_expression() {
        Expression::CallExpression(call_expression) => Some(call_expression),
        Expression::ChainExpression(chain_expression) => match &chain_expression.expression {
            ChainElement::CallExpression(call_expression) => Some(call_expression),
            ChainElement::TSNonNullExpression(non_null_expression) => {
                find_eager_state_initializer_call(&non_null_expression.expression, depth)
            }
            chain_element => chain_element
                .as_member_expression()
                .and_then(|member_expression| {
                    find_eager_state_initializer_call(member_expression.object(), depth)
                }),
        },
        Expression::LogicalExpression(logical_expression) => {
            find_eager_state_initializer_call(&logical_expression.left, depth + 1)
        }
        expression => {
            if let Some(member_expression) = expression.as_member_expression() {
                return find_eager_state_initializer_call(member_expression.object(), depth + 1);
            }
            let Expression::ArrayExpression(array_expression) = expression else {
                return None;
            };
            array_expression.elements.iter().find_map(|element| {
                let ArrayExpressionElement::SpreadElement(spread_element) = element else {
                    return None;
                };
                find_eager_state_initializer_call(&spread_element.argument, depth + 1)
            })
        }
    }
}
