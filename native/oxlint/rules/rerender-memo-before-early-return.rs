use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, Expression, FunctionBody, FunctionType, MemberExpression,
        Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This rebuilds the JSX whenever its dependencies change even on renders that take the early return, so move the JSX into a child component rendered after the early return to skip it";

#[derive(Debug, Default, Clone)]
pub struct RerenderMemoBeforeEarlyReturn;

declare_oxc_lint!(
    /// Warns when useMemo builds JSX before a component can return early.
    RerenderMemoBeforeEarlyReturn,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when useMemo builds JSX before a component can return early.",
);

impl Rule for RerenderMemoBeforeEarlyReturn {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut return_statement_ids_by_function = FxHashMap::<NodeId, Vec<NodeId>>::default();
        let mut identifier_reference_ids = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::ReturnStatement(_) => {
                    if let Some(function_id) = nearest_function_id(node.id(), ctx) {
                        return_statement_ids_by_function
                            .entry(function_id)
                            .or_default()
                            .push(node.id());
                    }
                }
                AstKind::IdentifierReference(_) => identifier_reference_ids.push(node.id()),
                _ => {}
            }
        }
        identifier_reference_ids.sort_unstable_by_key(|node_id| {
            let span = ctx.nodes().get_node(*node_id).span();
            (span.start, span.end)
        });

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function)
                    if function.r#type == FunctionType::FunctionDeclaration
                        && function.id.as_ref().is_some_and(|identifier| {
                            is_uppercase_name(identifier.name.as_str())
                        }) =>
                {
                    if let Some(body) = &function.body {
                        inspect_component_body(
                            body,
                            &return_statement_ids_by_function,
                            &identifier_reference_ids,
                            ctx,
                        );
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                        continue;
                    };
                    if !is_uppercase_name(identifier.name.as_str()) {
                        continue;
                    }
                    match &declarator.init {
                        Some(Expression::ArrowFunctionExpression(function)) => {
                            if let Some(body) = function.body.as_function_body() {
                                inspect_component_body(
                                    body,
                                    &return_statement_ids_by_function,
                                    &identifier_reference_ids,
                                    ctx,
                                );
                            }
                        }
                        Some(Expression::FunctionExpression(function)) => {
                            if let Some(body) = &function.body {
                                inspect_component_body(
                                    body,
                                    &return_statement_ids_by_function,
                                    &identifier_reference_ids,
                                    ctx,
                                );
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
}

fn inspect_component_body<'a>(
    body: &'a FunctionBody<'a>,
    return_statement_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    identifier_reference_ids: &[NodeId],
    ctx: &LintContext<'a>,
) {
    let mut memo_span = None;
    let mut callback_guard_tests = Vec::new();
    let mut memo_consumer_names = FxHashSet::default();
    let mut assigned_expression_cache = PossibleAssignedExpressionCache::default();

    for statement in &body.statements {
        if memo_span.is_none() {
            let Statement::VariableDeclaration(declaration) = statement else {
                continue;
            };
            for declarator in &declaration.declarations {
                let Some(Expression::CallExpression(memo_call)) = &declarator.init else {
                    continue;
                };
                if call_callee_name(memo_call) != Some("useMemo") {
                    continue;
                }
                let Some(callback) = memo_call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                else {
                    continue;
                };
                let mut visited_expression_spans = FxHashSet::default();
                let mut visited_function_ids = FxHashSet::default();
                if !function_returns_jsx(
                    callback,
                    return_statement_ids_by_function,
                    ctx,
                    &mut assigned_expression_cache,
                    &mut visited_expression_spans,
                    &mut visited_function_ids,
                ) {
                    continue;
                }
                memo_span = Some(declarator.span);
                callback_guard_tests = collect_leading_callback_guard_tests(callback);
                if let BindingPattern::BindingIdentifier(identifier) = &declarator.id {
                    memo_consumer_names.insert(identifier.name.to_string());
                }
                break;
            }
            continue;
        }

        add_transitive_consumer_names(
            statement,
            &mut memo_consumer_names,
            identifier_reference_ids,
            ctx,
        );
        let Statement::IfStatement(if_statement) = statement else {
            continue;
        };
        if memo_consumer_names.is_empty()
            || !has_early_return_not_using_memo(
                if_statement,
                &memo_consumer_names,
                identifier_reference_ids,
                ctx,
            )
            || expression_references_any_name(
                &if_statement.test,
                &memo_consumer_names,
                identifier_reference_ids,
                ctx,
            )
            || callback_guard_tests
                .iter()
                .any(|guard_test| conditions_are_structurally_equal(&if_statement.test, guard_test))
        {
            continue;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(memo_span.unwrap()));
        return;
    }
}

fn call_callee_name<'a>(call: &'a oxc_ast::ast::CallExpression<'a>) -> Option<&'a str> {
    match &call.callee {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => match expression.as_member_expression()? {
            MemberExpression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
            MemberExpression::ComputedMemberExpression(member) => {
                let Expression::Identifier(identifier) = &member.expression else {
                    return None;
                };
                Some(identifier.name.as_str())
            }
            MemberExpression::PrivateFieldExpression(_) => None,
        },
    }
}

fn function_returns_jsx<'a>(
    callback: &'a Expression<'a>,
    return_statement_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut PossibleAssignedExpressionCache<'a>,
    visited_expression_spans: &mut FxHashSet<Span>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    match callback {
        Expression::ArrowFunctionExpression(function) => function_returns_matching_expression(
            function.node_id.get(),
            function.get_expression(),
            return_statement_ids_by_function,
            ctx,
            assigned_expression_cache,
            visited_expression_spans,
            visited_function_ids,
        ),
        Expression::FunctionExpression(function) => function_returns_matching_expression(
            function.node_id.get(),
            None,
            return_statement_ids_by_function,
            ctx,
            assigned_expression_cache,
            visited_expression_spans,
            visited_function_ids,
        ),
        _ => false,
    }
}

fn function_returns_matching_expression<'a>(
    function_id: NodeId,
    expression_body: Option<&'a Expression<'a>>,
    return_statement_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut PossibleAssignedExpressionCache<'a>,
    visited_expression_spans: &mut FxHashSet<Span>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    if !visited_function_ids.insert(function_id) {
        return false;
    }
    let matches = if let Some(expression) = expression_body {
        expression_matches_jsx(
            expression,
            return_statement_ids_by_function,
            ctx,
            assigned_expression_cache,
            visited_expression_spans,
            visited_function_ids,
        )
    } else {
        return_statement_ids_by_function
            .get(&function_id)
            .into_iter()
            .flatten()
            .any(|return_statement_id| {
                let AstKind::ReturnStatement(return_statement) =
                    ctx.nodes().get_node(*return_statement_id).kind()
                else {
                    return false;
                };
                return_statement
                    .argument
                    .as_ref()
                    .is_some_and(|expression| {
                        expression_matches_jsx(
                            expression,
                            return_statement_ids_by_function,
                            ctx,
                            assigned_expression_cache,
                            visited_expression_spans,
                            visited_function_ids,
                        )
                    })
            })
    };
    visited_function_ids.remove(&function_id);
    matches
}

