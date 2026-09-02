use oxc_ast::{
    AstKind,
    ast::{Argument, AssignmentTarget, Expression, MemberExpression, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use oxc_syntax::node::NodeId;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const INTENTIONAL_SEQUENCING_CALLEE_NAMES: &[&str] = &[
    "sleep",
    "delay",
    "wait",
    "pause",
    "throttle",
    "debounce",
    "tick",
    "nextTick",
    "advanceTimersByTime",
    "advanceTimersByTimeAsync",
    "runAllTimers",
    "runAllTimersAsync",
    "runOnlyPendingTimers",
    "runOnlyPendingTimersAsync",
    "setTimeout",
    "setInterval",
    "setImmediate",
    "queueMicrotask",
    "requestAnimationFrame",
    "requestIdleCallback",
    "yieldNow",
    "yieldTo",
    "yieldToBrowser",
    "slice",
    "sliceYield",
    "nextFrame",
    "breathe",
    "onYield",
    "onProgress",
    "progress",
    "onStep",
    "step",
    "stage",
    "runStage",
    "animate",
    "transition",
    "spring",
    "tween",
    "stagger",
    "sequence",
    "timeline",
    "scrub",
    "query",
    "execute",
    "exec",
    "raw",
    "transaction",
    "$transaction",
    "$executeRaw",
    "$queryRaw",
    "$executeRawUnsafe",
    "$queryRawUnsafe",
    "begin",
    "commit",
    "rollback",
    "savepoint",
    "lock",
    "unlock",
    "spawn",
    "spawnSync",
    "execSync",
    "execFile",
    "execFileSync",
    "fork",
    "$",
    "sh",
    "mkdir",
    "rmdir",
    "rename",
    "rm",
    "unlink",
    "writeFile",
    "appendFile",
    "copyFile",
    "navigate",
    "goto",
    "waitForNavigation",
    "waitForURL",
    "waitForLoadState",
    "waitForResponse",
    "waitForRequest",
    "waitForSelector",
    "waitForFunction",
    "waitForEvent",
];
const PROMISE_CONCURRENCY_METHOD_NAMES: &[&str] = &["all", "allSettled", "race", "any"];
const HOST_YIELD_SCHEDULER_NAMES: &[&str] = &[
    "queueMicrotask",
    "requestAnimationFrame",
    "requestIdleCallback",
    "setImmediate",
    "setTimeout",
];
const OPAQUE_PACING_CALLEE_NAMES: &[&str] = &[
    "yieldNow",
    "yieldTo",
    "yieldToBrowser",
    "slice",
    "sliceYield",
    "nextFrame",
    "breathe",
    "onYield",
    "onProgress",
    "progress",
    "onStep",
    "step",
    "runStage",
];
const ITERATION_CALLBACK_METHOD_NAMES: &[&str] = &[
    "forEach",
    "map",
    "filter",
    "reduce",
    "reduceRight",
    "find",
    "findIndex",
    "some",
    "every",
    "flatMap",
];
const MUTATING_ARRAY_METHOD_NAMES: &[&str] = &["push", "unshift", "splice", "pop", "shift"];
const TEST_LIBRARY_IMPORT_SOURCES: &[&str] = &[
    "vitest",
    "jest",
    "mocha",
    "chai",
    "sinon",
    "expect",
    "ava",
    "uvu",
    "node:test",
    "bun:test",
    "@testing-library/react",
    "@testing-library/react-native",
    "@testing-library/react-hooks",
    "@testing-library/dom",
    "@testing-library/user-event",
    "@testing-library/jest-dom",
    "@testing-library/vue",
    "@testing-library/svelte",
    "@testing-library/preact",
    "@testing-library/cypress",
    "playwright",
    "playwright-core",
    "@playwright/test",
    "@playwright/experimental-ct-react",
    "@playwright/experimental-ct-react17",
    "cypress",
    "@cypress/react",
    "@cypress/react18",
    "@storybook/test",
    "@storybook/test-runner",
    "@storybook/testing-library",
    "@storybook/jest",
    "puppeteer",
    "puppeteer-core",
    "webdriverio",
    "@wdio/globals",
    "@nuxt/test-utils",
];
const TEST_LIBRARY_IMPORT_SOURCE_PREFIXES: &[&str] = &[
    "vitest/",
    "@vitest/",
    "@jest/",
    "@testing-library/",
    "@playwright/",
    "@storybook/test/",
    "@storybook/test-runner/",
    "@storybook/testing-library/",
    "@cypress/",
    "@nuxt/test-utils/",
];

#[derive(Debug, Default, Clone)]
pub struct AsyncAwaitInLoop;

declare_oxc_lint!(
    /// Warn about independent awaits that run sequentially inside loops.
    AsyncAwaitInLoop,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warn about independent awaits inside loops.",
);

impl Rule for AsyncAwaitInLoop {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if async_await_loop_has_test_library_import(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::ForStatement(statement) => {
                    inspect_async_await_loop(node, &statement.body, "for-loop", None, ctx);
                }
                AstKind::ForInStatement(statement) => {
                    inspect_async_await_loop(node, &statement.body, "for…in loop", None, ctx);
                }
                AstKind::ForOfStatement(statement) if !statement.r#await => {
                    inspect_async_await_loop(node, &statement.body, "for…of loop", None, ctx);
                }
                AstKind::WhileStatement(statement) => {
                    inspect_async_await_loop(
                        node,
                        &statement.body,
                        "while-loop",
                        Some(&statement.test),
                        ctx,
                    );
                }
                AstKind::DoWhileStatement(statement) => {
                    inspect_async_await_loop(
                        node,
                        &statement.body,
                        "do-while loop",
                        Some(&statement.test),
                        ctx,
                    );
                }
                AstKind::CallExpression(call) => inspect_async_iteration_callback(call, node, ctx),
                _ => {}
            }
        }
    }
}

