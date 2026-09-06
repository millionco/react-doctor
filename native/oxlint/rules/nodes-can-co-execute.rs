#[derive(Clone)]
struct PredicateValueConstraint {
    excluded_value_keys: std::collections::HashSet<String>,
    required_value_key: Option<String>,
    source_test_ids: Vec<oxc_semantic::NodeId>,
}

struct PredicateConstraints {
    is_impossible: bool,
    values: std::collections::HashMap<oxc_semantic::SymbolId, PredicateValueConstraint>,
}

fn nodes_can_co_execute(
    left: &crate::AstNode<'_>,
    right: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let left_constraints = collect_node_predicate_constraints(left, ctx);
    let right_constraints = collect_node_predicate_constraints(right, ctx);
    if left_constraints.is_impossible || right_constraints.is_impossible {
        return false;
    }
    for (symbol_id, left_value) in &left_constraints.values {
        let Some(right_value) = right_constraints.values.get(symbol_id) else {
            continue;
        };
        let constraints_conflict = match (
            left_value.required_value_key.as_ref(),
            right_value.required_value_key.as_ref(),
        ) {
            (Some(left_required), Some(right_required)) => left_required != right_required,
            (Some(left_required), None) => right_value.excluded_value_keys.contains(left_required),
            (None, Some(right_required)) => left_value.excluded_value_keys.contains(right_required),
            (None, None) => false,
        };
        if constraints_conflict
            && !predicate_symbol_was_written_between_tests(*symbol_id, left_value, right_value, ctx)
        {
            return false;
        }
    }
    true
}

fn node_has_impossible_predicate_constraints(
    node: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    collect_node_predicate_constraints(node, ctx).is_impossible
}

fn collect_node_predicate_constraints(
    node: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> PredicateConstraints {
    use oxc_span::GetSpan;
    let mut constraints = std::collections::HashMap::new();
    let mut is_impossible = false;
    let mut child = node;
    for parent in ctx.nodes().ancestors(node.id()) {
        let child_span = child.span();
        match parent.kind() {
            oxc_ast::AstKind::IfStatement(statement) => {
                if statement.consequent.span() == child_span {
                    is_impossible |=
                        add_predicate_constraint(&mut constraints, &statement.test, true, ctx);
                } else if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span() == child_span)
                {
                    is_impossible |=
                        add_predicate_constraint(&mut constraints, &statement.test, false, ctx);
                }
            }
            oxc_ast::AstKind::ConditionalExpression(expression) => {
                if expression.consequent.span() == child_span {
                    is_impossible |=
                        add_predicate_constraint(&mut constraints, &expression.test, true, ctx);
                } else if expression.alternate.span() == child_span {
                    is_impossible |=
                        add_predicate_constraint(&mut constraints, &expression.test, false, ctx);
                }
            }
            oxc_ast::AstKind::LogicalExpression(expression)
                if expression.right.span() == child_span =>
            {
                let required_truthiness = match expression.operator {
                    oxc_syntax::operator::LogicalOperator::And => Some(true),
                    oxc_syntax::operator::LogicalOperator::Or => Some(false),
                    oxc_syntax::operator::LogicalOperator::Coalesce => None,
                };
                if let Some(required_truthiness) = required_truthiness {
                    is_impossible |= add_predicate_constraint(
                        &mut constraints,
                        &expression.left,
                        required_truthiness,
                        ctx,
                    );
                }
            }
            oxc_ast::AstKind::BlockStatement(block) => {
                let containing_statement_index = block
                    .body
                    .iter()
                    .position(|statement| statement.span().contains_inclusive(child_span));
                if let Some(containing_statement_index) = containing_statement_index {
                    for statement in block.body.iter().take(containing_statement_index) {
                        let oxc_ast::ast::Statement::IfStatement(statement) = statement else {
                            continue;
                        };
                        if statement_always_exits(&statement.consequent) {
                            is_impossible |= add_predicate_constraint(
                                &mut constraints,
                                &statement.test,
                                false,
                                ctx,
                            );
                        }
                        if statement
                            .alternate
                            .as_ref()
                            .is_some_and(|alternate| statement_always_exits(alternate))
                        {
                            is_impossible |= add_predicate_constraint(
                                &mut constraints,
                                &statement.test,
                                true,
                                ctx,
                            );
                        }
                    }
                }
            }
            _ => {}
        }
        child = parent;
    }
    PredicateConstraints {
        is_impossible,
        values: constraints,
    }
}

fn add_predicate_constraint(
    constraints: &mut std::collections::HashMap<oxc_semantic::SymbolId, PredicateValueConstraint>,
    expression: &oxc_ast::ast::Expression<'_>,
    is_truthy: bool,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let Some((symbol_id, value_key, is_equality)) =
        predicate_constraint(expression, is_truthy, ctx)
    else {
        return false;
    };
    let value = constraints
        .entry(symbol_id)
        .or_insert_with(|| PredicateValueConstraint {
            excluded_value_keys: std::collections::HashSet::new(),
            required_value_key: None,
            source_test_ids: Vec::new(),
        });
    value.source_test_ids.push(expression.node_id());
    if is_equality {
        if value
            .required_value_key
            .as_ref()
            .is_some_and(|required| required != &value_key)
            || value.excluded_value_keys.contains(&value_key)
        {
            return true;
        }
        value.required_value_key = Some(value_key);
    } else {
        if value.required_value_key.as_ref() == Some(&value_key) {
            return true;
        }
        value.excluded_value_keys.insert(value_key);
    }
    false
}

