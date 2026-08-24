struct AwaitedStatementInfo {
    awaited_expression_spans: Vec<oxc_span::Span>,
    bound_names: Vec<String>,
}

struct SequentialAwaitReference {
    name: String,
    span: oxc_span::Span,
    node_id: oxc_semantic::NodeId,
}

fn find_sequential_independent_await(
    body: &oxc_ast::ast::FunctionBody<'_>,
    threshold: usize,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_span::GetSpan;
    use std::collections::{HashMap, HashSet};

    let mut tainting_await_indices_by_name: HashMap<String, HashSet<usize>> = HashMap::new();
    let mut seen_await_dependency_sets: Vec<HashSet<usize>> = Vec::new();
    let mut references = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            let oxc_ast::AstKind::IdentifierReference(identifier) = candidate.kind() else {
                return None;
            };
            Some(SequentialAwaitReference {
                name: identifier.name.to_string(),
                span: identifier.span,
                node_id: candidate.id(),
            })
        })
        .collect::<Vec<_>>();
    references.sort_unstable_by_key(|reference| reference.span.start);

    for statement in &body.statements {
        let Some(awaited_info) = get_awaited_statement_info(statement) else {
            let mut bound_names = Vec::new();
            collect_statement_bound_names(statement, &mut bound_names);
            if bound_names.is_empty() {
                continue;
            }
            let referenced_names = collect_reference_names(statement.span(), &references, ctx);
            let inherited_taint = referenced_names
                .iter()
                .filter_map(|name| tainting_await_indices_by_name.get(name))
                .flatten()
                .copied()
                .collect::<HashSet<_>>();
            if inherited_taint.is_empty() {
                continue;
            }
            for bound_name in bound_names {
                tainting_await_indices_by_name.insert(bound_name, inherited_taint.clone());
            }
            continue;
        };

        let referenced_names = awaited_info
            .awaited_expression_spans
            .iter()
            .flat_map(|span| collect_reference_names(*span, &references, ctx))
            .collect::<HashSet<_>>();
        let depends_on_await_indices = referenced_names
            .iter()
            .filter_map(|name| tainting_await_indices_by_name.get(name))
            .flatten()
            .copied()
            .collect::<HashSet<_>>();
        let independent_earlier_await_count = seen_await_dependency_sets
            .iter()
            .enumerate()
            .filter(|(await_index, _)| !depends_on_await_indices.contains(await_index))
            .count();
        if independent_earlier_await_count + 1 >= threshold {
            return true;
        }

        let current_await_index = seen_await_dependency_sets.len();
        seen_await_dependency_sets.push(depends_on_await_indices.clone());
        let mut bound_taint = depends_on_await_indices;
        bound_taint.insert(current_await_index);
        for bound_name in awaited_info.bound_names {
            tainting_await_indices_by_name.insert(bound_name, bound_taint.clone());
        }
    }

    false
}

fn get_awaited_statement_info(
    statement: &oxc_ast::ast::Statement<'_>,
) -> Option<AwaitedStatementInfo> {
    use oxc_ast::ast::{AssignmentTarget, Expression, ForStatementLeft, Statement};
    use oxc_span::GetSpan;

    let mut awaited_expression_spans = Vec::new();
    let mut bound_names = Vec::new();

    match statement {
        Statement::VariableDeclaration(declaration) => {
            for declarator in &declaration.declarations {
                let Some(Expression::AwaitExpression(await_expression)) = declarator.init.as_ref()
                else {
                    continue;
                };
                awaited_expression_spans.push(await_expression.argument.span());
                collect_binding_pattern_names(&declarator.id, &mut bound_names);
            }
        }
        Statement::ExpressionStatement(statement) => match &statement.expression {
            Expression::AwaitExpression(await_expression) => {
                awaited_expression_spans.push(await_expression.argument.span());
            }
            Expression::AssignmentExpression(assignment) => {
                let Expression::AwaitExpression(await_expression) = &assignment.right else {
                    return None;
                };
                awaited_expression_spans.push(await_expression.argument.span());
                if let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left {
                    bound_names.push(identifier.name.to_string());
                }
            }
            _ => return None,
        },
        Statement::ReturnStatement(statement) => {
            let Some(Expression::AwaitExpression(await_expression)) = &statement.argument else {
                return None;
            };
            awaited_expression_spans.push(await_expression.argument.span());
        }
        Statement::ForOfStatement(statement) if statement.r#await => {
            awaited_expression_spans.push(statement.right.span());
            match &statement.left {
                ForStatementLeft::VariableDeclaration(declaration) => {
                    if let Some(declarator) = declaration.declarations.first() {
                        collect_binding_pattern_names(&declarator.id, &mut bound_names);
                    }
                }
                ForStatementLeft::AssignmentTargetIdentifier(identifier) => {
                    bound_names.push(identifier.name.to_string());
                }
                _ => {}
            }
        }
        _ => return None,
    }

    (!awaited_expression_spans.is_empty()).then_some(AwaitedStatementInfo {
        awaited_expression_spans,
        bound_names,
    })
}