fn inspect_async_await_loop<'a>(
    loop_node: &AstNode<'a>,
    body: &Statement<'a>,
    label: &str,
    test: Option<&Expression<'a>>,
    ctx: &LintContext<'a>,
) {
    let body_span = body.span();
    let awaits = direct_async_await_nodes(loop_node.id(), body_span, true, ctx);
    let intentional_awaits = direct_async_await_nodes(loop_node.id(), body_span, false, ctx);
    if awaits.is_empty()
        || intentional_awaits.iter().any(|await_id| {
            async_await_is_intentionally_sequential(ctx.nodes().get_node(*await_id), ctx)
        })
        || test.is_some_and(|test| {
            async_loop_test_depends_on_body_state(test, loop_node.id(), body_span, ctx)
        })
        || async_loop_has_carried_dependency(loop_node.id(), body_span, ctx)
        || async_loop_has_await_dependent_exit(loop_node.id(), body_span, ctx)
        || async_loop_is_inside_worker_pool(loop_node, ctx)
    {
        return;
    }
    let first_await = awaits
        .into_iter()
        .filter(|await_id| {
            !async_await_is_ordered_receiver_snapshot(
                ctx.nodes().get_node(*await_id),
                loop_node,
                ctx,
            )
        })
        .min_by_key(|await_id| ctx.nodes().get_node(*await_id).span().start);
    if let Some(first_await) = first_await.map(|await_id| ctx.nodes().get_node(await_id)) {
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This makes the {label} slow because each await runs one after another, so collect the independent calls & run them together with `await Promise.all(items.map(...))`"
            ))
            .with_label(first_await.span()),
        );
    }
}

fn inspect_async_iteration_callback<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) {
    let Some(member) = call.callee.get_inner_expression().get_member_expr() else {
        return;
    };
    let MemberExpression::StaticMemberExpression(member) = member else {
        return;
    };
    let method_name = member.property.name.as_str();
    if !ITERATION_CALLBACK_METHOD_NAMES.contains(&method_name) {
        return;
    }
    let Some(callback) = call.arguments.first().and_then(Argument::as_expression) else {
        return;
    };
    let (callback_id, callback_body_span, is_async) = match callback.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => (
            function.node_id.get(),
            function.body.span(),
            function.r#async,
        ),
        Expression::FunctionExpression(function) => {
            let Some(body) = function.body.as_ref() else {
                return;
            };
            (function.node_id.get(), body.span, function.r#async)
        }
        _ => return,
    };
    if !is_async
        || matches!(method_name, "map" | "flatMap")
            && async_map_is_combined_with_promise(call_node, ctx)
    {
        return;
    }
    let Some(first_await) = direct_async_await_nodes(callback_id, callback_body_span, false, ctx)
        .into_iter()
        .min_by_key(|await_id| ctx.nodes().get_node(*await_id).span().start)
        .map(|await_id| ctx.nodes().get_node(await_id))
    else {
        return;
    };
    let message = if method_name == "forEach" {
        "Async callback in .forEach silently drops every await, so the work never finishes before the loop moves on. Use a `for…of` loop, or `await Promise.all(items.map(async (item) => {...}))`".to_string()
    } else {
        format!(
            "Async callback in .{method_name} runs the awaits one after another, so it is slow. Use `await Promise.all(items.map(async (item) => {{...}}))` to run them at the same time"
        )
    };
    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(first_await.span()));
}

