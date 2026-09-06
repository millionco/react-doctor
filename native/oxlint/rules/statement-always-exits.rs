fn statement_always_exits(statement: &oxc_ast::ast::Statement<'_>) -> bool {
    use oxc_ast::ast::Statement;

    match statement {
        Statement::ReturnStatement(_) | Statement::ThrowStatement(_) => true,
        Statement::IfStatement(statement) => {
            if let Some(test_value) = static_literal_truthiness(&statement.test) {
                return if test_value {
                    statement_always_exits(&statement.consequent)
                } else {
                    statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| statement_always_exits(alternate))
                };
            }
            statement.alternate.as_ref().is_some_and(|alternate| {
                statement_always_exits(&statement.consequent)
                    && statement_always_exits(alternate)
            })
        }
        Statement::TryStatement(statement) => {
            if statement
                .finalizer
                .as_ref()
                .is_some_and(|finalizer| statement_block_always_exits(finalizer))
            {
                return true;
            }
            statement_block_always_exits(&statement.block)
                && statement
                    .handler
                    .as_ref()
                    .is_none_or(|handler| statement_block_always_exits(&handler.body))
        }
        Statement::DoWhileStatement(statement) => statement_always_exits(&statement.body),
        Statement::WhileStatement(statement) => {
            static_literal_truthiness(&statement.test) == Some(true)
                && statement_always_exits(&statement.body)
        }
        Statement::ForStatement(statement) => {
            statement
                .test
                .as_ref()
                .is_none_or(|test| static_literal_truthiness(test) == Some(true))
                && statement_always_exits(&statement.body)
        }
        Statement::BlockStatement(statement) => statement_block_always_exits(statement),
        _ => false,
    }
}

fn statement_block_always_exits(statement: &oxc_ast::ast::BlockStatement<'_>) -> bool {
    statement.body.iter().any(statement_always_exits)
}
