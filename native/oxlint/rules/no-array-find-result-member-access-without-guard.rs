use oxc_ast::{
    AstKind,
    ast::{Argument, ArrayExpressionElement, CallExpression, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "`find` returns `undefined` when nothing matches, so reading from its result here throws `Cannot read properties of undefined` — use optional chaining (`?.`) or guard the result before you use it.";

#[derive(Debug, Default, Clone)]
pub struct NoArrayFindResultMemberAccessWithoutGuard;

declare_oxc_lint!(
    /// Warns about unguarded member access on an array find result.
    NoArrayFindResultMemberAccessWithoutGuard,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Unguarded member access on find() result.",
);

impl Rule for NoArrayFindResultMemberAccessWithoutGuard {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call) = node.kind() else {
            return;
        };
        if !is_array_find_call(call, node, ctx)
            || is_boolean_find_over_truthy_array_literal(call)
            || !has_unguarded_immediate_consumer(node, ctx)
            || is_guarded_by_repeated_find_test(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }
}

fn is_array_find_call<'a>(
    call: &CallExpression<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = call.callee.get_member_expr() else {
        return false;
    };
    if !matches!(
        member.static_property_name().as_deref(),
        Some("find" | "findLast")
    ) {
        return false;
    }
    let receiver = member.object().get_inner_expression();
    if matches!(receiver, Expression::Identifier(identifier) if starts_with_uppercase(&identifier.name))
        || receiver_chain_contains_chain_call(receiver)
        || resolves_to_object_expression(receiver, ctx)
        || !has_array_callback_first_argument(call, receiver, ctx)
    {
        return false;
    }
    !is_opaque_exec_query_result(node, receiver, call, ctx)
}

fn starts_with_uppercase(name: &str) -> bool {
    name.chars().next().is_some_and(char::is_uppercase)
}

fn resolves_to_object_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = expression.get_inner_expression();
    let mut visited_symbol_ids = Vec::new();
    loop {
        let Expression::Identifier(identifier) = current else {
            return matches!(current, Expression::ObjectExpression(_));
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if visited_symbol_ids.contains(&symbol_id) {
            return false;
        }
        visited_symbol_ids.push(symbol_id);
        let Some(initializer) = resolve_direct_unreassigned_initializer(identifier, ctx) else {
            return false;
        };
        current = initializer.get_inner_expression();
    }
}

fn resolves_to_array_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = expression.get_inner_expression();
    let mut visited_symbol_ids = Vec::new();
    loop {
        let Expression::Identifier(identifier) = current else {
            return matches!(current, Expression::ArrayExpression(_));
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if visited_symbol_ids.contains(&symbol_id) {
            return false;
        }
        visited_symbol_ids.push(symbol_id);
        let Some(initializer) = resolve_direct_unreassigned_initializer(identifier, ctx) else {
            return false;
        };
        current = initializer.get_inner_expression();
    }
}

fn has_array_callback_first_argument<'a>(
    call: &CallExpression<'a>,
    receiver: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    match argument.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
        Expression::Identifier(identifier) => {
            if identifier.name == "Boolean"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
            {
                return true;
            }
            if starts_with_uppercase(&identifier.name) {
                return false;
            }
            !resolve_direct_unreassigned_initializer(identifier, ctx).is_some_and(|initializer| {
                matches!(
                    initializer.get_inner_expression(),
                    Expression::ObjectExpression(_)
                )
            })
        }
        expression if expression.as_member_expression().is_some() => {
            matches!(receiver, Expression::ArrayExpression(_))
                || resolves_to_array_expression(receiver, ctx)
        }
        _ => false,
    }
}

fn receiver_chain_contains_chain_call(mut expression: &Expression<'_>) -> bool {
    loop {
        let Expression::CallExpression(call) = expression.get_inner_expression() else {
            return false;
        };
        if matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "chain")
        {
            return true;
        }
        let Some(member) = call.callee.get_member_expr() else {
            return false;
        };
        if member.static_property_name().as_deref() == Some("chain") {
            return true;
        }
        expression = member.object();
    }
}