fn expression_matches_jsx<'a>(
    expression: &'a Expression<'a>,
    return_statement_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut PossibleAssignedExpressionCache<'a>,
    visited_expression_spans: &mut FxHashSet<Span>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if !visited_expression_spans.insert(expression.span()) {
        return false;
    }
    let matches = match expression {
        Expression::JSXElement(_) | Expression::JSXFragment(_) => true,
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                resolve_cfg_assigned_expressions_for_reference(
                    identifier,
                    symbol_id,
                    ctx,
                    assigned_expression_cache,
                )
                .into_iter()
                .any(|assigned_expression| {
                    !matches!(
                        assigned_expression.get_inner_expression(),
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    ) && expression_matches_jsx(
                        assigned_expression,
                        return_statement_ids_by_function,
                        ctx,
                        assigned_expression_cache,
                        visited_expression_spans,
                        visited_function_ids,
                    )
                })
            }),
        Expression::CallExpression(call) if call.arguments.is_empty() => {
            let Expression::Identifier(callee) = &call.callee else {
                visited_expression_spans.remove(&expression.span());
                return false;
            };
            local_zero_argument_function(callee, ctx).is_some_and(
                |(function_id, expression_body)| {
                    function_returns_matching_expression(
                        function_id,
                        expression_body,
                        return_statement_ids_by_function,
                        ctx,
                        assigned_expression_cache,
                        visited_expression_spans,
                        visited_function_ids,
                    )
                },
            )
        }
        Expression::ConditionalExpression(conditional) => {
            expression_matches_jsx(
                &conditional.consequent,
                return_statement_ids_by_function,
                ctx,
                assigned_expression_cache,
                visited_expression_spans,
                visited_function_ids,
            ) || expression_matches_jsx(
                &conditional.alternate,
                return_statement_ids_by_function,
                ctx,
                assigned_expression_cache,
                visited_expression_spans,
                visited_function_ids,
            )
        }
        Expression::LogicalExpression(logical) => {
            expression_matches_jsx(
                &logical.left,
                return_statement_ids_by_function,
                ctx,
                assigned_expression_cache,
                visited_expression_spans,
                visited_function_ids,
            ) || expression_matches_jsx(
                &logical.right,
                return_statement_ids_by_function,
                ctx,
                assigned_expression_cache,
                visited_expression_spans,
                visited_function_ids,
            )
        }
        _ => false,
    };
    visited_expression_spans.remove(&expression.span());
    matches
}