fn direct_async_await_nodes(
    owner_id: NodeId,
    span: Span,
    skip_nested_loops: bool,
    ctx: &LintContext<'_>,
) -> Vec<NodeId> {
    ctx.nodes()
        .iter()
        .filter(|candidate| {
            matches!(candidate.kind(), AstKind::AwaitExpression(_))
                && span.contains_inclusive(candidate.span())
                && async_node_is_in_owner(candidate, owner_id, skip_nested_loops, ctx)
        })
        .map(AstNode::id)
        .collect()
}

fn async_node_is_in_owner(
    candidate: &AstNode<'_>,
    owner_id: NodeId,
    skip_nested_loops: bool,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(candidate.id()) {
        if ancestor.id() == owner_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) || skip_nested_loops && async_kind_is_loop(ancestor.kind())
        {
            return false;
        }
    }
    false
}

fn async_kind_is_loop(kind: AstKind<'_>) -> bool {
    matches!(
        kind,
        AstKind::ForStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_)
            | AstKind::WhileStatement(_)
            | AstKind::DoWhileStatement(_)
    )
}

fn async_await_loop_has_test_library_import(ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| {
        matches!(node.kind(), AstKind::ImportDeclaration(declaration) if async_await_is_test_library_source(declaration.source.value.as_str()))
    })
}

fn async_await_is_test_library_source(source: &str) -> bool {
    TEST_LIBRARY_IMPORT_SOURCES.contains(&source)
        || TEST_LIBRARY_IMPORT_SOURCE_PREFIXES
            .iter()
            .any(|prefix| source.starts_with(prefix))
}

fn async_await_is_intentionally_sequential(
    await_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::AwaitExpression(await_expression) = await_node.kind() else {
        return false;
    };
    let argument = await_expression.argument.get_inner_expression();
    if let Expression::CallExpression(call) = argument {
        if async_call_has_scheduler_argument(call)
            || async_call_is_promise_concurrency(call)
            || async_member_call_may_be_mutated(call, ctx)
        {
            return true;
        }
        if let Some(function_id) = async_resolve_local_call_function(call, ctx) {
            if async_local_function_is_intentionally_sequential(
                function_id,
                &mut FxHashSet::default(),
                ctx,
            ) {
                return true;
            }
            if async_local_function_is_order_independent(function_id, ctx) {
                return false;
            }
            if async_call_has_opaque_pacing_name(call) {
                return false;
            }
            return async_call_has_intentional_name(call);
        }
        return async_call_has_intentional_name(call);
    }
    matches!(argument, Expression::NewExpression(new_expression) if async_new_promise_is_wait(new_expression, ctx))
}

fn async_call_has_opaque_pacing_name(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            OPAQUE_PACING_CALLEE_NAMES.contains(&identifier.name.as_str())
        }
        expression => expression
            .get_member_expr()
            .and_then(MemberExpression::static_property_name)
            .is_some_and(|name| OPAQUE_PACING_CALLEE_NAMES.contains(&name.as_ref())),
    }
}

fn async_call_has_scheduler_argument(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    call.arguments.iter().any(|argument| {
        argument.as_expression().is_some_and(|expression| {
            matches!(expression.get_inner_expression(), Expression::Identifier(identifier) if async_name_looks_like_scheduler(identifier.name.as_str()))
        })
    })
}

fn async_name_looks_like_scheduler(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    lowercase_name.contains("sched")
}

fn async_call_has_intentional_name(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    if let Expression::Identifier(identifier) = call.callee.get_inner_expression() {
        return INTENTIONAL_SEQUENCING_CALLEE_NAMES.contains(&identifier.name.as_str());
    }
    let Some(member) = call.callee.get_inner_expression().get_member_expr() else {
        return false;
    };
    let Some(method_name) = member.static_property_name() else {
        return false;
    };
    if method_name == "check" {
        return matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if async_name_looks_like_scheduler(identifier.name.as_str()));
    }
    INTENTIONAL_SEQUENCING_CALLEE_NAMES.contains(&method_name.as_ref())
}

