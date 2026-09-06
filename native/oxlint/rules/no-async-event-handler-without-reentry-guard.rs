use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, Expression, JSXAttributeName, JSXAttributeValue, JSXElementName,
        ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str = "This async handler awaits a mutating request and only flips state after the await, so a fast double-click or double Enter fires the request twice. Add a leading `if (busy) return` guard (or set a flag before the await and disable the control) to close the re-entry window.";
const MUTATING_REQUEST_METHOD_NAMES: [&str; 6] =
    ["post", "put", "patch", "delete", "mutate", "mutateAsync"];
const MUTATING_FETCH_HTTP_METHODS: [&str; 4] = ["POST", "PUT", "PATCH", "DELETE"];
const NON_MUTATING_ENDPOINT_TAILS: [&str; 10] = [
    "preview", "render", "search", "query", "validate", "verify", "check", "stop", "cancel",
    "abort",
];

#[derive(Debug, Default, Clone)]
pub struct NoAsyncEventHandlerWithoutReentryGuard;

declare_oxc_lint!(
    /// Warns when an async mutating event handler has an open re-entry window.
    NoAsyncEventHandlerWithoutReentryGuard,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when an async mutating event handler has an open re-entry window.",
);

impl Rule for NoAsyncEventHandlerWithoutReentryGuard {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut analyzed_handler_spans = Vec::new();
        let mut function_resolution_cache = LocalFunctionResolutionCache::default();
        for attribute_node in ctx.nodes().iter() {
            let AstKind::JSXAttribute(attribute) = attribute_node.kind() else {
                continue;
            };
            let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                continue;
            };
            if !matches!(attribute_name.name.as_str(), "onClick" | "onSubmit") {
                continue;
            }
            let opening_node = ctx.nodes().parent_node(attribute_node.id());
            let AstKind::JSXOpeningElement(opening_element) = opening_node.kind() else {
                continue;
            };
            let JSXElementName::Identifier(element_name) = &opening_element.name else {
                continue;
            };
            if !element_name
                .name
                .as_str()
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_lowercase)
            {
                continue;
            }
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(handler_expression) = container.expression.as_expression() else {
                continue;
            };
            let handler_node = resolve_local_react_callback(handler_expression, ctx)
                .and_then(|(_, handler_span)| {
                    ctx.nodes().iter().find(|candidate| {
                        candidate.span() == handler_span
                            && matches!(
                                candidate.kind(),
                                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                            )
                    })
                })
                .or_else(|| {
                    exact_local_function_id_including_generators(
                        handler_expression,
                        ctx,
                        &mut Vec::new(),
                        &mut function_resolution_cache,
                    )
                    .map(|handler_id| ctx.nodes().get_node(handler_id))
                });
            let Some(handler_node) = handler_node else {
                continue;
            };
            let handler_span = handler_node.span();
            if analyzed_handler_spans.contains(&handler_span) {
                continue;
            }
            analyzed_handler_spans.push(handler_span);
            if let Some(await_span) = reentry_first_unsafe_await(handler_node, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(await_span));
            }
        }
    }
}

fn reentry_first_unsafe_await<'a>(
    handler_node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<Span> {
    let has_async_block_body = match handler_node.kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => {
            function.r#async && function.get_expression().is_none()
        }
        _ => false,
    };
    if !has_async_block_body {
        return None;
    }
    let mut awaited_mutations = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            reentry_nearest_function_id(candidate.id(), ctx) == Some(handler_node.id())
                && matches!(candidate.kind(), AstKind::AwaitExpression(_))
                && !reentry_event_is_ignored_by_statement_analysis(
                    candidate,
                    handler_node.id(),
                    ctx,
                )
        })
        .filter(|candidate| {
            let AstKind::AwaitExpression(await_expression) = candidate.kind() else {
                return false;
            };
            reentry_awaited_expression_is_mutating(&await_expression.argument, ctx)
        })
        .collect::<Vec<_>>();
    awaited_mutations.sort_unstable_by_key(|candidate| candidate.span().start);

    for awaited_mutation in awaited_mutations {
        if reentry_has_guard_before(awaited_mutation, handler_node, ctx) {
            continue;
        }
        let has_reachable_state_write = ctx.nodes().iter().any(|candidate| {
            if reentry_nearest_function_id(candidate.id(), ctx) != Some(handler_node.id()) {
                return false;
            }
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return false;
            };
            if reentry_event_is_ignored_by_statement_analysis(candidate, handler_node.id(), ctx) {
                return false;
            }
            reentry_state_setter_symbol(call_expression, ctx).is_some()
                && candidate.span().end > awaited_mutation.span().end
                && (candidate.span().contains_inclusive(awaited_mutation.span())
                    || can_node_reach_later_node_within_function(
                        awaited_mutation,
                        candidate,
                        handler_node,
                        ctx,
                    ))
                && nodes_can_co_execute(awaited_mutation, candidate, ctx)
        });
        if has_reachable_state_write {
            return Some(awaited_mutation.span());
        }
    }
    None
}

