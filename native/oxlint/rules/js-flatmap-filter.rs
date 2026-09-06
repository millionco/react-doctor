use oxc_ast::{
    ast::{ArrayExpressionElement, BindingPattern, Expression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const SMALL_LITERAL_ARRAY_MAX_ELEMENTS: usize = 8;
const MESSAGE: &str = "This .map().filter(Boolean) chain creates an intermediate array and traverses it again; if this is a measured hot path, combine the transform and truthy check with .reduce() or for...of";

#[derive(Debug, Default, Clone)]
pub struct JsFlatmapFilter;

declare_oxc_lint!(
    /// Prefer flatMap over map followed by filter(Boolean).
    JsFlatmapFilter,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer flatMap over map followed by filter(Boolean).",
);

impl Rule for JsFlatmapFilter {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(filter_call) = node.kind() else {
            return;
        };
        let Some(filter_member) = filter_call.callee.as_member_expression() else {
            return;
        };
        if member_expression_identifier_property_name(filter_member) != Some("filter")
            || !filter_call
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                .is_some_and(is_boolean_filter_callback)
        {
            return;
        }
        let Expression::CallExpression(map_call) = filter_member.object().get_inner_expression()
        else {
            return;
        };
        let Some(map_member) = map_call.callee.as_member_expression() else {
            return;
        };
        if member_expression_identifier_property_name(map_member) != Some("map") {
            return;
        }
        let receiver = map_member.object().get_inner_expression();
        if is_bounded_pipeline_source(receiver) || is_small_literal_array(receiver) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(filter_call.span));
    }
}

fn is_boolean_filter_callback(expression: &Expression<'_>) -> bool {
    match strip_parenthesized_expression(expression) {
        Expression::Identifier(identifier) => identifier.name == "Boolean",
        Expression::ArrowFunctionExpression(arrow_function) => {
            let [parameter] = arrow_function.params.items.as_slice() else {
                return false;
            };
            let BindingPattern::BindingIdentifier(parameter_identifier) = &parameter.pattern else {
                return false;
            };
            matches!(
                arrow_function.get_expression(),
                Some(Expression::Identifier(body_identifier))
                    if body_identifier.name == parameter_identifier.name
            )
        }
        _ => false,
    }
}

fn is_bounded_pipeline_source(expression: &Expression<'_>) -> bool {
    let Expression::CallExpression(call_expression) = expression else {
        return false;
    };
    call_expression
        .callee
        .as_member_expression()
        .and_then(member_expression_identifier_property_name)
        .is_some_and(|property_name| matches!(property_name, "slice" | "split"))
}

fn is_small_literal_array(expression: &Expression<'_>) -> bool {
    let Expression::ArrayExpression(array_expression) = expression else {
        return false;
    };
    !array_expression.elements.is_empty()
        && array_expression.elements.len() <= SMALL_LITERAL_ARRAY_MAX_ELEMENTS
        && array_expression
            .elements
            .iter()
            .all(|element| !matches!(element, ArrayExpressionElement::SpreadElement(_)))
}
