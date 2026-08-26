#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum StaticExpressionTruthiness {
    Truthy,
    Falsy,
    Unknown,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum StaticExpressionNullishness {
    Nullish,
    NonNullish,
    Unknown,
}

#[derive(Clone, Copy)]
struct StaticExpressionResultBranch<'a> {
    expression: &'a oxc_ast::ast::Expression<'a>,
    truthiness: StaticExpressionTruthiness,
    nullishness: StaticExpressionNullishness,
}

fn get_static_jsx_descendant_opening_elements<'a>(
    element: &'a oxc_ast::ast::JSXElement<'a>,
) -> Vec<&'a oxc_ast::ast::JSXOpeningElement<'a>> {
    let mut descendants = Vec::new();
    for child in &element.children {
        append_static_jsx_descendant(child, &mut descendants);
    }
    descendants
}

fn append_static_jsx_descendant<'a>(
    child: &'a oxc_ast::ast::JSXChild<'a>,
    descendants: &mut Vec<&'a oxc_ast::ast::JSXOpeningElement<'a>>,
) {
    match child {
        oxc_ast::ast::JSXChild::Element(element) => {
            descendants.push(&element.opening_element);
            for child in &element.children {
                append_static_jsx_descendant(child, descendants);
            }
        }
        oxc_ast::ast::JSXChild::Fragment(fragment) => {
            for child in &fragment.children {
                append_static_jsx_descendant(child, descendants);
            }
        }
        oxc_ast::ast::JSXChild::ExpressionContainer(container) => {
            if let Some(expression) = container.expression.as_expression() {
                append_static_jsx_descendant_expression(expression, descendants);
            }
        }
        oxc_ast::ast::JSXChild::Text(_) | oxc_ast::ast::JSXChild::Spread(_) => {}
    }
}

fn append_static_jsx_descendant_expression<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    descendants: &mut Vec<&'a oxc_ast::ast::JSXOpeningElement<'a>>,
) {
    use oxc_ast::ast::{ArrayExpressionElement, Expression};

    let expression = expression.get_inner_expression();
    match expression {
        Expression::JSXElement(element) => {
            descendants.push(&element.opening_element);
            for child in &element.children {
                append_static_jsx_descendant(child, descendants);
            }
        }
        Expression::JSXFragment(fragment) => {
            for child in &fragment.children {
                append_static_jsx_descendant(child, descendants);
            }
        }
        Expression::ConditionalExpression(conditional) => {
            match read_static_boolean_expression(final_sequence_expression(&conditional.test)) {
                Some(true) => append_static_jsx_descendant_expression(
                    &conditional.consequent,
                    descendants,
                ),
                Some(false) => append_static_jsx_descendant_expression(
                    &conditional.alternate,
                    descendants,
                ),
                None => {
                    append_static_jsx_descendant_expression(
                        &conditional.consequent,
                        descendants,
                    );
                    append_static_jsx_descendant_expression(
                        &conditional.alternate,
                        descendants,
                    );
                }
            }
        }
        Expression::LogicalExpression(_) => {
            for branch in static_expression_result_branches(expression) {
                append_static_jsx_descendant_expression(branch.expression, descendants);
            }
        }
        Expression::ArrayExpression(array) => {
            for element in &array.elements {
                if let Some(expression) = ArrayExpressionElement::as_expression(element) {
                    append_static_jsx_descendant_expression(expression, descendants);
                }
            }
        }
        Expression::SequenceExpression(sequence) => {
            if let Some(expression) = sequence.expressions.last() {
                append_static_jsx_descendant_expression(expression, descendants);
            }
        }
        _ => {}
    }
}

fn final_sequence_expression<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
) -> &'a oxc_ast::ast::Expression<'a> {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::SequenceExpression(sequence) = expression
        && let Some(final_expression) = sequence.expressions.last()
    {
        return final_sequence_expression(final_expression);
    }
    expression
}

fn read_static_boolean_expression(expression: &oxc_ast::ast::Expression<'_>) -> Option<bool> {
    let oxc_ast::ast::Expression::BooleanLiteral(boolean_literal) =
        expression.get_inner_expression()
    else {
        return None;
    };
    Some(boolean_literal.value)
}