fn reentry_event_is_ignored_by_statement_analysis<'a>(
    node: &crate::AstNode<'a>,
    handler_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == handler_id {
            break;
        }
        match ancestor.kind() {
            AstKind::ReturnStatement(_) | AstKind::ThrowStatement(_) => return true,
            AstKind::IfStatement(statement)
                if statement.test.span().contains_inclusive(node.span()) =>
            {
                return true;
            }
            AstKind::SwitchStatement(statement)
                if statement
                    .discriminant
                    .span()
                    .contains_inclusive(node.span()) =>
            {
                return true;
            }
            AstKind::SwitchCase(case)
                if case
                    .test
                    .as_ref()
                    .is_some_and(|test| test.span().contains_inclusive(node.span())) =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn reentry_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn reentry_state_setter_symbol<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let Expression::Identifier(setter_reference) = &call_expression.callee else {
        return None;
    };
    let setter_suffix = setter_reference.name.strip_prefix("set")?;
    if !setter_suffix
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_uppercase)
    {
        return None;
    }
    let setter_symbol_id = reentry_state_setter_root_symbol(setter_reference, ctx)?;
    let declaration = ctx.symbol_declaration(setter_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ArrayPattern(array_pattern) = &declarator.id else {
        return None;
    };
    let setter_binding = array_pattern
        .elements
        .get(1)
        .and_then(Option::as_ref)?
        .get_binding_identifier()?;
    let Expression::CallExpression(hook_call) = declarator.init.as_ref()?.get_inner_expression()
    else {
        return None;
    };
    (setter_binding.symbol_id() == setter_symbol_id
        && is_react_hook_call(hook_call, &["useState", "useReducer"], ctx))
    .then_some(setter_symbol_id)
}

fn reentry_state_setter_root_symbol<'a>(
    setter_reference: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let mut symbol_id = ctx
        .scoping()
        .get_reference(setter_reference.reference_id())
        .symbol_id()?;
    let mut visited_symbol_ids = Vec::new();
    loop {
        if visited_symbol_ids.contains(&symbol_id) {
            return None;
        }
        visited_symbol_ids.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return Some(symbol_id);
        };
        let parent = ctx.nodes().parent_node(declaration.id());
        let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
            return Some(symbol_id);
        };
        if !variable_declaration.kind.is_const()
            || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return Some(symbol_id);
        }
        let Some(Expression::Identifier(next_identifier)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            return Some(symbol_id);
        };
        symbol_id = ctx
            .scoping()
            .get_reference(next_identifier.reference_id())
            .symbol_id()?;
    }
}

fn reentry_awaited_expression_is_mutating<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::CallExpression(call_expression) = expression.get_inner_expression() else {
        return false;
    };
    if reentry_is_mutating_fetch_call(call_expression, ctx) {
        return !reentry_targets_non_mutating_endpoint(call_expression);
    }
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    if let Some(method_name) = member_expression.static_property_name()
        && MUTATING_REQUEST_METHOD_NAMES.contains(&method_name.as_ref())
    {
        if method_name == "mutate" && call_expression.arguments.is_empty() {
            return false;
        }
        if reentry_receiver_is_local_storage(member_expression.object())
            || reentry_targets_non_mutating_endpoint(call_expression)
        {
            return false;
        }
        return true;
    }
    reentry_awaited_expression_is_mutating(member_expression.object(), ctx)
}

