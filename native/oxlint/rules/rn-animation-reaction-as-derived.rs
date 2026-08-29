use oxc_ast::{
    AstKind,
    ast::{Argument, ArrowFunctionBody, Expression, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::operator::UnaryOperator;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REANIMATED_MODULE_SOURCE: &str = "react-native-reanimated";
const MESSAGE: &str = "This useAnimatedReaction only copies one shared value into another, so it can miss Reanimated's derived-value dependency tracking.";

#[derive(Debug, Default, Clone)]
pub struct RnAnimationReactionAsDerived;

declare_oxc_lint!(
    /// Prefer useDerivedValue when a Reanimated reaction only copies a shared value.
    RnAnimationReactionAsDerived,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "useAnimatedReaction just copies a value.",
);

impl Rule for RnAnimationReactionAsDerived {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Expression::Identifier(callee) = &call_expression.callee else {
            return;
        };
        if callee.name != "useAnimatedReaction"
            || !ctx.module_record().import_entries.iter().any(|entry| {
                entry.local_name.name() == "useAnimatedReaction"
                    && entry.module_request.name() == REANIMATED_MODULE_SOURCE
            })
        {
            return;
        }
        let Some(reaction_function) = call_expression
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let Some(reaction_expression) = reaction_function_single_expression(reaction_function)
        else {
            return;
        };
        let reaction_expression = unwrap_reaction_discarded_expression(reaction_expression);
        if !is_shared_value_assignment(reaction_expression)
            && !is_shared_value_set_call(reaction_expression)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
    }
}

fn reaction_function_single_expression<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a Expression<'a>> {
    match expression {
        Expression::ArrowFunctionExpression(function) => function.get_expression().or_else(|| {
            let ArrowFunctionBody::FunctionBody(body) = &function.body else {
                return None;
            };
            reaction_statements_single_expression(&body.statements)
        }),
        Expression::FunctionExpression(function) => {
            reaction_statements_single_expression(&function.body.as_deref()?.statements)
        }
        _ => None,
    }
}

fn reaction_statements_single_expression<'a>(
    statements: &'a [Statement<'a>],
) -> Option<&'a Expression<'a>> {
    let mut expression = None;
    for statement in statements {
        if is_no_op_statement(statement) {
            continue;
        }
        let Statement::ExpressionStatement(statement) = statement else {
            return None;
        };
        if expression.replace(&statement.expression).is_some() {
            return None;
        }
    }
    expression
}

fn unwrap_reaction_discarded_expression<'a>(
    mut expression: &'a Expression<'a>,
) -> &'a Expression<'a> {
    loop {
        expression = expression.get_inner_expression();
        match expression {
            Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Void => {
                expression = &unary.argument;
            }
            Expression::SequenceExpression(sequence)
                if sequence.expressions.len() > 1
                    && sequence.expressions[..sequence.expressions.len() - 1]
                        .iter()
                        .all(|expression| expression.get_inner_expression().is_literal()) =>
            {
                expression = sequence
                    .expressions
                    .last()
                    .expect("a sequence with more than one expression has a final expression");
            }
            _ => return expression,
        }
    }
}

fn is_shared_value_assignment(expression: &Expression<'_>) -> bool {
    let Expression::AssignmentExpression(assignment) = expression else {
        return false;
    };
    let Some(member_expression) = assignment.left.as_member_expression() else {
        return false;
    };
    matches!(member_expression.object(), Expression::Identifier(_))
        && member_expression_identifier_property_name(member_expression) == Some("value")
}

fn is_shared_value_set_call(expression: &Expression<'_>) -> bool {
    let Expression::CallExpression(call_expression) = expression else {
        return false;
    };
    call_expression.arguments.len() == 1
        && call_expression
            .callee
            .as_member_expression()
            .is_some_and(|member_expression| {
                member_expression_identifier_property_name(member_expression) == Some("set")
            })
}