fn static_expression_result_branches<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
) -> Vec<StaticExpressionResultBranch<'a>> {
    use oxc_ast::ast::Expression;
    use oxc_syntax::operator::LogicalOperator;

    let expression = final_sequence_expression(expression);
    if let Expression::ConditionalExpression(conditional) = expression {
        let test_branches = static_expression_result_branches(&conditional.test);
        if test_branches
            .iter()
            .all(|branch| branch.truthiness == StaticExpressionTruthiness::Truthy)
        {
            return static_expression_result_branches(&conditional.consequent);
        }
        if test_branches
            .iter()
            .all(|branch| branch.truthiness == StaticExpressionTruthiness::Falsy)
        {
            return static_expression_result_branches(&conditional.alternate);
        }
        let mut branches = static_expression_result_branches(&conditional.consequent);
        branches.extend(static_expression_result_branches(&conditional.alternate));
        return deduplicate_static_expression_result_branches(branches);
    }
    let Expression::LogicalExpression(logical) = expression else {
        return vec![atomic_static_expression_result_branch(expression)];
    };
    let left_branches = static_expression_result_branches(&logical.left);
    let right_branches = static_expression_result_branches(&logical.right);
    let mut result_branches = Vec::new();
    for left_branch in left_branches {
        match logical.operator {
            LogicalOperator::And => {
                if left_branch.truthiness != StaticExpressionTruthiness::Truthy {
                    result_branches.push(StaticExpressionResultBranch {
                        truthiness: StaticExpressionTruthiness::Falsy,
                        ..left_branch
                    });
                }
                if left_branch.truthiness != StaticExpressionTruthiness::Falsy {
                    result_branches.extend(right_branches.iter().copied());
                }
            }
            LogicalOperator::Or => {
                if left_branch.truthiness != StaticExpressionTruthiness::Falsy {
                    result_branches.push(StaticExpressionResultBranch {
                        truthiness: StaticExpressionTruthiness::Truthy,
                        nullishness: StaticExpressionNullishness::NonNullish,
                        ..left_branch
                    });
                }
                if left_branch.truthiness != StaticExpressionTruthiness::Truthy {
                    result_branches.extend(right_branches.iter().copied());
                }
            }
            LogicalOperator::Coalesce => {
                if left_branch.nullishness != StaticExpressionNullishness::Nullish {
                    result_branches.push(StaticExpressionResultBranch {
                        nullishness: StaticExpressionNullishness::NonNullish,
                        ..left_branch
                    });
                }
                if left_branch.nullishness != StaticExpressionNullishness::NonNullish {
                    result_branches.extend(right_branches.iter().copied());
                }
            }
        }
    }
    deduplicate_static_expression_result_branches(result_branches)
}

fn atomic_static_expression_result_branch<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
) -> StaticExpressionResultBranch<'a> {
    use oxc_ast::ast::Expression;

    let (truthiness, nullishness) = match expression {
        Expression::JSXElement(_)
        | Expression::JSXFragment(_)
        | Expression::ArrayExpression(_)
        | Expression::ObjectExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_)
        | Expression::ClassExpression(_)
        | Expression::NewExpression(_)
        | Expression::RegExpLiteral(_) => (
            StaticExpressionTruthiness::Truthy,
            StaticExpressionNullishness::NonNullish,
        ),
        Expression::BooleanLiteral(literal) => (
            if literal.value {
                StaticExpressionTruthiness::Truthy
            } else {
                StaticExpressionTruthiness::Falsy
            },
            StaticExpressionNullishness::NonNullish,
        ),
        Expression::StringLiteral(literal) => (
            if literal.value.is_empty() {
                StaticExpressionTruthiness::Falsy
            } else {
                StaticExpressionTruthiness::Truthy
            },
            StaticExpressionNullishness::NonNullish,
        ),
        Expression::NumericLiteral(literal) => (
            if literal.value == 0.0 || literal.value.is_nan() {
                StaticExpressionTruthiness::Falsy
            } else {
                StaticExpressionTruthiness::Truthy
            },
            StaticExpressionNullishness::NonNullish,
        ),
        Expression::BigIntLiteral(literal) => (
            if literal
                .raw
                .as_ref()
                .is_some_and(|raw| matches!(raw.as_str(), "0" | "0n"))
            {
                StaticExpressionTruthiness::Falsy
            } else {
                StaticExpressionTruthiness::Truthy
            },
            StaticExpressionNullishness::NonNullish,
        ),
        Expression::NullLiteral(_) => (
            StaticExpressionTruthiness::Falsy,
            StaticExpressionNullishness::Nullish,
        ),
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::Void =>
        {
            (
                StaticExpressionTruthiness::Falsy,
                StaticExpressionNullishness::Nullish,
            )
        }
        _ => (
            StaticExpressionTruthiness::Unknown,
            StaticExpressionNullishness::Unknown,
        ),
    };
    StaticExpressionResultBranch {
        expression,
        truthiness,
        nullishness,
    }
}

fn deduplicate_static_expression_result_branches<'a>(
    branches: Vec<StaticExpressionResultBranch<'a>>,
) -> Vec<StaticExpressionResultBranch<'a>> {
    use oxc_span::GetSpan;
    use rustc_hash::FxHashSet;

    let mut seen_branches = FxHashSet::default();
    branches
        .into_iter()
        .filter(|branch| {
            seen_branches.insert((
                branch.expression.span(),
                branch.truthiness,
                branch.nullishness,
            ))
        })
        .collect()
}