fn reentry_is_mutating_fetch_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(fetch_identifier) = &call_expression.callee else {
        return false;
    };
    if fetch_identifier.name != "fetch"
        || ctx
            .scoping()
            .get_reference(fetch_identifier.reference_id())
            .symbol_id()
            .is_some()
    {
        return false;
    }
    let Some(Expression::ObjectExpression(options)) = call_expression
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    options.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        if property.computed || property.key.static_name().as_deref() != Some("method") {
            return false;
        }
        matches!(&property.value, Expression::StringLiteral(method)
            if MUTATING_FETCH_HTTP_METHODS.contains(&method.value.to_ascii_uppercase().as_str()))
    })
}

fn reentry_receiver_is_local_storage(expression: &Expression<'_>) -> bool {
    let mut receiver = expression;
    while let Some(member_expression) = receiver.as_member_expression() {
        receiver = member_expression.object();
    }
    matches!(receiver, Expression::Identifier(identifier)
        if matches!(identifier.name.to_ascii_lowercase().as_str(), "db" | "idb" | "database" | "cache" | "caches" | "store"))
}

fn reentry_targets_non_mutating_endpoint(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
) -> bool {
    let Some(argument) = call_expression
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let url_tail = match argument.get_inner_expression() {
        Expression::StringLiteral(literal) => literal.value.as_str(),
        Expression::TemplateLiteral(template) => template
            .quasis
            .last()
            .and_then(|quasi| quasi.value.cooked.as_deref())
            .unwrap_or_default(),
        _ => return false,
    };
    let path = url_tail.split(['?', '#']).next().unwrap_or_default();
    let endpoint = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .next_back()
        .unwrap_or_default();
    NON_MUTATING_ENDPOINT_TAILS
        .iter()
        .any(|candidate| endpoint.eq_ignore_ascii_case(candidate))
}

fn reentry_has_guard_before<'a>(
    awaited_mutation: &crate::AstNode<'a>,
    handler_node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if candidate.span().start >= awaited_mutation.span().start
            || reentry_nearest_function_id(candidate.id(), ctx) != Some(handler_node.id())
            || !(node_dominates_node(candidate, awaited_mutation, ctx)
                || reentry_syntactically_dominates(candidate, awaited_mutation, handler_node, ctx))
        {
            return false;
        }
        match candidate.kind() {
            AstKind::CallExpression(call_expression) => {
                reentry_is_direct_expression_statement(candidate, ctx)
                    && reentry_call_sets_guard_true(call_expression, ctx)
            }
            AstKind::AssignmentExpression(assignment) => {
                reentry_is_direct_expression_statement(candidate, ctx)
                    && reentry_assignment_sets_guard_true(assignment)
            }
            AstKind::IfStatement(if_statement) => {
                if_statement.alternate.is_none()
                    && reentry_statement_is_early_exit(&if_statement.consequent)
                    && reentry_test_has_positive_guard(&if_statement.test)
            }
            _ => false,
        }
    })
}

fn reentry_syntactically_dominates<'a>(
    candidate: &crate::AstNode<'a>,
    target: &crate::AstNode<'a>,
    handler_node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if candidate.span().start >= target.span().start {
        return false;
    }
    for ancestor in ctx.nodes().ancestors(candidate.id()) {
        if ancestor.id() == handler_node.id() {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::IfStatement(_)
                | AstKind::SwitchCase(_)
                | AstKind::ForStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::CatchClause(_)
        ) && !ancestor.span().contains_inclusive(target.span())
        {
            return false;
        }
    }
    false
}

fn reentry_is_direct_expression_statement<'a>(
    node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    matches!(ctx.nodes().parent_node(node.id()).kind(), AstKind::ExpressionStatement(statement)
        if statement.expression.span() == node.span())
}

