use oxc_ast::{
    AstKind,
    ast::{ArrayExpressionElement, Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::node::NodeId;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This wastes work because [...array].sort() copies the array just to sort it, so use array.toSorted() to sort without the extra copy (ES2023)";
const FRESH_ARRAY_PRODUCING_METHOD_NAMES: [&str; 9] = [
    "values", "keys", "entries", "map", "filter", "flatMap", "slice", "concat", "from",
];
const ITERATOR_PRODUCING_METHOD_NAMES: [&str; 3] = ["values", "keys", "entries"];

#[derive(Debug, Default, Clone)]
pub struct JsTosortedImmutable;

declare_oxc_lint!(
    /// Prefer toSorted over copying an array before sort.
    JsTosortedImmutable,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer toSorted over copying an array before sort.",
);

impl Rule for JsTosortedImmutable {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(sort_member) = call_expression.callee.as_member_expression() else {
            return;
        };
        if member_expression_identifier_property_name(sort_member) != Some("sort") {
            return;
        }
        let Expression::ArrayExpression(array_expression) = sort_member.object().get_inner_expression()
        else {
            return;
        };
        let [ArrayExpressionElement::SpreadElement(spread_element)] =
            array_expression.elements.as_slice()
        else {
            return;
        };
        let spread_argument = spread_element.argument.get_inner_expression();
        if is_fresh_or_iterator_allocation(spread_argument)
            || is_spread_of_non_array_iterable_binding(spread_argument, ctx)
            || has_size_read_on_same_expression(spread_argument, node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
    }
}

fn is_fresh_or_iterator_allocation(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::ArrayExpression(_) | Expression::NewExpression(_) => true,
        Expression::CallExpression(call_expression) => call_expression
            .callee
            .as_member_expression()
            .and_then(member_expression_identifier_property_name)
            .is_some_and(|method_name| FRESH_ARRAY_PRODUCING_METHOD_NAMES.contains(&method_name)),
        _ => false,
    }
}

fn is_spread_of_non_array_iterable_binding<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
        .is_some_and(is_non_array_iterable_allocation)
}

fn is_non_array_iterable_allocation(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::NewExpression(new_expression) => !matches!(
            new_expression.callee.get_inner_expression(),
            Expression::Identifier(identifier) if identifier.name == "Array"
        ),
        Expression::CallExpression(call_expression) => call_expression
            .callee
            .as_member_expression()
            .and_then(member_expression_identifier_property_name)
            .is_some_and(|method_name| ITERATOR_PRODUCING_METHOD_NAMES.contains(&method_name)),
        _ => false,
    }
}

fn has_size_read_on_same_expression<'a>(
    spread_argument: &Expression<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let scope_owner_id = ctx
        .nodes()
        .ancestors(node.id())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .map(AstNode::id);
    ctx.nodes().iter().any(|candidate| {
        is_node_within_scope(candidate, scope_owner_id, ctx)
            && member_object_with_identifier_property(candidate.kind(), "size")
                .is_some_and(|object| {
                    are_simple_expressions_structurally_equal(object, spread_argument)
                })
    })
}

fn is_node_within_scope(
    node: &AstNode<'_>,
    scope_owner_id: Option<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    scope_owner_id.is_none_or(|owner_id| {
        node.id() == owner_id
            || ctx
                .nodes()
                .ancestors(node.id())
                .any(|ancestor| ancestor.id() == owner_id)
    })
}

fn member_object_with_identifier_property<'a>(
    kind: AstKind<'a>,
    expected_property_name: &str,
) -> Option<&'a Expression<'a>> {
    match kind {
        AstKind::StaticMemberExpression(member_expression)
            if member_expression.property.name == expected_property_name =>
        {
            Some(&member_expression.object)
        }
        AstKind::ComputedMemberExpression(member_expression)
            if matches!(
                &member_expression.expression,
                Expression::Identifier(identifier) if identifier.name == expected_property_name
            ) =>
        {
            Some(&member_expression.object)
        }
        _ => None,
    }
}

fn are_simple_expressions_structurally_equal(
    first: &Expression<'_>,
    second: &Expression<'_>,
) -> bool {
    let first = first.get_inner_expression();
    let second = second.get_inner_expression();
    match (first, second) {
        (Expression::ThisExpression(_), Expression::ThisExpression(_))
        | (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::Identifier(first), Expression::Identifier(second)) => {
            first.name == second.name
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
        (Expression::CallExpression(first), Expression::CallExpression(second)) => {
            are_simple_expressions_structurally_equal(&first.callee, &second.callee)
                && first.arguments.len() == second.arguments.len()
                && first.arguments.iter().zip(&second.arguments).all(
                    |(first_argument, second_argument)| {
                        let (Some(first_argument), Some(second_argument)) = (
                            first_argument.as_expression(),
                            second_argument.as_expression(),
                        ) else {
                            return false;
                        };
                        are_simple_expressions_structurally_equal(
                            first_argument,
                            second_argument,
                        )
                    },
                )
        }
        _ => match (first.as_member_expression(), second.as_member_expression()) {
            (Some(first_member), Some(second_member)) => {
                are_member_expressions_structurally_equal(first_member, second_member)
            }
            _ => false,
        },
    }
}

fn are_member_expressions_structurally_equal(
    first: &MemberExpression<'_>,
    second: &MemberExpression<'_>,
) -> bool {
    match (first, second) {
        (
            MemberExpression::StaticMemberExpression(first),
            MemberExpression::StaticMemberExpression(second),
        ) => {
            first.property.name == second.property.name
                && are_simple_expressions_structurally_equal(&first.object, &second.object)
        }
        (
            MemberExpression::ComputedMemberExpression(first),
            MemberExpression::ComputedMemberExpression(second),
        ) => {
            are_simple_expressions_structurally_equal(&first.object, &second.object)
                && are_simple_expressions_structurally_equal(
                    &first.expression,
                    &second.expression,
                )
        }
        _ => false,
    }
}
