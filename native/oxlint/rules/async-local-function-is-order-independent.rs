fn async_local_function_is_order_independent(
    function_id: oxc_syntax::node::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    match function_node.kind() {
        oxc_ast::AstKind::Function(function) => {
            let Some(body) = function.body.as_deref() else {
                return false;
            };
            async_function_body_is_order_independent(&function.params, function.r#async, body, ctx)
        }
        oxc_ast::AstKind::ArrowFunctionExpression(function) => {
            let Some(parameter_names) = async_simple_parameter_names(&function.params) else {
                return false;
            };
            if let Some(expression) = function.get_expression() {
                return if function.r#async {
                    async_expression_is_pure_parameter_expression(expression, &parameter_names)
                } else {
                    async_call_is_order_independent_promise_resolve(
                        expression,
                        &parameter_names,
                        ctx,
                    )
                };
            }
            let Some(body) = function.body.as_function_body() else {
                return false;
            };
            async_statements_are_order_independent(
                &body.statements,
                function.r#async,
                &parameter_names,
                ctx,
            )
        }
        _ => false,
    }
}

fn async_function_body_is_order_independent(
    parameters: &oxc_ast::ast::FormalParameters<'_>,
    is_async: bool,
    body: &oxc_ast::ast::FunctionBody<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let Some(parameter_names) = async_simple_parameter_names(parameters) else {
        return false;
    };
    async_statements_are_order_independent(&body.statements, is_async, &parameter_names, ctx)
}

fn async_simple_parameter_names(
    parameters: &oxc_ast::ast::FormalParameters<'_>,
) -> Option<rustc_hash::FxHashSet<String>> {
    if parameters.rest.is_some() {
        return None;
    }
    parameters
        .items
        .iter()
        .map(|parameter| {
            parameter
                .pattern
                .get_binding_identifier()
                .map(|identifier| identifier.name.to_string())
        })
        .collect()
}

fn async_statements_are_order_independent(
    statements: &[oxc_ast::ast::Statement<'_>],
    is_async: bool,
    parameter_names: &rustc_hash::FxHashSet<String>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_ast::ast::Statement;

    if !is_async {
        let [Statement::ReturnStatement(return_statement)] = statements else {
            return false;
        };
        return return_statement
            .argument
            .as_ref()
            .is_some_and(|expression| {
                async_call_is_order_independent_promise_resolve(expression, parameter_names, ctx)
            });
    }
    for (statement_index, statement) in statements.iter().enumerate() {
        let is_terminal = statement_index + 1 == statements.len();
        if async_statement_is_harmless_promise_resolve_await(statement, parameter_names, ctx) {
            continue;
        }
        if matches!(statement, Statement::ExpressionStatement(expression_statement) if async_expression_is_pure_parameter_expression(&expression_statement.expression, parameter_names))
        {
            continue;
        }
        if async_statement_is_commutative_parameter_mutation(statement, parameter_names) {
            return is_terminal;
        }
        let Statement::ReturnStatement(return_statement) = statement else {
            return false;
        };
        if !is_terminal {
            return false;
        }
        return return_statement.argument.as_ref().is_none_or(|expression| {
            async_expression_is_pure_parameter_expression(expression, parameter_names)
                || async_call_is_order_independent_promise_resolve(expression, parameter_names, ctx)
        });
    }
    true
}

fn async_expression_is_pure_parameter_expression(
    expression: &oxc_ast::ast::Expression<'_>,
    parameter_names: &rustc_hash::FxHashSet<String>,
) -> bool {
    use oxc_ast::ast::Expression;
    use oxc_syntax::operator::UnaryOperator;

    match expression.get_inner_expression() {
        expression if expression.is_literal() => true,
        Expression::Identifier(identifier) => parameter_names.contains(identifier.name.as_str()),
        Expression::BinaryExpression(binary) => {
            async_expression_is_pure_parameter_expression(&binary.left, parameter_names)
                && async_expression_is_pure_parameter_expression(&binary.right, parameter_names)
        }
        Expression::LogicalExpression(logical) => {
            async_expression_is_pure_parameter_expression(&logical.left, parameter_names)
                && async_expression_is_pure_parameter_expression(&logical.right, parameter_names)
        }
        Expression::UnaryExpression(unary) => {
            unary.operator != UnaryOperator::Delete
                && async_expression_is_pure_parameter_expression(&unary.argument, parameter_names)
        }
        Expression::ConditionalExpression(conditional) => {
            async_expression_is_pure_parameter_expression(&conditional.test, parameter_names)
                && async_expression_is_pure_parameter_expression(
                    &conditional.consequent,
                    parameter_names,
                )
                && async_expression_is_pure_parameter_expression(
                    &conditional.alternate,
                    parameter_names,
                )
        }
        Expression::TemplateLiteral(template) => template.expressions.iter().all(|expression| {
            async_expression_is_pure_parameter_expression(expression, parameter_names)
        }),
        _ => false,
    }
}

fn async_call_is_order_independent_promise_resolve(
    expression: &oxc_ast::ast::Expression<'_>,
    parameter_names: &rustc_hash::FxHashSet<String>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_ast::ast::Expression;

    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    if !call.arguments.iter().all(|argument| {
        argument.as_expression().is_some_and(|expression| {
            async_expression_is_pure_parameter_expression(expression, parameter_names)
        })
    }) {
        return false;
    }
    let Some(member) = call.callee.get_inner_expression().get_member_expr() else {
        return false;
    };
    member.static_property_name().as_deref() == Some("resolve")
        && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Promise" && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
}

fn async_statement_is_harmless_promise_resolve_await(
    statement: &oxc_ast::ast::Statement<'_>,
    parameter_names: &rustc_hash::FxHashSet<String>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_ast::ast::{Expression, Statement};

    let Statement::ExpressionStatement(statement) = statement else {
        return false;
    };
    let Expression::AwaitExpression(await_expression) = statement.expression.get_inner_expression()
    else {
        return false;
    };
    async_call_is_order_independent_promise_resolve(
        &await_expression.argument,
        parameter_names,
        ctx,
    )
}

fn async_statement_is_commutative_parameter_mutation(
    statement: &oxc_ast::ast::Statement<'_>,
    parameter_names: &rustc_hash::FxHashSet<String>,
) -> bool {
    use oxc_ast::ast::{Expression, Statement};
    use oxc_syntax::operator::AssignmentOperator;

    let Statement::ExpressionStatement(statement) = statement else {
        return false;
    };
    let Expression::AssignmentExpression(assignment) = statement.expression.get_inner_expression()
    else {
        return false;
    };
    if !matches!(
        assignment.operator,
        AssignmentOperator::Addition
            | AssignmentOperator::Subtraction
            | AssignmentOperator::Multiplication
            | AssignmentOperator::Division
            | AssignmentOperator::Remainder
            | AssignmentOperator::BitwiseAnd
            | AssignmentOperator::BitwiseXOR
            | AssignmentOperator::BitwiseOR
    ) || !assignment.right.get_inner_expression().is_literal()
    {
        return false;
    }
    let Some(member) = assignment.left.as_member_expression() else {
        return false;
    };
    member.static_property_name().is_some()
        && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if parameter_names.contains(identifier.name.as_str()))
}