fn reentry_statement_is_early_exit(statement: &oxc_ast::ast::Statement<'_>) -> bool {
    match statement {
        oxc_ast::ast::Statement::ReturnStatement(_)
        | oxc_ast::ast::Statement::ThrowStatement(_) => true,
        oxc_ast::ast::Statement::BlockStatement(block) => block
            .body
            .last()
            .is_some_and(reentry_statement_is_early_exit),
        oxc_ast::ast::Statement::IfStatement(statement) => {
            statement.alternate.as_ref().is_some_and(|alternate| {
                reentry_statement_is_early_exit(&statement.consequent)
                    && reentry_statement_is_early_exit(alternate)
            })
        }
        _ => false,
    }
}

fn reentry_call_sets_guard_true<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = &call_expression.callee else {
        return false;
    };
    reentry_name_is_guard(identifier.name.as_str())
        && reentry_state_setter_symbol(call_expression, ctx).is_some()
        && matches!(call_expression.arguments.first().and_then(Argument::as_expression), Some(Expression::BooleanLiteral(value)) if value.value)
}

fn reentry_assignment_sets_guard_true(assignment: &oxc_ast::ast::AssignmentExpression<'_>) -> bool {
    if assignment.operator != AssignmentOperator::Assign
        || !matches!(assignment.right.get_inner_expression(), Expression::BooleanLiteral(value) if value.value)
    {
        return false;
    }
    assignment
        .left
        .get_expression()
        .map(Expression::get_inner_expression)
        .and_then(Expression::as_member_expression)
        .and_then(oxc_ast::ast::MemberExpression::static_property_name)
        .is_some_and(|property_name| matches!(property_name.as_ref(), "disabled" | "current"))
}

fn reentry_name_is_guard(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    [
        "busy",
        "loading",
        "submitting",
        "saving",
        "pending",
        "processing",
        "uploading",
        "disabled",
        "inflight",
        "working",
    ]
    .iter()
    .any(|candidate| lowercase_name.contains(candidate))
}

fn reentry_test_has_positive_guard(expression: &Expression<'_>) -> bool {
    reentry_guard_polarity(expression) == Some(true)
}

fn reentry_guard_polarity(expression: &Expression<'_>) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            reentry_name_is_guard(identifier.name.as_str()).then_some(true)
        }
        expression if expression.as_member_expression().is_some() => expression
            .as_member_expression()
            .is_some_and(reentry_member_chain_has_guard)
            .then_some(true),
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            reentry_guard_polarity(&unary.argument).map(|polarity| !polarity)
        }
        Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::Or => {
            (reentry_guard_polarity(&logical.left) == Some(true)
                || reentry_guard_polarity(&logical.right) == Some(true))
            .then_some(true)
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Equality
                    | BinaryOperator::StrictEquality
                    | BinaryOperator::Inequality
                    | BinaryOperator::StrictInequality
            ) =>
        {
            let boolean_value = if reentry_expression_is_guard(&binary.left) {
                reentry_boolean_literal(&binary.right)
            } else if reentry_expression_is_guard(&binary.right) {
                reentry_boolean_literal(&binary.left)
            } else {
                None
            }?;
            Some(match binary.operator {
                BinaryOperator::Equality | BinaryOperator::StrictEquality => boolean_value,
                BinaryOperator::Inequality | BinaryOperator::StrictInequality => !boolean_value,
                _ => return None,
            })
        }
        _ => None,
    }
}

fn reentry_expression_is_guard(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => reentry_name_is_guard(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .is_some_and(reentry_member_chain_has_guard),
    }
}

fn reentry_member_chain_has_guard(member_expression: &oxc_ast::ast::MemberExpression<'_>) -> bool {
    let mut current_member = member_expression;
    loop {
        if current_member
            .static_property_name()
            .is_some_and(|name| reentry_name_is_guard(name.as_ref()))
        {
            return true;
        }
        match current_member.object().get_inner_expression() {
            Expression::Identifier(identifier) => {
                return reentry_name_is_guard(identifier.name.as_str());
            }
            expression => {
                let Some(parent_member) = expression.as_member_expression() else {
                    return false;
                };
                current_member = parent_member;
            }
        }
    }
}

fn reentry_boolean_literal(expression: &Expression<'_>) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        _ => None,
    }
}