fn async_call_is_promise_concurrency(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    let Some(member) = call.callee.get_inner_expression().get_member_expr() else {
        return false;
    };
    PROMISE_CONCURRENCY_METHOD_NAMES
        .contains(&member.static_property_name().as_deref().unwrap_or(""))
        && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Promise")
}

fn async_resolve_local_call_function(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function) => Some(function.node_id.get()),
        AstKind::VariableDeclarator(declarator) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                Expression::Identifier(alias) => {
                    let alias_symbol_id = ctx
                        .scoping()
                        .get_reference(alias.reference_id())
                        .symbol_id()?;
                    let alias_declaration = ctx.symbol_declaration(alias_symbol_id);
                    match alias_declaration.kind() {
                        AstKind::Function(function) => Some(function.node_id.get()),
                        AstKind::VariableDeclarator(alias_declarator) => {
                            match alias_declarator.init.as_ref()?.get_inner_expression() {
                                Expression::ArrowFunctionExpression(function) => {
                                    Some(function.node_id.get())
                                }
                                Expression::FunctionExpression(function) => {
                                    Some(function.node_id.get())
                                }
                                _ => None,
                            }
                        }
                        _ => None,
                    }
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn async_local_function_is_intentionally_sequential(
    function_id: NodeId,
    visited: &mut FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    if !visited.insert(function_id) {
        return false;
    }
    let function_node = ctx.nodes().get_node(function_id);
    let function_span = function_node.span();
    for candidate in ctx.nodes().iter() {
        if !function_span.contains_inclusive(candidate.span())
            || !async_node_is_in_owner(candidate, function_id, false, ctx)
        {
            continue;
        }
        match candidate.kind() {
            AstKind::NewExpression(new_expression)
                if async_new_promise_yields_to_host(new_expression, ctx)
                    && async_expression_produces_function_result(candidate, function_id, ctx) =>
            {
                return true;
            }
            AstKind::CallExpression(call) => {
                if let Some(nested_function_id) = async_resolve_local_call_function(call, ctx) {
                    if async_local_function_is_intentionally_sequential(
                        nested_function_id,
                        visited,
                        ctx,
                    ) {
                        return true;
                    }
                } else if !async_call_is_global_host_scheduler(call, ctx)
                    && async_call_has_intentional_name(call)
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn async_expression_produces_function_result(
    expression_node: &AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(expression_node.id()) {
        if ancestor.id() == function_id {
            return matches!(ancestor.kind(), AstKind::ArrowFunctionExpression(function) if function.get_expression().is_some());
        }
        match ancestor.kind() {
            AstKind::ReturnStatement(_) | AstKind::AwaitExpression(_) => return true,
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSInstantiationExpression(_) => {}
            _ => return false,
        }
    }
    false
}

fn async_call_is_global_host_scheduler(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            HOST_YIELD_SCHEDULER_NAMES.contains(&identifier.name.as_str())
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        expression => {
            let Some(MemberExpression::StaticMemberExpression(member)) =
                expression.get_member_expr()
            else {
                return false;
            };
            HOST_YIELD_SCHEDULER_NAMES.contains(&member.property.name.as_str())
                && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "globalThis" | "window") && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        }
    }
}

fn async_new_promise_yields_to_host(
    new_expression: &oxc_ast::ast::NewExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if !matches!(&new_expression.callee, Expression::Identifier(identifier) if identifier.name == "Promise" && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
    {
        return false;
    }
    let Some(executor) = new_expression
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let (executor_id, executor_span) = match executor.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            (function.node_id.get(), function.body.span())
        }
        Expression::FunctionExpression(function) => {
            let Some(body) = function.body.as_ref() else {
                return false;
            };
            (function.node_id.get(), body.span)
        }
        _ => return false,
    };
    ctx.nodes().iter().any(|candidate| {
        executor_span.contains_inclusive(candidate.span())
            && async_node_is_in_owner(candidate, executor_id, false, ctx)
            && matches!(candidate.kind(), AstKind::CallExpression(call) if async_call_is_global_host_scheduler(call, ctx))
    })
}

fn async_new_promise_is_wait(
    new_expression: &oxc_ast::ast::NewExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if !matches!(&new_expression.callee, Expression::Identifier(identifier) if identifier.name == "Promise")
    {
        return false;
    }
    let Some(executor) = new_expression
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let (executor_id, executor_span) = match executor.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            (function.node_id.get(), function.body.span())
        }
        Expression::FunctionExpression(function) => {
            let Some(body) = function.body.as_ref() else {
                return false;
            };
            (function.node_id.get(), body.span)
        }
        Expression::Identifier(identifier) => {
            return INTENTIONAL_SEQUENCING_CALLEE_NAMES.contains(&identifier.name.as_str());
        }
        _ => return false,
    };
    ctx.nodes().iter().any(|candidate| {
        executor_span.contains_inclusive(candidate.span())
            && async_node_is_in_owner(candidate, executor_id, false, ctx)
            && matches!(candidate.kind(), AstKind::CallExpression(call) if async_call_has_intentional_name(call))
    })
}

