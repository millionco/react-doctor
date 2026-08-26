use oxc_ast::{
    AstKind,
    ast::{AssignmentTarget, Expression, Statement, VariableDeclaration, VariableDeclarationKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use oxc_syntax::{
    node::NodeId,
    operator::{BinaryOperator, LogicalOperator},
};
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This await blocks the function before an early-return that doesn't use the awaited value, so the skip path waits for nothing. Move the await below the guard so it only runs when you need the data";
const CANCELLATION_GUARD_NAMES: &[&str] = &[
    "cancelled",
    "canceled",
    "isCancelled",
    "isCanceled",
    "aborted",
    "isAborted",
    "disposed",
    "isDisposed",
    "destroyed",
    "isDestroyed",
    "stopped",
    "isStopped",
    "mounted",
    "isMounted",
    "unmounted",
    "isUnmounted",
    "active",
    "isActive",
    "stale",
    "isStale",
    "ignore",
    "signal",
    "abortSignal",
    "abortController",
];
const CANCELLATION_NAME_FRAGMENTS: &[&str] = &[
    "cancel",
    "abort",
    "dispos",
    "destroy",
    "stale",
    "alive",
    "mounted",
    "stopped",
    "settled",
    "cleanedup",
    "generation",
    "current",
    "token",
    "signal",
];

#[derive(Debug, Default, Clone)]
pub struct AsyncDeferAwait;

declare_oxc_lint!(
    /// Move value-producing awaits below unrelated early-exit guards.
    AsyncDeferAwait,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Move awaits below unrelated early-exit guards.",
);

impl Rule for AsyncDeferAwait {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for node in ctx.nodes().iter() {
            let statements = match node.kind() {
                AstKind::FunctionBody(body) => body.statements.as_slice(),
                AstKind::BlockStatement(block) => block.body.as_slice(),
                AstKind::SwitchCase(case) => case.consequent.as_slice(),
                _ => continue,
            };
            let Some(function_id) = defer_nearest_async_function_id(node.id(), ctx) else {
                continue;
            };
            inspect_async_defer_statement_sequence(statements, function_id, ctx);
        }
    }
}

fn inspect_async_defer_statement_sequence(
    statements: &[Statement<'_>],
    function_id: NodeId,
    ctx: &LintContext<'_>,
) {
    let mut statement_index = 0;
    while statement_index + 1 < statements.len() {
        let Some(window) =
            collect_async_defer_await_window(statements, statement_index, function_id, ctx)
        else {
            statement_index += 1;
            continue;
        };
        if window.guard_index >= statements.len() {
            statement_index += 1;
            continue;
        }
        let Statement::IfStatement(guard) = &statements[window.guard_index] else {
            statement_index += 1;
            continue;
        };
        if !defer_if_is_early_exit(guard) {
            statement_index += 1;
            continue;
        }
        if window.has_bare_await || window.awaited_names.is_empty() {
            statement_index = window.guard_index;
            continue;
        }
        let mut test_names = FxHashSet::default();
        defer_collect_reference_names(guard.test.span(), &mut test_names, ctx);
        if defer_sets_intersect(&test_names, &window.awaited_names)
            || defer_test_is_cancellation_guard(&guard.test, ctx)
            || defer_test_reads_mutable_environment(&guard.test, ctx)
            || defer_test_is_non_literal_comparison(&guard.test)
            || defer_test_is_freshness_composition(&guard.test, function_id, ctx)
            || defer_test_reads_reassigned_local(&guard.test, function_id, ctx)
            || defer_consequent_has_side_effects(&guard.consequent, ctx)
        {
            statement_index = window.guard_index;
            continue;
        }
        let mut consequent_names = FxHashSet::default();
        defer_collect_reference_names(guard.consequent.span(), &mut consequent_names, ctx);
        if defer_sets_intersect(&consequent_names, &window.awaited_names) {
            statement_index = window.guard_index;
            continue;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(statements[statement_index].span()));
        statement_index = window.guard_index;
    }
}

struct AsyncDeferAwaitWindow {
    awaited_names: FxHashSet<String>,
    guard_index: usize,
    has_bare_await: bool,
}

fn collect_async_defer_await_window(
    statements: &[Statement<'_>],
    start_index: usize,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<AsyncDeferAwaitWindow> {
    let first_statement = statements.get(start_index)?;
    let mut awaited_names = FxHashSet::default();
    let mut has_bare_await = false;
    let is_awaiting_statement = match first_statement {
        Statement::VariableDeclaration(declaration) => {
            defer_process_variable_declaration(declaration, function_id, &mut awaited_names, ctx).0
        }
        statement if defer_is_bare_await_statement(statement) => {
            has_bare_await = true;
            true
        }
        _ => false,
    };
    if !is_awaiting_statement {
        return None;
    }
    let mut cursor = start_index + 1;
    while cursor < statements.len() {
        let statement = &statements[cursor];
        if defer_is_bare_await_statement(statement) {
            has_bare_await = true;
            cursor += 1;
            continue;
        }
        let Statement::VariableDeclaration(declaration) = statement else {
            break;
        };
        let (did_introduce_await, did_grow_bindings) =
            defer_process_variable_declaration(declaration, function_id, &mut awaited_names, ctx);
        if !did_introduce_await && !did_grow_bindings {
            break;
        }
        cursor += 1;
    }
    Some(AsyncDeferAwaitWindow {
        awaited_names,
        guard_index: cursor,
        has_bare_await,
    })
}

fn defer_process_variable_declaration(
    declaration: &VariableDeclaration<'_>,
    function_id: NodeId,
    awaited_names: &mut FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> (bool, bool) {
    let size_before = awaited_names.len();
    let mut did_introduce_await = false;
    loop {
        let mut did_change = false;
        for declarator in &declaration.declarations {
            let declarator_has_await =
                declarator.init.as_ref().is_some_and(|initializer| {
                    defer_span_contains_direct_await(initializer.span(), function_id, ctx)
                }) || defer_span_contains_direct_await(declarator.id.span(), function_id, ctx);
            if declarator_has_await {
                did_introduce_await = true;
                let binding_count = awaited_names.len();
                collect_binding_pattern_names(&declarator.id, awaited_names);
                did_change |= awaited_names.len() > binding_count;
                continue;
            }
            let mut dependency_names = FxHashSet::default();
            if let Some(initializer) = declarator.init.as_ref() {
                defer_collect_reference_names(initializer.span(), &mut dependency_names, ctx);
            }
            defer_collect_reference_names(declarator.id.span(), &mut dependency_names, ctx);
            if !defer_sets_intersect(&dependency_names, awaited_names) {
                continue;
            }
            let binding_count = awaited_names.len();
            collect_binding_pattern_names(&declarator.id, awaited_names);
            did_change |= awaited_names.len() > binding_count;
        }
        if !did_change {
            break;
        }
    }
    (did_introduce_await, awaited_names.len() > size_before)
}

fn defer_span_contains_direct_await(
    span: Span,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        span.contains_inclusive(candidate.span())
            && matches!(candidate.kind(), AstKind::AwaitExpression(_))
            && defer_nearest_function_id(candidate.id(), ctx) == Some(function_id)
    })
}

fn defer_is_bare_await_statement(statement: &Statement<'_>) -> bool {
    matches!(statement, Statement::ExpressionStatement(statement) if matches!(&statement.expression, Expression::AwaitExpression(_)))
}

fn defer_if_is_early_exit(statement: &oxc_ast::ast::IfStatement<'_>) -> bool {
    if defer_statement_is_exit(&statement.consequent) {
        return true;
    }
    matches!(&statement.consequent, Statement::BlockStatement(block) if block.body.iter().any(defer_statement_is_exit))
}

fn defer_statement_is_exit(statement: &Statement<'_>) -> bool {
    matches!(
        statement,
        Statement::ReturnStatement(_)
            | Statement::ThrowStatement(_)
            | Statement::ContinueStatement(_)
            | Statement::BreakStatement(_)
    )
}

fn defer_sets_intersect(left: &FxHashSet<String>, right: &FxHashSet<String>) -> bool {
    left.iter().any(|name| right.contains(name))
}

fn defer_collect_reference_names(span: Span, names: &mut FxHashSet<String>, ctx: &LintContext<'_>) {
    for candidate in ctx.nodes().iter() {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            continue;
        };
        if !span.contains_inclusive(candidate.span()) {
            continue;
        }
        if let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            && span.contains_inclusive(ctx.symbol_declaration(symbol_id).span())
        {
            continue;
        }
        names.insert(identifier.name.to_string());
    }
}

fn defer_test_is_cancellation_guard(test: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let mut reference_names = FxHashSet::default();
    defer_collect_reference_names(test.span(), &mut reference_names, ctx);
    if reference_names
        .iter()
        .any(|name| CANCELLATION_GUARD_NAMES.contains(&name.as_str()))
    {
        return true;
    }
    for candidate in ctx.nodes().iter() {
        if !test.span().contains_inclusive(candidate.span()) {
            continue;
        }
        let name = match candidate.kind() {
            AstKind::IdentifierReference(identifier) => Some(identifier.name.as_str()),
            AstKind::IdentifierName(identifier) => Some(identifier.name.as_str()),
            AstKind::PrivateIdentifier(identifier) => Some(identifier.name.as_str()),
            _ => None,
        };
        if name.is_some_and(defer_name_is_cancellation_like) {
            return true;
        }
        if let AstKind::StaticMemberExpression(member) = candidate.kind()
            && member.property.name == "current"
            && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name.ends_with("Ref") && identifier.name.len() > 3)
        {
            return true;
        }
    }
    false
}

fn defer_name_is_cancellation_like(raw_name: &str) -> bool {
    let normalized = raw_name.trim_start_matches(['_', '#']).to_ascii_lowercase();
    normalized != "current"
        && CANCELLATION_NAME_FRAGMENTS
            .iter()
            .any(|fragment| normalized.contains(fragment))
}

fn defer_test_reads_mutable_environment(test: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !test.span().contains_inclusive(candidate.span()) {
            return false;
        }
        match candidate.kind() {
            AstKind::CallExpression(call) => !matches!(
                call.callee.get_inner_expression(),
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            ),
            AstKind::ThisExpression(_) | AstKind::PrivateIdentifier(_) => true,
            _ => false,
        }
    })
}