fn is_opaque_exec_query_result(
    find_node: &AstNode<'_>,
    receiver: &Expression<'_>,
    call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(find_node.id());
    let is_exec_member = match parent.kind() {
        AstKind::StaticMemberExpression(member) => {
            member.object.span() == find_node.span() && member.property.name == "exec"
        }
        AstKind::ComputedMemberExpression(member) => {
            member.object.span() == find_node.span()
                && member.static_property_name().as_deref() == Some("exec")
        }
        _ => false,
    };
    if !is_exec_member {
        return false;
    }
    let parent_call = ctx.nodes().parent_node(parent.id());
    matches!(parent_call.kind(), AstKind::CallExpression(parent_call) if parent_call.callee.span() == parent.span())
        && !matches!(receiver, Expression::ArrayExpression(_))
        && !matches!(
            call.arguments
                .first()
                .and_then(Argument::as_expression)
                .map(Expression::get_inner_expression),
            Some(Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_))
        )
}

fn is_boolean_find_over_truthy_array_literal(call: &CallExpression<'_>) -> bool {
    let Some(member) = call.callee.get_member_expr() else {
        return false;
    };
    let Expression::ArrayExpression(array) = member.object().get_inner_expression() else {
        return false;
    };
    let Some(Expression::Identifier(predicate)) = call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    predicate.name == "Boolean"
        && array.elements.iter().any(|element| {
            ArrayExpressionElement::as_expression(element).is_some_and(is_statically_truthy_literal)
        })
}

fn is_statically_truthy_literal(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => literal.value,
        Expression::NumericLiteral(literal) => literal.value != 0.0 && !literal.value.is_nan(),
        Expression::BigIntLiteral(literal) => literal.value.to_string() != "0",
        Expression::StringLiteral(literal) => !literal.value.is_empty(),
        Expression::TemplateLiteral(template) => {
            template.expressions.is_empty()
                && template
                    .quasis
                    .first()
                    .is_some_and(|quasi| !quasi.value.raw.is_empty())
        }
        _ => false,
    }
}

fn has_unguarded_immediate_consumer(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut current = node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSInstantiationExpression(_)
            | AstKind::ChainExpression(_) => current = parent,
            AstKind::TSNonNullExpression(_) => return false,
            AstKind::StaticMemberExpression(member) => {
                return member.object.span() == current.span() && !member.optional;
            }
            AstKind::ComputedMemberExpression(member) => {
                return member.object.span() == current.span() && !member.optional;
            }
            AstKind::PrivateFieldExpression(member) => {
                return member.object.span() == current.span() && !member.optional;
            }
            AstKind::CallExpression(call) => {
                return call.callee.span() == current.span() && !call.optional;
            }
            _ => return false,
        }
    }
}

fn is_guarded_by_repeated_find_test(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let AstKind::CallExpression(find_call) = node.kind() else {
        return false;
    };
    if !find_predicate_is_stable(find_call, ctx) {
        return false;
    }
    let mut child = node;
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && !is_inline_jsx_function(ancestor, ctx)
        {
            return false;
        }
        match ancestor.kind() {
            AstKind::LogicalExpression(logical)
                if logical.operator == LogicalOperator::And
                    && logical.right.span().contains_inclusive(child.span()) =>
            {
                if positive_find_test(&logical.left, find_call, ctx) {
                    return true;
                }
            }
            AstKind::ConditionalExpression(conditional) => {
                if (conditional
                    .consequent
                    .span()
                    .contains_inclusive(child.span())
                    && positive_find_test(&conditional.test, find_call, ctx))
                    || (conditional
                        .alternate
                        .span()
                        .contains_inclusive(child.span())
                        && negative_find_test(&conditional.test, find_call, ctx))
                {
                    return true;
                }
            }
            AstKind::IfStatement(statement) => {
                if (statement.consequent.span().contains_inclusive(child.span())
                    && positive_find_test(&statement.test, find_call, ctx))
                    || (statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| alternate.span().contains_inclusive(child.span()))
                        && negative_find_test(&statement.test, find_call, ctx))
                {
                    return true;
                }
            }
            AstKind::BlockStatement(block) => {
                for statement in &block.body {
                    if statement.span().start >= child.span().start {
                        break;
                    }
                    if early_exit_guard_test(statement)
                        .is_some_and(|test| negative_find_test(test, find_call, ctx))
                    {
                        return true;
                    }
                }
            }
            _ => {}
        }
        child = ancestor;
    }
    false
}

