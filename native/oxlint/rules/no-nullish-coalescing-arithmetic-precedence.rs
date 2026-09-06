use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct NoNullishCoalescingArithmeticPrecedence;

declare_oxc_lint!(
    /// Warns when arithmetic swallows a nullish fallback sentinel.
    NoNullishCoalescingArithmeticPrecedence,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when arithmetic swallows a nullish fallback sentinel.",
);

impl Rule for NoNullishCoalescingArithmeticPrecedence {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::LogicalExpression(logical_expression) = node.kind() else {
            return;
        };
        if logical_expression.operator != LogicalOperator::Coalesce {
            return;
        }
        let Expression::BinaryExpression(arithmetic_expression) = &logical_expression.right else {
            return;
        };
        if logical_expression.span.end != arithmetic_expression.span.end
            || !is_arithmetic_operator(arithmetic_expression.operator)
            || !is_sentinel_literal_swallow(arithmetic_expression)
            || !has_non_numeric_literal_leaf(&logical_expression.right)
            || arithmetic_expression.operator == BinaryOperator::Addition
                && has_string_literal_leaf(&logical_expression.right)
            || is_zero_minus_timezone_offset_idiom(arithmetic_expression)
        {
            return;
        }
        let operator = arithmetic_expression.operator.as_str();
        let description = match arithmetic_expression.operator {
            BinaryOperator::Multiplication => "multiplies",
            BinaryOperator::Division => "divides",
            BinaryOperator::Remainder => "applies remainder to",
            BinaryOperator::Subtraction => "subtracts from",
            BinaryOperator::Addition => "adds to",
            BinaryOperator::Exponential => "raises the fallback to",
            _ => "applies arithmetic to",
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Arithmetic binds tighter than `??`, so this {description} the fallback instead of the value. Wrap the nullish expression in parentheses before applying `{operator}`."
            ))
            .with_label(logical_expression.span),
        );
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum NumericLeafValue {
    NegativeOne,
    Zero,
    One,
    Other,
}

fn is_arithmetic_operator(operator: BinaryOperator) -> bool {
    matches!(
        operator,
        BinaryOperator::Multiplication
            | BinaryOperator::Division
            | BinaryOperator::Remainder
            | BinaryOperator::Subtraction
            | BinaryOperator::Addition
            | BinaryOperator::Exponential
    )
}

fn is_sentinel_literal_swallow(expression: &oxc_ast::ast::BinaryExpression<'_>) -> bool {
    let mut innermost = expression;
    while let Expression::BinaryExpression(left_expression) =
        innermost.left.get_inner_expression()
    {
        innermost = left_expression;
    }
    match resolve_numeric_leaf_value(&innermost.left) {
        Some(NumericLeafValue::Zero) => true,
        Some(NumericLeafValue::NegativeOne) => {
            innermost.operator == BinaryOperator::Subtraction
        }
        Some(NumericLeafValue::One) => innermost.operator == BinaryOperator::Multiplication,
        _ => false,
    }
}

fn resolve_numeric_leaf_value(expression: &Expression<'_>) -> Option<NumericLeafValue> {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(literal) => Some(match literal.value {
            -1.0 => NumericLeafValue::NegativeOne,
            0.0 => NumericLeafValue::Zero,
            1.0 => NumericLeafValue::One,
            _ => NumericLeafValue::Other,
        }),
        Expression::BigIntLiteral(literal) => {
            let value = literal.value.to_string();
            Some(match value.as_str() {
                "0" => NumericLeafValue::Zero,
                "1" => NumericLeafValue::One,
                _ => NumericLeafValue::Other,
            })
        }
        Expression::UnaryExpression(unary_expression)
            if matches!(
                unary_expression.operator,
                UnaryOperator::UnaryNegation | UnaryOperator::UnaryPlus
            ) =>
        {
            let value = resolve_numeric_leaf_value(&unary_expression.argument)?;
            if unary_expression.operator == UnaryOperator::UnaryNegation {
                Some(match value {
                    NumericLeafValue::NegativeOne => NumericLeafValue::One,
                    NumericLeafValue::One => NumericLeafValue::NegativeOne,
                    NumericLeafValue::Zero => NumericLeafValue::Zero,
                    NumericLeafValue::Other => NumericLeafValue::Other,
                })
            } else {
                Some(value)
            }
        }
        _ => None,
    }
}

fn is_numeric_literal_leaf(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(_) | Expression::BigIntLiteral(_) => true,
        Expression::UnaryExpression(unary_expression)
            if matches!(
                unary_expression.operator,
                UnaryOperator::UnaryNegation | UnaryOperator::UnaryPlus
            ) =>
        {
            is_numeric_literal_leaf(&unary_expression.argument)
        }
        _ => false,
    }
}

fn has_non_numeric_literal_leaf(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::BinaryExpression(binary_expression) => {
            has_non_numeric_literal_leaf(&binary_expression.left)
                || has_non_numeric_literal_leaf(&binary_expression.right)
        }
        expression => !is_numeric_literal_leaf(expression),
    }
}

fn has_string_literal_leaf(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::StringLiteral(_) => true,
        Expression::BinaryExpression(binary_expression)
            if binary_expression.operator == BinaryOperator::Addition =>
        {
            has_string_literal_leaf(&binary_expression.left)
                || has_string_literal_leaf(&binary_expression.right)
        }
        _ => false,
    }
}

fn is_zero_minus_timezone_offset_idiom(
    expression: &oxc_ast::ast::BinaryExpression<'_>,
) -> bool {
    if expression.operator != BinaryOperator::Subtraction
        || !matches!(&expression.left, Expression::NumericLiteral(literal) if literal.value == 0.0)
    {
        return false;
    }
    let Expression::CallExpression(call_expression) = &expression.right else {
        return false;
    };
    call_expression
        .callee
        .get_member_expr()
        .is_some_and(|member_expression| {
            member_expression.static_property_name().as_deref() == Some("getTimezoneOffset")
        })
}