fn async_member_call_may_be_mutated(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().get_member_expr() else {
        return false;
    };
    let Some(property_name) = member.static_property_name() else {
        return false;
    };
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    let Some(receiver_symbol_id) = ctx
        .scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| match candidate.kind() {
        AstKind::AssignmentExpression(assignment) => {
            let Some(target) = assignment.left.as_member_expression() else {
                return false;
            };
            let Expression::Identifier(target_receiver) = target.object().get_inner_expression()
            else {
                return false;
            };
            ctx.scoping()
                .get_reference(target_receiver.reference_id())
                .symbol_id()
                == Some(receiver_symbol_id)
                && target
                    .static_property_name()
                    .is_none_or(|target_property| target_property == property_name)
        }
        _ => false,
    })
}

fn async_expression_root_identifier_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    let mut current = expression.get_inner_expression();
    while let Some(member) = current.get_member_expr() {
        current = member.object().get_inner_expression();
    }
    match current {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn async_loop_has_carried_dependency(
    loop_id: NodeId,
    body_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    let mut written_names = FxHashSet::default();
    let mut awaited_names = FxHashSet::default();
    for candidate in ctx.nodes().iter() {
        if !body_span.contains_inclusive(candidate.span())
            || !async_node_is_in_owner(candidate, loop_id, false, ctx)
        {
            continue;
        }
        match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                async_collect_assignment_names(&assignment.left, &mut written_names, ctx);
            }
            AstKind::CallExpression(call) => {
                if let Some(member) = call.callee.get_inner_expression().get_member_expr()
                    && member.static_property_name().is_some_and(|method| {
                        matches!(method.as_ref(), "push" | "unshift" | "splice")
                    })
                    && let Expression::Identifier(identifier) =
                        member.object().get_inner_expression()
                {
                    written_names.insert(identifier.name.to_string());
                }
            }
            AstKind::AwaitExpression(await_expression) => {
                async_collect_reference_names(
                    await_expression.argument.span(),
                    &mut awaited_names,
                    ctx,
                );
            }
            _ => {}
        }
    }
    async_add_derived_bindings(loop_id, body_span, &mut written_names, ctx);
    written_names
        .iter()
        .any(|name| awaited_names.contains(name))
}

fn async_add_derived_bindings(
    owner_id: NodeId,
    body_span: Span,
    names: &mut FxHashSet<String>,
    ctx: &LintContext<'_>,
) {
    let mut dependencies = Vec::new();
    for candidate in ctx.nodes().iter() {
        let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
            continue;
        };
        if !body_span.contains_inclusive(candidate.span())
            || !async_node_is_in_owner(candidate, owner_id, false, ctx)
        {
            continue;
        }
        let Some(identifier) = declarator.id.get_binding_identifier() else {
            continue;
        };
        let Some(initializer) = declarator.init.as_ref() else {
            continue;
        };
        let mut referenced_names = FxHashSet::default();
        async_collect_reference_names(initializer.span(), &mut referenced_names, ctx);
        dependencies.push((identifier.name.to_string(), referenced_names));
    }
    loop {
        let mut did_grow = false;
        for (declared_name, referenced_names) in &dependencies {
            if !names.contains(declared_name)
                && referenced_names.iter().any(|name| names.contains(name))
            {
                names.insert(declared_name.clone());
                did_grow = true;
            }
        }
        if !did_grow {
            break;
        }
    }
}