fn defer_test_is_non_literal_comparison(test: &Expression<'_>) -> bool {
    let Expression::BinaryExpression(binary) = test.get_inner_expression() else {
        return false;
    };
    matches!(
        binary.operator,
        BinaryOperator::Equality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictEquality
            | BinaryOperator::StrictInequality
    ) && !defer_expression_is_literal_operand(&binary.left)
        && !defer_expression_is_literal_operand(&binary.right)
}

fn defer_expression_is_literal_operand(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        expression if expression.is_literal() => true,
        Expression::TemplateLiteral(_) => true,
        Expression::UnaryExpression(unary) => defer_expression_is_literal_operand(&unary.argument),
        _ => false,
    }
}

fn defer_test_is_freshness_composition(
    test: &Expression<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::LogicalExpression(logical) = test.get_inner_expression() else {
        return false;
    };
    if !matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) {
        return false;
    }
    let mut pending = vec![&logical.left, &logical.right];
    while let Some(candidate) = pending.pop() {
        if let Expression::LogicalExpression(nested) = candidate.get_inner_expression()
            && matches!(nested.operator, LogicalOperator::And | LogicalOperator::Or)
        {
            pending.push(&nested.left);
            pending.push(&nested.right);
            continue;
        }
        if !defer_expression_is_proven_freshness_comparison(candidate, function_id, ctx) {
            return false;
        }
    }
    true
}