fn collect_statement_bound_names(statement: &oxc_ast::ast::Statement<'_>, names: &mut Vec<String>) {
    let oxc_ast::ast::Statement::VariableDeclaration(declaration) = statement else {
        return;
    };
    for declarator in &declaration.declarations {
        collect_binding_pattern_names(&declarator.id, names);
    }
}

fn collect_binding_pattern_names(
    pattern: &oxc_ast::ast::BindingPattern<'_>,
    names: &mut Vec<String>,
) {
    use oxc_ast::ast::BindingPattern;

    match pattern {
        BindingPattern::BindingIdentifier(identifier) => names.push(identifier.name.to_string()),
        BindingPattern::AssignmentPattern(pattern) => {
            collect_binding_pattern_names(&pattern.left, names);
        }
        BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                collect_binding_pattern_names(&property.value, names);
            }
            if let Some(rest) = &pattern.rest {
                collect_binding_pattern_names(&rest.argument, names);
            }
        }
        BindingPattern::ArrayPattern(pattern) => {
            for element in pattern.elements.iter().flatten() {
                collect_binding_pattern_names(element, names);
            }
            if let Some(rest) = &pattern.rest {
                collect_binding_pattern_names(&rest.argument, names);
            }
        }
    }
}

fn collect_reference_names(
    span: oxc_span::Span,
    references: &[SequentialAwaitReference],
    ctx: &crate::context::LintContext<'_>,
) -> std::collections::HashSet<String> {
    let first_reference_index =
        references.partition_point(|reference| reference.span.start < span.start);
    references[first_reference_index..]
        .iter()
        .take_while(|reference| reference.span.start <= span.end)
        .filter_map(|reference| {
            if !span.contains_inclusive(reference.span)
                || is_shadowed_function_parameter(
                    reference.name.as_str(),
                    reference.node_id,
                    span,
                    ctx,
                )
            {
                return None;
            }
            Some(reference.name.clone())
        })
        .collect()
}

fn is_shadowed_function_parameter(
    identifier_name: &str,
    identifier_node_id: oxc_semantic::NodeId,
    root_span: oxc_span::Span,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_span::GetSpan;

    for ancestor in ctx.nodes().ancestors(identifier_node_id) {
        if !root_span.contains_inclusive(ancestor.kind().span()) {
            break;
        }
        let parameters = match ancestor.kind() {
            oxc_ast::AstKind::ArrowFunctionExpression(function) => Some(function.params.as_ref()),
            oxc_ast::AstKind::Function(function) => Some(function.params.as_ref()),
            _ => None,
        };
        let Some(parameters) = parameters else {
            continue;
        };
        let mut parameter_names = Vec::new();
        for parameter in &parameters.items {
            collect_binding_pattern_names(&parameter.pattern, &mut parameter_names);
        }
        if parameter_names.iter().any(|name| name == identifier_name) {
            return true;
        }
    }
    false
}