fn async_loop_test_depends_on_body_state(
    test: &Expression<'_>,
    loop_id: NodeId,
    body_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    let mut test_names = FxHashSet::default();
    async_collect_reference_names(test.span(), &mut test_names, ctx);
    if test_names.is_empty() {
        return false;
    }
    let mut written_names = FxHashSet::default();
    for candidate in ctx.nodes().iter() {
        if !body_span.contains_inclusive(candidate.span())
            || !async_node_is_in_owner(candidate, loop_id, false, ctx)
        {
            continue;
        }
        match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                if let Some(name) = async_assignment_identifier_name(&assignment.left) {
                    written_names.insert(name.to_string());
                }
                if let Some(member) = assignment.left.as_member_expression()
                    && let Some(name) = async_expression_root_identifier_name(member.object())
                {
                    written_names.insert(name.to_string());
                }
            }
            AstKind::CallExpression(call) => {
                if let Some(member) = call.callee.get_inner_expression().get_member_expr()
                    && member.static_property_name().is_some_and(|method| {
                        MUTATING_ARRAY_METHOD_NAMES.contains(&method.as_ref())
                    })
                    && let Some(name) = async_expression_root_identifier_name(member.object())
                {
                    written_names.insert(name.to_string());
                }
            }
            _ => {}
        }
    }
    let mut await_assigned_names = async_collect_await_assigned_names(loop_id, body_span, ctx);
    async_add_derived_bindings(loop_id, body_span, &mut await_assigned_names, ctx);
    test_names.iter().any(|name| written_names.contains(name))
        || test_names
            .iter()
            .any(|name| await_assigned_names.contains(name))
}

fn async_collect_await_assigned_names(
    owner_id: NodeId,
    body_span: Span,
    ctx: &LintContext<'_>,
) -> FxHashSet<String> {
    let mut names = FxHashSet::default();
    for candidate in ctx.nodes().iter() {
        if !body_span.contains_inclusive(candidate.span())
            || !async_node_is_in_owner(candidate, owner_id, false, ctx)
        {
            continue;
        }
        match candidate.kind() {
            AstKind::VariableDeclarator(declarator)
                if declarator.init.as_ref().is_some_and(|initializer| {
                    ctx.nodes().iter().any(|nested| {
                        initializer.span().contains_inclusive(nested.span())
                            && matches!(nested.kind(), AstKind::AwaitExpression(_))
                    })
                }) =>
            {
                collect_binding_pattern_names(&declarator.id, &mut names);
            }
            AstKind::AssignmentExpression(assignment)
                if ctx.nodes().iter().any(|nested| {
                    assignment.right.span().contains_inclusive(nested.span())
                        && matches!(nested.kind(), AstKind::AwaitExpression(_))
                }) =>
            {
                async_collect_assignment_names(&assignment.left, &mut names, ctx);
            }
            _ => {}
        }
    }
    names
}

fn async_collect_reference_names(span: Span, names: &mut FxHashSet<String>, ctx: &LintContext<'_>) {
    for candidate in ctx.nodes().iter() {
        if span.contains_inclusive(candidate.span())
            && let AstKind::IdentifierReference(identifier) = candidate.kind()
        {
            names.insert(identifier.name.to_string());
        }
    }
}

fn async_collect_assignment_names(
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
            async_collect_reference_names(target.span(), names, ctx);
        }
        _ => {}
    }
}

