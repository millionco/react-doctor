use oxc_ast::{
    AstKind,
    ast::{Argument, CallExpression, ChainElement, Expression, JSXAttributeName, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_syntax::operator::UnaryOperator;
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str = "This `.then()` runs in an event handler with no `.catch`, so a rejection becomes an uncaught promise error no React error boundary can catch — add a `.catch` handler or make the handler `async` with `try/catch`.";

#[derive(Debug, Default, Clone)]
pub struct NoFloatingThenInJsxHandler;

declare_oxc_lint!(
    /// Warns about unhandled promise chains in intrinsic JSX event handlers.
    NoFloatingThenInJsxHandler,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns about floating .then chains in JSX event handlers.",
);

impl Rule for NoFloatingThenInJsxHandler {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut block_handler_ids = FxHashSet::<NodeId>::default();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let element_name = match &opening_element.name {
                JSXElementName::Identifier(element_name) => element_name.name.as_str(),
                JSXElementName::IdentifierReference(element_name) => element_name.name.as_str(),
                _ => continue,
            };
            if !element_name
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_lowercase)
            {
                continue;
            }

            for attribute_item in &opening_element.attributes {
                let Some(attribute) = attribute_item.as_attribute() else {
                    continue;
                };
                let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                    continue;
                };
                let attribute_name = attribute_name.name.as_str().as_bytes();
                if attribute_name.len() < 3
                    || &attribute_name[..2] != b"on"
                    || !attribute_name[2].is_ascii_uppercase()
                {
                    continue;
                }
                let Some(handler) = jsx_attribute_expression(attribute) else {
                    continue;
                };
                match handler.get_inner_expression() {
                    Expression::ArrowFunctionExpression(function) => {
                        if let Some(expression) = function.get_expression() {
                            report_floating_then_expression(expression, ctx);
                        } else {
                            block_handler_ids.insert(function.node_id.get());
                        }
                    }
                    Expression::FunctionExpression(function) => {
                        block_handler_ids.insert(function.node_id.get());
                    }
                    _ => {}
                }
            }
        }

        if block_handler_ids.is_empty() {
            return;
        }
        for candidate in ctx.nodes().iter() {
            let expression = match candidate.kind() {
                AstKind::ExpressionStatement(statement) => Some(&statement.expression),
                AstKind::ReturnStatement(statement) => statement.argument.as_ref(),
                _ => None,
            };
            if let Some(expression) = expression
                && local_callback_nearest_function_id(candidate.id(), ctx)
                    .is_some_and(|function_id| block_handler_ids.contains(&function_id))
            {
                report_floating_then_expression(expression, ctx);
            }
        }
    }
}

fn report_floating_then_expression<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == UnaryOperator::Void =>
        {
            report_floating_then_expression(&unary_expression.argument, ctx);
        }
        Expression::LogicalExpression(logical_expression) => {
            report_floating_then_expression(&logical_expression.right, ctx);
        }
        Expression::ConditionalExpression(conditional_expression) => {
            report_floating_then_expression(&conditional_expression.consequent, ctx);
            report_floating_then_expression(&conditional_expression.alternate, ctx);
        }
        expression => {
            if let Some(floating_then) = floating_then_call(expression) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(floating_then.span));
            }
        }
    }
}

fn floating_then_call<'a, 'b>(expression: &'b Expression<'a>) -> Option<&'b CallExpression<'a>> {
    let mut terminal = expression.get_inner_expression();
    while let Some(call_expression) = floating_then_call_expression(terminal) {
        if call_method_name(call_expression) != Some("finally") {
            break;
        }
        terminal = call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()?
            .object()
            .get_inner_expression();
    }
    while let Some(call_expression) = floating_then_call_expression(terminal) {
        if call_method_name(call_expression) != Some("catch") {
            break;
        }
        if is_callable_handler(call_expression.arguments.first()) {
            return None;
        }
        terminal = call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()?
            .object()
            .get_inner_expression();
    }
    let call_expression = floating_then_call_expression(terminal)?;
    (call_method_name(call_expression) == Some("then")).then_some(call_expression)
}

fn floating_then_call_expression<'a, 'b>(
    expression: &'b Expression<'a>,
) -> Option<&'b CallExpression<'a>> {
    match expression.get_inner_expression() {
        Expression::CallExpression(call_expression) => Some(call_expression),
        Expression::ChainExpression(chain_expression) => match &chain_expression.expression {
            ChainElement::CallExpression(call_expression) => Some(call_expression),
            _ => None,
        },
        _ => None,
    }
}

fn call_method_name<'a>(call_expression: &'a CallExpression<'a>) -> Option<&'a str> {
    static_member_expression_property_name(
        call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()?,
    )
}

fn is_callable_handler(argument: Option<&Argument<'_>>) -> bool {
    let Some(expression) = argument.and_then(Argument::as_expression) else {
        return false;
    };
    let expression = expression.get_inner_expression();
    matches!(
        expression,
        Expression::ArrowFunctionExpression(_)
            | Expression::FunctionExpression(_)
            | Expression::Identifier(_)
    ) || expression.as_member_expression().is_some()
}
