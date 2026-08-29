use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct NoCollapsedLiteralOrChainAsValue;

declare_oxc_lint!(
    /// Disallow all-literal logical chains used as multi-value expressions.
    NoCollapsedLiteralOrChainAsValue,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow all-literal logical chains used as multi-value expressions.",
);

impl Rule for NoCollapsedLiteralOrChainAsValue {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::LogicalExpression(logical) = node.kind() else {
            return;
        };
        if !matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or)
            || no_collapsed_is_nested_in_logical_chain(node, ctx)
            || no_collapsed_shared_literal_kind(&logical.left, &logical.right).is_none()
        {
            return;
        }

        let wrapper = transparent_expression_root(node, ctx);
        let parent = ctx.nodes().parent_node(wrapper.id());
        if !no_collapsed_is_string_search_argument(wrapper, parent)
            && !no_collapsed_is_string_search_receiver(wrapper, parent, ctx)
            && !no_collapsed_is_equality_operand(wrapper, parent)
            && !no_collapsed_is_switch_case_test(wrapper, parent)
        {
            return;
        }

        let operator = match logical.operator {
            LogicalOperator::Or => "||",
            LogicalOperator::And => "&&",
            LogicalOperator::Coalesce => return,
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This all-literal `{operator}` chain evaluates to one fixed literal based on operand truthiness; it does not test multiple candidate values. Compare against each value separately or use an array `.includes(x)` check."
            ))
            .with_label(logical.span),
        );
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum NoCollapsedLiteralKind {
    String,
    Number,
    Regexp,
}

fn no_collapsed_shared_literal_kind<'a, 'b>(
    left: &'b Expression<'a>,
    right: &'b Expression<'a>,
) -> Option<NoCollapsedLiteralKind> {
    let mut pending_operands: Vec<&'b Expression<'a>> = vec![left, right];
    let mut shared_kind = None;
    while let Some(raw_operand) = pending_operands.pop() {
        let operand = raw_operand.get_inner_expression();
        if let Expression::LogicalExpression(logical) = operand {
            if !matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) {
                return None;
            }
            pending_operands.push(&logical.left);
            pending_operands.push(&logical.right);
            continue;
        }
        let operand_kind = no_collapsed_literal_kind(operand)?;
        if shared_kind.is_some_and(|kind| kind != operand_kind) {
            return None;
        }
        shared_kind = Some(operand_kind);
    }
    shared_kind
}

fn no_collapsed_literal_kind(expression: &Expression<'_>) -> Option<NoCollapsedLiteralKind> {
    match expression {
        Expression::StringLiteral(_) => Some(NoCollapsedLiteralKind::String),
        Expression::NumericLiteral(_) => Some(NoCollapsedLiteralKind::Number),
        Expression::RegExpLiteral(_) => Some(NoCollapsedLiteralKind::Regexp),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
            Some(NoCollapsedLiteralKind::String)
        }
        Expression::UnaryExpression(unary)
            if matches!(
                unary.operator,
                UnaryOperator::UnaryPlus | UnaryOperator::UnaryNegation
            ) && matches!(&unary.argument, Expression::NumericLiteral(_)) =>
        {
            Some(NoCollapsedLiteralKind::Number)
        }
        _ => None,
    }
}

fn no_collapsed_is_nested_in_logical_chain<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    matches!(
        ctx.nodes()
            .parent_node(transparent_expression_root(node, ctx).id())
            .kind(),
        AstKind::LogicalExpression(logical)
            if matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or)
    )
}

fn no_collapsed_is_string_search_argument(wrapper: &AstNode<'_>, parent: &AstNode<'_>) -> bool {
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    call.callee
        .as_member_expression()
        .is_some_and(|member| no_collapsed_is_string_search_member(member))
        && call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == wrapper.span())
        })
}

fn no_collapsed_is_string_search_receiver<'a>(
    wrapper: &AstNode<'a>,
    parent: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let is_matching_member = match parent.kind() {
        AstKind::StaticMemberExpression(member) => {
            member.object.span() == wrapper.span()
                && no_collapsed_is_string_search_method(member.property.name.as_str())
        }
        AstKind::ComputedMemberExpression(member) => {
            member.object.span() == wrapper.span()
                && no_collapsed_computed_search_method(&member.expression)
        }
        _ => return false,
    };
    if !is_matching_member {
        return false;
    }
    matches!(
        ctx.nodes().parent_node(parent.id()).kind(),
        AstKind::CallExpression(call) if call.callee.span() == parent.span()
    )
}

fn no_collapsed_is_string_search_member(member: &oxc_ast::ast::MemberExpression<'_>) -> bool {
    match member {
        oxc_ast::ast::MemberExpression::StaticMemberExpression(member) => {
            no_collapsed_is_string_search_method(member.property.name.as_str())
        }
        oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) => {
            no_collapsed_computed_search_method(&member.expression)
        }
        oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => false,
    }
}

fn no_collapsed_computed_search_method(expression: &Expression<'_>) -> bool {
    let property_name = match expression {
        Expression::StringLiteral(property) => property.value.as_str(),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            quasi
                .value
                .cooked
                .as_ref()
                .map_or(quasi.value.raw.as_str(), |value| value.as_str())
        }
        _ => return false,
    };
    no_collapsed_is_string_search_method(property_name)
}

fn no_collapsed_is_string_search_method(property_name: &str) -> bool {
    matches!(
        property_name,
        "includes"
            | "startsWith"
            | "endsWith"
            | "indexOf"
            | "lastIndexOf"
            | "search"
            | "match"
            | "test"
    )
}

fn no_collapsed_is_equality_operand(wrapper: &AstNode<'_>, parent: &AstNode<'_>) -> bool {
    let AstKind::BinaryExpression(binary) = parent.kind() else {
        return false;
    };
    matches!(
        binary.operator,
        BinaryOperator::Equality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictEquality
            | BinaryOperator::StrictInequality
    ) && (binary.left.span() == wrapper.span() || binary.right.span() == wrapper.span())
}

fn no_collapsed_is_switch_case_test(wrapper: &AstNode<'_>, parent: &AstNode<'_>) -> bool {
    matches!(
        parent.kind(),
        AstKind::SwitchCase(case)
            if case.test.as_ref().is_some_and(|test| test.span() == wrapper.span())
    )
}