fn async_assignment_identifier_name<'a>(target: &'a AssignmentTarget<'a>) -> Option<&'a str> {
    match target {
        AssignmentTarget::AssignmentTargetIdentifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn async_loop_has_await_dependent_exit(
    loop_id: NodeId,
    body_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    let mut awaited_names = async_collect_await_assigned_names(loop_id, body_span, ctx);
    async_add_derived_bindings(loop_id, body_span, &mut awaited_names, ctx);
    for candidate in ctx.nodes().iter() {
        if !body_span.contains_inclusive(candidate.span())
            || !async_node_is_in_owner(candidate, loop_id, false, ctx)
            || !matches!(
                candidate.kind(),
                AstKind::ReturnStatement(_) | AstKind::BreakStatement(_)
            )
            || matches!(candidate.kind(), AstKind::BreakStatement(_))
                && !async_break_exits_loop(candidate, loop_id, ctx)
        {
            continue;
        }
        let mut exit_names = FxHashSet::default();
        async_collect_reference_names(candidate.span(), &mut exit_names, ctx);
        if exit_names.iter().any(|name| awaited_names.contains(name))
            || !direct_async_await_nodes(loop_id, candidate.span(), false, ctx).is_empty()
        {
            return true;
        }
        let mut is_guarded_by_await_independent_condition = false;
        for ancestor in ctx.nodes().ancestors(candidate.id()) {
            if ancestor.id() == loop_id {
                break;
            }
            let test_span = match ancestor.kind() {
                AstKind::IfStatement(statement) => Some((statement.test.span(), true)),
                AstKind::SwitchStatement(statement) => Some((statement.discriminant.span(), false)),
                AstKind::TryStatement(statement) if statement.handler.is_some() => {
                    if statement.block.span.contains_inclusive(candidate.span())
                        && !is_guarded_by_await_independent_condition
                        && !direct_async_await_nodes(loop_id, statement.block.span, false, ctx)
                            .is_empty()
                    {
                        return true;
                    }
                    None
                }
                _ => None,
            };
            if let Some((test_span, is_if_test)) = test_span {
                let mut test_names = FxHashSet::default();
                async_collect_reference_names(test_span, &mut test_names, ctx);
                let is_await_dependent = test_names.iter().any(|name| awaited_names.contains(name))
                    || !direct_async_await_nodes(loop_id, test_span, false, ctx).is_empty();
                if is_await_dependent {
                    return true;
                }
                if is_if_test {
                    is_guarded_by_await_independent_condition = true;
                }
            }
            if let AstKind::BlockStatement(block) = ancestor.kind()
                && async_block_has_preceding_await_guard(
                    block,
                    candidate,
                    loop_id,
                    &awaited_names,
                    ctx,
                )
            {
                return true;
            }
        }
    }
    false
}

fn async_block_has_preceding_await_guard(
    block: &oxc_ast::ast::BlockStatement<'_>,
    exit_node: &AstNode<'_>,
    loop_id: NodeId,
    awaited_names: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    block.body.iter().any(|statement| {
        if statement.span().start >= exit_node.span().start {
            return false;
        }
        let Statement::IfStatement(statement) = statement else {
            return false;
        };
        let mut test_names = FxHashSet::default();
        async_collect_reference_names(statement.test.span(), &mut test_names, ctx);
        let is_await_dependent = test_names.iter().any(|name| awaited_names.contains(name))
            || !direct_async_await_nodes(loop_id, statement.test.span(), false, ctx).is_empty();
        is_await_dependent
            && (async_statement_short_circuits(&statement.consequent)
                || statement
                    .alternate
                    .as_ref()
                    .is_some_and(async_statement_short_circuits))
    })
}

fn async_statement_short_circuits(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::ContinueStatement(_)
        | Statement::BreakStatement(_)
        | Statement::ReturnStatement(_)
        | Statement::ThrowStatement(_) => true,
        Statement::BlockStatement(block) => block
            .body
            .last()
            .is_some_and(async_statement_short_circuits),
        _ => false,
    }
}

fn async_break_exits_loop(
    break_node: &AstNode<'_>,
    loop_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::BreakStatement(statement) = break_node.kind() else {
        return false;
    };
    if let Some(label) = statement.label.as_ref() {
        let parent = ctx.nodes().parent_node(loop_id);
        return matches!(parent.kind(), AstKind::LabeledStatement(labeled) if labeled.label.name == label.name);
    }
    for ancestor in ctx.nodes().ancestors(break_node.id()) {
        if ancestor.id() == loop_id {
            return true;
        }
        if async_kind_is_loop(ancestor.kind())
            || matches!(ancestor.kind(), AstKind::SwitchStatement(_))
        {
            return false;
        }
    }
    false
}

fn async_await_is_ordered_receiver_snapshot<'a>(
    await_node: &AstNode<'a>,
    loop_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let AstKind::AwaitExpression(await_expression) = await_node.kind() else {
        return false;
    };
    let Expression::CallExpression(call) = await_expression.argument.get_inner_expression() else {
        return false;
    };
    let Some(member) = call.callee.get_inner_expression().get_member_expr() else {
        return false;
    };
    let Some(receiver_key) = async_expression_key(member.object(), ctx) else {
        return false;
    };
    let receiver_root = member.object().get_inner_expression();
    let receiver_root = async_expression_root(receiver_root);
    if let Expression::Identifier(identifier) = receiver_root {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if loop_node
            .span()
            .contains_inclusive(ctx.symbol_declaration(symbol_id).span())
        {
            return false;
        }
    } else if !matches!(receiver_root, Expression::ThisExpression(_)) {
        return false;
    }
    let iteration_names = async_loop_iteration_binding_names(loop_node);
    if iteration_names.is_empty() {
        return false;
    }
    let mut call_names = FxHashSet::default();
    for argument in &call.arguments {
        async_collect_reference_names(argument.span(), &mut call_names, ctx);
    }
    if !iteration_names.iter().any(|name| call_names.contains(name)) {
        return false;
    }
    let mut has_before = false;
    let mut has_after = false;
    for peer_call_node in ctx.nodes().iter() {
        if await_node.span().contains_inclusive(peer_call_node.span())
            || !async_node_is_in_owner(peer_call_node, loop_node.id(), false, ctx)
        {
            continue;
        }
        let AstKind::CallExpression(candidate_call) = peer_call_node.kind() else {
            continue;
        };
        let Some(candidate_member) = candidate_call
            .callee
            .get_inner_expression()
            .get_member_expr()
        else {
            continue;
        };
        if async_expression_key(candidate_member.object(), ctx).as_deref()
            != Some(receiver_key.as_str())
        {
            continue;
        }
        let transparent_parent = ctx.nodes().parent_node(peer_call_node.id());
        if matches!(transparent_parent.kind(), AstKind::ExpressionStatement(_)) {
            continue;
        }
        if node_dominates_node(peer_call_node, await_node, ctx) {
            has_before = true;
        }
        if node_dominates_node(await_node, peer_call_node, ctx) {
            has_after = true;
        }
    }
    has_before && has_after
}