fn defer_expression_is_proven_freshness_comparison(
    expression: &Expression<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::BinaryExpression(binary) = expression.get_inner_expression() else {
        return false;
    };
    if !matches!(
        binary.operator,
        BinaryOperator::Equality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictEquality
            | BinaryOperator::StrictInequality
    ) || defer_expression_is_literal_operand(&binary.left)
        || defer_expression_is_literal_operand(&binary.right)
    {
        return false;
    }
    (defer_expression_is_local_const_snapshot(&binary.left, function_id, ctx)
        && defer_expression_is_live_freshness_value(&binary.right, function_id, ctx))
        || (defer_expression_is_local_const_snapshot(&binary.right, function_id, ctx)
            && defer_expression_is_live_freshness_value(&binary.left, function_id, ctx))
}

fn defer_expression_is_local_const_snapshot(
    expression: &Expression<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
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
    let function_span = ctx.nodes().get_node(function_id).span();
    function_span.contains_inclusive(declaration.span())
        && defer_symbol_variable_kind(declaration, ctx).is_some_and(|kind| kind.is_const())
}

fn defer_expression_is_live_freshness_value(
    expression: &Expression<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = expression.get_inner_expression();
    if expression.get_member_expr().is_some() {
        return true;
    }
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
    if ctx
        .nodes()
        .get_node(function_id)
        .span()
        .contains_inclusive(declaration.span())
    {
        return false;
    }
    matches!(
        declaration.kind(),
        AstKind::ImportSpecifier(_)
            | AstKind::ImportDefaultSpecifier(_)
            | AstKind::ImportNamespaceSpecifier(_)
    ) || defer_symbol_variable_kind(declaration, ctx).is_some_and(|kind| {
        matches!(
            kind,
            VariableDeclarationKind::Let | VariableDeclarationKind::Var
        )
    })
}