fn local_zero_argument_function<'a>(
    callee: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<(NodeId, Option<&'a Expression<'a>>)> {
    let symbol_id = ctx
        .scoping()
        .get_reference(callee.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function)
            if function.is_function_declaration()
                && !function.r#async
                && !function.generator
                && function.params.items.is_empty() =>
        {
            Some((function.node_id.get(), None))
        }
        AstKind::VariableDeclarator(declarator)
            if matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable) if variable.kind.is_const()
            ) =>
        {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function)
                    if !function.r#async && function.params.items.is_empty() =>
                {
                    Some((function.node_id.get(), function.get_expression()))
                }
                Expression::FunctionExpression(function)
                    if !function.r#async
                        && !function.generator
                        && function.params.items.is_empty() =>
                {
                    Some((function.node_id.get(), None))
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn collect_leading_callback_guard_tests<'a>(
    callback: &'a Expression<'a>,
) -> Vec<&'a Expression<'a>> {
    let body = match callback {
        Expression::ArrowFunctionExpression(function) => function.body.as_function_body(),
        Expression::FunctionExpression(function) => function.body.as_deref(),
        _ => None,
    };
    let Some(body) = body else {
        return Vec::new();
    };
    let mut guard_tests = Vec::new();
    for statement in &body.statements {
        let Statement::IfStatement(if_statement) = statement else {
            break;
        };
        let is_immediate_return = match &if_statement.consequent {
            Statement::ReturnStatement(_) => true,
            Statement::BlockStatement(block) => {
                matches!(block.body.as_slice(), [Statement::ReturnStatement(_)])
            }
            _ => false,
        };
        if !is_immediate_return {
            break;
        }
        guard_tests.push(&if_statement.test);
    }
    guard_tests
}

fn add_transitive_consumer_names(
    statement: &Statement<'_>,
    memo_consumer_names: &mut FxHashSet<String>,
    identifier_reference_ids: &[NodeId],
    ctx: &LintContext<'_>,
) {
    let Statement::VariableDeclaration(declaration) = statement else {
        return;
    };
    for declarator in &declaration.declarations {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            continue;
        };
        let Some(initializer) = &declarator.init else {
            continue;
        };
        if expression_references_any_name(
            initializer,
            memo_consumer_names,
            identifier_reference_ids,
            ctx,
        ) {
            memo_consumer_names.insert(identifier.name.to_string());
        }
    }
}

fn has_early_return_not_using_memo(
    if_statement: &oxc_ast::ast::IfStatement<'_>,
    memo_consumer_names: &FxHashSet<String>,
    identifier_reference_ids: &[NodeId],
    ctx: &LintContext<'_>,
) -> bool {
    match &if_statement.consequent {
        Statement::ReturnStatement(return_statement) => {
            return_statement.argument.as_ref().is_none_or(|argument| {
                !expression_references_any_name(
                    argument,
                    memo_consumer_names,
                    identifier_reference_ids,
                    ctx,
                )
            })
        }
        Statement::BlockStatement(block) => block.body.iter().any(|statement| {
            let Statement::ReturnStatement(return_statement) = statement else {
                return false;
            };
            return_statement.argument.as_ref().is_none_or(|argument| {
                !expression_references_any_name(
                    argument,
                    memo_consumer_names,
                    identifier_reference_ids,
                    ctx,
                )
            })
        }),
        _ => false,
    }
}

fn expression_references_any_name(
    expression: &Expression<'_>,
    names: &FxHashSet<String>,
    identifier_reference_ids: &[NodeId],
    ctx: &LintContext<'_>,
) -> bool {
    let expression_span = expression.get_inner_expression().span();
    let start_index = identifier_reference_ids.partition_point(|node_id| {
        ctx.nodes().get_node(*node_id).span().start < expression_span.start
    });
    identifier_reference_ids[start_index..]
        .iter()
        .map(|node_id| ctx.nodes().get_node(*node_id))
        .take_while(|node| node.span().start <= expression_span.end)
        .any(|node| {
            let AstKind::IdentifierReference(identifier) = node.kind() else {
                return false;
            };
            expression_span.contains_inclusive(node.span())
                && names.contains(identifier.name.as_str())
                && !identifier_is_shadowed_function_parameter(
                    node,
                    identifier.name.as_str(),
                    expression_span,
                    ctx,
                )
        })
}