fn async_expression_root<'a>(expression: &'a Expression<'a>) -> &'a Expression<'a> {
    let mut current = expression.get_inner_expression();
    while let Some(member) = current.get_member_expr() {
        current = member.object().get_inner_expression();
    }
    current
}

fn async_expression_key(expression: &Expression<'_>, ctx: &LintContext<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            Some(format!("identifier:{symbol:?}:{}", identifier.name))
        }
        Expression::ThisExpression(_) => Some("this".to_string()),
        expression => {
            let member = expression.get_member_expr()?;
            let property = member.static_property_name()?;
            Some(format!(
                "{}.{}",
                async_expression_key(member.object(), ctx)?,
                property
            ))
        }
    }
}

fn async_loop_iteration_binding_names(loop_node: &AstNode<'_>) -> FxHashSet<String> {
    let mut names = FxHashSet::default();
    match loop_node.kind() {
        AstKind::ForOfStatement(statement) => {
            if let oxc_ast::ast::ForStatementLeft::VariableDeclaration(declaration) =
                &statement.left
            {
                for declarator in &declaration.declarations {
                    collect_binding_pattern_names(&declarator.id, &mut names);
                }
            }
        }
        AstKind::ForInStatement(statement) => {
            if let oxc_ast::ast::ForStatementLeft::VariableDeclaration(declaration) =
                &statement.left
            {
                for declarator in &declaration.declarations {
                    collect_binding_pattern_names(&declarator.id, &mut names);
                }
            }
        }
        _ => {}
    }
    names
}

fn async_loop_is_inside_worker_pool(loop_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let Some(function_node) = ctx.nodes().ancestors(loop_node.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    }) else {
        return false;
    };
    let binding_name = match function_node.kind() {
        AstKind::Function(function) => function
            .id
            .as_ref()
            .map(|identifier| identifier.name.as_str()),
        AstKind::ArrowFunctionExpression(_) => {
            let parent = ctx.nodes().parent_node(function_node.id());
            match parent.kind() {
                AstKind::VariableDeclarator(declarator) => declarator
                    .id
                    .get_binding_identifier()
                    .map(|identifier| identifier.name.as_str()),
                _ => None,
            }
        }
        _ => None,
    };
    let Some(binding_name) = binding_name else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        if !async_call_is_promise_concurrency(call) {
            return false;
        }
        let mut names = FxHashSet::default();
        for argument in &call.arguments {
            async_collect_reference_names(argument.span(), &mut names, ctx);
        }
        names.contains(binding_name)
    })
}

fn async_map_is_combined_with_promise(call_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
        if matches!(ancestor.kind(), AstKind::CallExpression(call) if async_call_is_promise_concurrency(call))
        {
            return true;
        }
    }
    let parent = ctx.nodes().parent_node(call_node.id());
    let binding_name = match parent.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .id
            .get_binding_identifier()
            .map(|identifier| identifier.name.as_str()),
        AstKind::AssignmentExpression(assignment) => {
            async_assignment_identifier_name(&assignment.left)
        }
        _ => None,
    };
    let Some(binding_name) = binding_name else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        if !async_call_is_promise_concurrency(call) {
            return false;
        }
        let mut names = FxHashSet::default();
        for argument in &call.arguments {
            async_collect_reference_names(argument.span(), &mut names, ctx);
        }
        names.contains(binding_name)
    })
}