fn defer_symbol_variable_kind(
    declaration: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<VariableDeclarationKind> {
    ctx.nodes()
        .ancestors(declaration.id())
        .find_map(|ancestor| match ancestor.kind() {
            AstKind::VariableDeclaration(declaration) => Some(declaration.kind),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => None,
            _ => None,
        })
}

fn defer_test_reads_reassigned_local(
    test: &Expression<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut test_names = FxHashSet::default();
    defer_collect_reference_names(test.span(), &mut test_names, ctx);
    if test_names.is_empty() {
        return false;
    }
    let function_span = ctx.nodes().get_node(function_id).span();
    ctx.nodes().iter().any(|candidate| {
        if !function_span.contains_inclusive(candidate.span()) {
            return false;
        }
        let mut assigned_names = FxHashSet::default();
        match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                defer_collect_assignment_names(&assignment.left, &mut assigned_names, ctx);
            }
            AstKind::UpdateExpression(update) => {
                if let Some(Expression::Identifier(identifier)) = update.argument.get_expression() {
                    assigned_names.insert(identifier.name.to_string());
                }
            }
            _ => return false,
        }
        defer_sets_intersect(&test_names, &assigned_names)
    })
}

fn defer_collect_assignment_names(
    target: &AssignmentTarget<'_>,
    names: &mut FxHashSet<String>,
    ctx: &LintContext<'_>,
) {
    match target {
        AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
            names.insert(identifier.name.to_string());
        }
        AssignmentTarget::ArrayAssignmentTarget(_)
        | AssignmentTarget::ObjectAssignmentTarget(_) => {
            for candidate in ctx.nodes().iter() {
                if target.span().contains_inclusive(candidate.span())
                    && let AstKind::IdentifierReference(identifier) = candidate.kind()
                {
                    names.insert(identifier.name.to_string());
                }
            }
        }
        _ => {}
    }
}

fn defer_consequent_has_side_effects(statement: &Statement<'_>, ctx: &LintContext<'_>) -> bool {
    let span = statement.span();
    ctx.nodes().iter().any(|candidate| {
        if !span.contains_inclusive(candidate.span())
            || defer_has_blocking_ancestor(candidate, span, ctx)
        {
            return false;
        }
        matches!(
            candidate.kind(),
            AstKind::CallExpression(_)
                | AstKind::NewExpression(_)
                | AstKind::AssignmentExpression(_)
                | AstKind::UpdateExpression(_)
        )
    })
}

fn defer_has_blocking_ancestor(
    candidate: &AstNode<'_>,
    root_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(candidate.id()) {
        if !root_span.contains_inclusive(ancestor.span()) {
            break;
        }
        if matches!(ancestor.kind(), AstKind::ThrowStatement(_))
            || ancestor.id() != candidate.id()
                && matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
        {
            return true;
        }
    }
    false
}

fn defer_nearest_async_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::Function(function) => return function.r#async.then_some(ancestor.id()),
            AstKind::ArrowFunctionExpression(function) => {
                return function.r#async.then_some(ancestor.id());
            }
            _ => {}
        }
    }
    None
}

fn defer_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}