fn identifier_is_shadowed_function_parameter(
    identifier_node: &AstNode<'_>,
    name: &str,
    expression_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(identifier_node.id())
        .take_while(|ancestor| expression_span.contains_inclusive(ancestor.span()))
        .any(|ancestor| {
            let parameters = match ancestor.kind() {
                AstKind::Function(function) => Some(&function.params),
                AstKind::ArrowFunctionExpression(function) => Some(&function.params),
                _ => None,
            };
            parameters.is_some_and(|parameters| {
                parameters.items.iter().any(|parameter| {
                    let mut parameter_names = FxHashSet::default();
                    collect_binding_pattern_names(&parameter.pattern, &mut parameter_names);
                    parameter_names.contains(name)
                })
            })
        })
}

fn conditions_are_structurally_equal(first: &Expression<'_>, second: &Expression<'_>) -> bool {
    let first = first.get_inner_expression();
    let second = second.get_inner_expression();
    match (first, second) {
        (Expression::LogicalExpression(first), Expression::LogicalExpression(second)) => {
            first.operator == second.operator
                && conditions_are_structurally_equal(&first.left, &second.left)
                && conditions_are_structurally_equal(&first.right, &second.right)
        }
        (Expression::BinaryExpression(first), Expression::BinaryExpression(second)) => {
            first.operator == second.operator
                && conditions_are_structurally_equal(&first.left, &second.left)
                && conditions_are_structurally_equal(&first.right, &second.right)
        }
        (Expression::UnaryExpression(first), Expression::UnaryExpression(second)) => {
            first.operator == second.operator
                && conditions_are_structurally_equal(&first.argument, &second.argument)
        }
        _ => expressions_are_structurally_equal(first, second),
    }
}

fn expressions_are_structurally_equal(first: &Expression<'_>, second: &Expression<'_>) -> bool {
    let first = first.get_inner_expression();
    let second = second.get_inner_expression();
    match (first, second) {
        (Expression::ThisExpression(_), Expression::ThisExpression(_))
        | (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::Identifier(first), Expression::Identifier(second)) => {
            first.name == second.name
        }
        (Expression::PrivateFieldExpression(first), Expression::PrivateFieldExpression(second)) => {
            first.field.name == second.field.name
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
        (Expression::BigIntLiteral(first), Expression::BigIntLiteral(second)) => {
            first.value == second.value
        }
        (Expression::RegExpLiteral(first), Expression::RegExpLiteral(second)) => {
            first.regex.pattern.text == second.regex.pattern.text
                && first.regex.flags == second.regex.flags
        }
        (Expression::CallExpression(first), Expression::CallExpression(second)) => {
            expressions_are_structurally_equal(&first.callee, &second.callee)
                && first.arguments.len() == second.arguments.len()
                && first.arguments.iter().zip(&second.arguments).all(
                    |(first_argument, second_argument)| {
                        let (Some(first_argument), Some(second_argument)) = (
                            first_argument.as_expression(),
                            second_argument.as_expression(),
                        ) else {
                            return false;
                        };
                        expressions_are_structurally_equal(first_argument, second_argument)
                    },
                )
        }
        _ => match (first.as_member_expression(), second.as_member_expression()) {
            (Some(first), Some(second)) if first.is_computed() == second.is_computed() => {
                expressions_are_structurally_equal(first.object(), second.object())
                    && match (first, second) {
                        (
                            MemberExpression::StaticMemberExpression(first),
                            MemberExpression::StaticMemberExpression(second),
                        ) => first.property.name == second.property.name,
                        (
                            MemberExpression::ComputedMemberExpression(first),
                            MemberExpression::ComputedMemberExpression(second),
                        ) => expressions_are_structurally_equal(
                            &first.expression,
                            &second.expression,
                        ),
                        (
                            MemberExpression::PrivateFieldExpression(first),
                            MemberExpression::PrivateFieldExpression(second),
                        ) => first.field.name == second.field.name,
                        _ => false,
                    }
            }
            _ => false,
        },
    }
}

fn nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(node_id)
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .map(AstNode::id)
}

fn is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
