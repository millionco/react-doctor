use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_ecmascript::StringToNumber;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::has_jsx_prop_ignore_case,
};

const MESSAGE: &str = "Keyboard users get jumped out of the normal order by a positive `tabIndex`, so use `0` or `-1`.";

#[derive(Debug, Default, Clone)]
pub struct TabindexNoPositive;

declare_oxc_lint!(
    /// Disallow positive tabindex values.
    TabindexNoPositive,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow positive tabindex values.",
);

impl Rule for TabindexNoPositive {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(JSXAttributeItem::Attribute(attribute)) =
            has_jsx_prop_ignore_case(opening_element, "tabIndex")
        else {
            return;
        };
        let Some(value) = attribute.value.as_ref() else {
            return;
        };
        if parse_static_jsx_number(value).is_some_and(|value| value > 0.0) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }
}

fn parse_static_jsx_number(value: &JSXAttributeValue) -> Option<f64> {
    match value {
        JSXAttributeValue::StringLiteral(string_literal) => {
            parse_finite_number(string_literal.value.as_str())
        }
        JSXAttributeValue::ExpressionContainer(container) => {
            parse_static_expression(container.expression.as_expression()?.get_inner_expression())
        }
        _ => None,
    }
}

fn parse_static_expression(expression: &Expression) -> Option<f64> {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(number_literal) => Some(number_literal.value),
        Expression::StringLiteral(string_literal) => {
            parse_finite_number(string_literal.value.as_str())
        }
        Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation =>
        {
            let Expression::NumericLiteral(number_literal) =
                unary_expression.argument.get_inner_expression()
            else {
                return None;
            };
            Some(-number_literal.value)
        }
        Expression::TemplateLiteral(template_literal)
            if template_literal.expressions.is_empty() && template_literal.quasis.len() == 1 =>
        {
            let quasi = &template_literal.quasis[0];
            parse_finite_number(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str()),
            )
        }
        Expression::ConditionalExpression(conditional_expression) => {
            let selected_expression =
                if resolve_static_truthiness(&conditional_expression.test).unwrap_or(true) {
                    &conditional_expression.consequent
                } else {
                    &conditional_expression.alternate
                };
            parse_static_expression(selected_expression)
        }
        _ => None,
    }
}

fn parse_finite_number(value: &str) -> Option<f64> {
    let number = value
        .trim_matches(|character: char| character.is_whitespace() || character == '\u{feff}')
        .string_to_number();
    number.is_finite().then_some(number)
}

fn resolve_static_truthiness(expression: &Expression) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(boolean_literal) => Some(boolean_literal.value),
        Expression::NullLiteral(_) => Some(false),
        Expression::NumericLiteral(number_literal) => Some(number_literal.value != 0.0),
        Expression::StringLiteral(string_literal) => Some(!string_literal.value.is_empty()),
        _ => None,
    }
}