fn predicate_constraint(
    expression: &oxc_ast::ast::Expression<'_>,
    is_truthy: bool,
    ctx: &crate::context::LintContext<'_>,
) -> Option<(oxc_semantic::SymbolId, String, bool)> {
    let mut current = expression.get_inner_expression();
    let mut expected_value = is_truthy;
    while let oxc_ast::ast::Expression::UnaryExpression(unary) = current
        && unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot
    {
        expected_value = !expected_value;
        current = unary.argument.get_inner_expression();
    }
    if let oxc_ast::ast::Expression::Identifier(identifier) = current {
        let symbol_id = predicate_const_identifier_root_symbol(identifier, ctx)?;
        return Some((symbol_id, "boolean:true".to_string(), expected_value));
    }
    let oxc_ast::ast::Expression::BinaryExpression(binary) = current else {
        return None;
    };
    let (comparison_is_equality, comparison_is_loose) = match binary.operator {
        oxc_syntax::operator::BinaryOperator::Equality => (true, true),
        oxc_syntax::operator::BinaryOperator::StrictEquality => (true, false),
        oxc_syntax::operator::BinaryOperator::Inequality => (false, true),
        oxc_syntax::operator::BinaryOperator::StrictInequality => (false, false),
        _ => return None,
    };
    for (identifier_expression, literal_expression) in
        [(&binary.left, &binary.right), (&binary.right, &binary.left)]
    {
        let oxc_ast::ast::Expression::Identifier(identifier) =
            identifier_expression.get_inner_expression()
        else {
            continue;
        };
        let value_key = predicate_literal_value_key(literal_expression.get_inner_expression())?;
        if comparison_is_loose && !value_key.starts_with("boolean:") {
            continue;
        }
        let symbol_id = predicate_const_identifier_root_symbol(identifier, ctx)?;
        return Some((
            symbol_id,
            value_key,
            comparison_is_equality == expected_value,
        ));
    }
    None
}

fn predicate_literal_value_key(expression: &oxc_ast::ast::Expression<'_>) -> Option<String> {
    match expression {
        oxc_ast::ast::Expression::BooleanLiteral(literal) => {
            Some(format!("boolean:{}", literal.value))
        }
        oxc_ast::ast::Expression::NumericLiteral(literal) => {
            Some(format!("number:{}", literal.value))
        }
        oxc_ast::ast::Expression::StringLiteral(literal) => {
            Some(format!("string:{}", literal.value))
        }
        oxc_ast::ast::Expression::NullLiteral(_) => Some("object:null".to_string()),
        _ => None,
    }
}

fn predicate_const_identifier_root_symbol(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let mut symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let mut visited = Vec::new();
    loop {
        if visited.contains(&symbol_id) {
            return None;
        }
        visited.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return Some(symbol_id);
        };
        let parent = ctx.nodes().parent_node(declaration.id());
        if !matches!(
            parent.kind(),
            oxc_ast::AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
        ) || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return Some(symbol_id);
        }
        let Some(oxc_ast::ast::Expression::Identifier(source)) = declarator
            .init
            .as_ref()
            .map(oxc_ast::ast::Expression::get_inner_expression)
        else {
            return Some(symbol_id);
        };
        let Some(source_symbol_id) = ctx
            .scoping()
            .get_reference(source.reference_id())
            .symbol_id()
        else {
            return Some(symbol_id);
        };
        symbol_id = source_symbol_id;
    }
}

fn predicate_symbol_was_written_between_tests(
    symbol_id: oxc_semantic::SymbolId,
    left: &PredicateValueConstraint,
    right: &PredicateValueConstraint,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    left.source_test_ids.iter().any(|left_test_id| {
        right.source_test_ids.iter().any(|right_test_id| {
            let left_test = ctx.nodes().get_node(*left_test_id);
            let right_test = ctx.nodes().get_node(*right_test_id);
            let left_owner =
                crate::ast_util::get_enclosing_function(left_test, ctx).map(crate::AstNode::id);
            if crate::ast_util::get_enclosing_function(right_test, ctx).map(crate::AstNode::id)
                != left_owner
            {
                return false;
            }
            let lower_start = left_test.span().start.min(right_test.span().start);
            let upper_start = left_test.span().start.max(right_test.span().start);
            lower_start != upper_start
                && ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| {
                        let reference_node = ctx.nodes().get_node(reference.node_id());
                        reference.is_write()
                            && reference_node.span().start > lower_start
                            && reference_node.span().start < upper_start
                            && crate::ast_util::get_enclosing_function(reference_node, ctx)
                                .map(crate::AstNode::id)
                                == left_owner
                    })
        })
    })
}