fn find_predicate_is_stable(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    let Some(predicate) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    match predicate.get_inner_expression() {
        Expression::Identifier(_) => true,
        expression if expression.as_member_expression().is_some() => true,
        expression @ (Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_)) => {
            let predicate_span = expression.span();
            let predicate_source = ctx.source_range(predicate_span);
            let executable_source = predicate_source
                .split_once("=>")
                .map_or(predicate_source, |(_, body)| body);
            if !executable_source.contains('(') {
                return true;
            }
            !ctx.nodes().iter().any(|candidate| {
                if !matches!(candidate.kind(), AstKind::CallExpression(_))
                    || !predicate_span.contains_inclusive(candidate.span())
                {
                    return false;
                }
                for ancestor in ctx.nodes().ancestors(candidate.id()).skip(1) {
                    if ancestor.span() == predicate_span {
                        return true;
                    }
                    if matches!(
                        ancestor.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    ) {
                        return false;
                    }
                }
                false
            })
        }
        _ => false,
    }
}

fn is_inline_jsx_function(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut current = node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::ParenthesizedExpression(_) => current = parent,
            AstKind::JSXExpressionContainer(_) | AstKind::JSXAttribute(_) => return true,
            _ => return false,
        }
    }
}

fn positive_find_test(
    test: &Expression<'_>,
    find_call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let test = test.get_inner_expression();
    if let Expression::CallExpression(call) = test {
        return matching_guard_method(call, find_call, ctx)
            .is_some_and(|method| method != "findIndex");
    }
    if optional_read_proves_find(test, find_call, ctx) {
        return true;
    }
    if let Expression::LogicalExpression(logical) = test {
        return match logical.operator {
            LogicalOperator::And => {
                positive_find_test(&logical.left, find_call, ctx)
                    || positive_find_test(&logical.right, find_call, ctx)
            }
            LogicalOperator::Or => {
                positive_find_test(&logical.left, find_call, ctx)
                    && positive_find_test(&logical.right, find_call, ctx)
            }
            LogicalOperator::Coalesce => false,
        };
    }
    let Expression::BinaryExpression(binary) = test else {
        return false;
    };
    for (candidate, comparison_value, candidate_is_left) in [
        (&binary.left, &binary.right, true),
        (&binary.right, &binary.left, false),
    ] {
        let Expression::CallExpression(call) = candidate.get_inner_expression() else {
            continue;
        };
        let Some(method) = matching_guard_method(call, find_call, ctx) else {
            continue;
        };
        match method {
            "findIndex" => {
                if matches!(binary.operator, BinaryOperator::Inequality | BinaryOperator::StrictInequality)
                    && is_guard_literal_value(comparison_value, -1.0)
                {
                    return true;
                }
                if (binary.operator == BinaryOperator::GreaterEqualThan
                    && candidate_is_left
                    && is_guard_literal_value(comparison_value, 0.0))
                    || (binary.operator == BinaryOperator::LessEqualThan
                        && !candidate_is_left
                        && is_guard_literal_value(comparison_value, 0.0))
                {
                    return true;
                }
            }
            "some" => {
                if (matches!(binary.operator, BinaryOperator::Equality | BinaryOperator::StrictEquality)
                    && is_guard_boolean_value(comparison_value, true))
                    || (matches!(binary.operator, BinaryOperator::Inequality | BinaryOperator::StrictInequality)
                        && is_guard_boolean_value(comparison_value, false))
                {
                    return true;
                }
            }
            "find" | "findLast" => {
                if matches!(binary.operator, BinaryOperator::Inequality | BinaryOperator::StrictInequality)
                    && is_guard_nullish_value(comparison_value)
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn negative_find_test(
    test: &Expression<'_>,
    find_call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let test = test.get_inner_expression();
    if let Expression::LogicalExpression(logical) = test
        && logical.operator == LogicalOperator::Or
    {
        return negative_find_test(&logical.left, find_call, ctx)
            || negative_find_test(&logical.right, find_call, ctx);
    }
    if let Expression::UnaryExpression(unary) = test
        && unary.operator == UnaryOperator::LogicalNot
    {
        return positive_find_test(&unary.argument, find_call, ctx);
    }
    let Expression::BinaryExpression(binary) = test else {
        return false;
    };
    if !matches!(binary.operator, BinaryOperator::Equality | BinaryOperator::StrictEquality) {
        return false;
    }
    [(&binary.left, &binary.right), (&binary.right, &binary.left)]
        .into_iter()
        .any(|(candidate, comparison_value)| {
            matches!(candidate.get_inner_expression(), Expression::CallExpression(call) if matching_guard_method(call, find_call, ctx).is_some_and(|method| method == "find" || method == "findLast"))
                && is_guard_nullish_value(comparison_value)
        })
}

fn matching_guard_method(
    candidate: &CallExpression<'_>,
    find_call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<&'static str> {
    if !find_predicate_is_stable(candidate, ctx) {
        return None;
    }
    let candidate_member = candidate.callee.get_member_expr()?;
    let find_member = find_call.callee.get_member_expr()?;
    let method = match candidate_member.static_property_name()?.as_ref() {
        "find" => "find",
        "findLast" => "findLast",
        "some" => "some",
        "findIndex" => "findIndex",
        _ => return None,
    };
    if matches!(method, "some" | "findIndex") && candidate_member.is_computed() {
        return None;
    }
    let candidate_predicate = candidate.arguments.first()?.as_expression()?;
    let find_predicate = find_call.arguments.first()?.as_expression()?;
    (normalized_expression_source(ctx.source_range(candidate_member.object().span()))
        == normalized_expression_source(ctx.source_range(find_member.object().span()))
        && normalized_expression_source(ctx.source_range(candidate_predicate.span()))
            == normalized_expression_source(ctx.source_range(find_predicate.span())))
    .then_some(method)
}

fn optional_read_proves_find(
    mut expression: &Expression<'_>,
    find_call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut has_optional_read = false;
    loop {
        let Some(member) = expression.get_inner_expression().as_member_expression() else {
            break;
        };
        has_optional_read |= member.optional();
        expression = member.object();
    }
    has_optional_read
        && matches!(expression.get_inner_expression(), Expression::CallExpression(call) if matching_guard_method(call, find_call, ctx).is_some_and(|method| method == "find" || method == "findLast"))
}

fn is_guard_nullish_value(expression: &Expression<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::NullLiteral(_))
        || matches!(expression.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "undefined")
}

fn is_guard_boolean_value(expression: &Expression<'_>, expected: bool) -> bool {
    matches!(expression.get_inner_expression(), Expression::BooleanLiteral(literal) if literal.value == expected)
}

fn is_guard_literal_value(expression: &Expression<'_>, expected: f64) -> bool {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(literal) => literal.value == expected,
        Expression::UnaryExpression(unary)
            if unary.operator == UnaryOperator::UnaryNegation && expected == -1.0 =>
        {
            matches!(unary.argument.get_inner_expression(), Expression::NumericLiteral(literal) if literal.value == 1.0)
        }
        _ => false,
    }
}

fn early_exit_guard_test<'a>(
    statement: &'a oxc_ast::ast::Statement<'a>,
) -> Option<&'a Expression<'a>> {
    let oxc_ast::ast::Statement::IfStatement(statement) = statement else {
        return None;
    };
    if statement.alternate.is_some() || !statement_always_exits(&statement.consequent) {
        return None;
    }
    Some(&statement.test)
}

fn normalized_expression_source(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .replace("?.", ".")
}
