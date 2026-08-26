use oxc_ast::{
    AstKind,
    ast::{Expression, MemberExpression, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const SEQUENTIAL_AWAIT_THRESHOLD: usize = 3;
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
const ORDERED_UI_FLOW_CALLEE_NAMES: &[&str] = &[
    "render",
    "rerender",
    "renderHook",
    "renderToString",
    "renderToStaticMarkup",
    "act",
    "click",
    "dblClick",
    "dblclick",
    "tripleClick",
    "tap",
    "press",
    "longPress",
    "type",
    "clear",
    "fill",
    "focus",
    "blur",
    "hover",
    "unhover",
    "check",
    "uncheck",
    "selectOption",
    "selectOptions",
    "setChecked",
    "setInputFiles",
    "scrollIntoViewIfNeeded",
    "dragTo",
    "dragAndDrop",
    "drop",
    "evaluate",
    "evaluateHandle",
    "waitFor",
    "waitForLoadState",
    "waitForSelector",
    "waitForURL",
    "waitForResponse",
    "waitForRequest",
    "waitForEvent",
    "waitForFunction",
    "waitForElementToBeRemoved",
    "goto",
    "goBack",
    "goForward",
    "reload",
    "screenshot",
    "snapshot",
    "toMatchSnapshot",
    "toMatchInlineSnapshot",
    "expect",
    "expectTypeOf",
    "step",
    "describe",
    "test",
    "it",
    "beforeAll",
    "beforeEach",
    "afterAll",
    "afterEach",
    "play",
    "userEvent",
    "screen",
    "within",
];
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

#[derive(Debug, Default, Clone)]
pub struct AsyncParallel;

declare_oxc_lint!(
    /// Warn about independent consecutive awaits that can run concurrently.
    AsyncParallel,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Run independent consecutive awaits concurrently.",
);

impl Rule for AsyncParallel {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        if is_non_production_file(ctx) {
            return false;
        }
        let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
        !filename
            .rsplit_once('/')
            .map_or(filename.as_str(), |(_, basename)| basename)
            .contains(".browser.")
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if parallel_has_test_library_import(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let statements = match node.kind() {
                AstKind::FunctionBody(body) => body.statements.as_slice(),
                AstKind::BlockStatement(block) => block.body.as_slice(),
                _ => continue,
            };
            if parallel_is_inside_transaction_callback(node, ctx) {
                continue;
            }
            parallel_inspect_statements(statements, ctx);
        }
    }
}

fn parallel_has_test_library_import(ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| {
        let AstKind::ImportDeclaration(declaration) = node.kind() else {
            return false;
        };
        let source = declaration.source.value.as_str();
        TEST_LIBRARY_IMPORT_SOURCES.contains(&source)
            || TEST_LIBRARY_IMPORT_SOURCE_PREFIXES
                .iter()
                .any(|prefix| source.starts_with(prefix))
    })
}

fn parallel_inspect_statements(statements: &[Statement<'_>], ctx: &LintContext<'_>) {
    let mut run_start = 0;
    while run_start < statements.len() {
        if parallel_awaited_expression(&statements[run_start]).is_none() {
            run_start += 1;
            continue;
        }
        let mut run_end = run_start + 1;
        while run_end < statements.len()
            && parallel_awaited_expression(&statements[run_end]).is_some()
        {
            run_end += 1;
        }
        let run = &statements[run_start..run_end];
        if run.len() >= SEQUENTIAL_AWAIT_THRESHOLD
            && !parallel_sequence_has_serialization_signal(run, ctx)
            && parallel_awaits_are_independent(run, ctx)
        {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "These {} sequential await statements run one after another even though they look independent, so the page waits longer than it needs to. Run them together with Promise.all() instead",
                    run.len()
                ))
                .with_label(run[0].span()),
            );
        }
        run_start = run_end;
    }
}

fn parallel_awaited_expression<'a>(statement: &'a Statement<'a>) -> Option<&'a Expression<'a>> {
    match statement {
        Statement::VariableDeclaration(declaration) if declaration.declarations.len() == 1 => {
            let Expression::AwaitExpression(await_expression) =
                declaration.declarations[0].init.as_ref()?
            else {
                return None;
            };
            Some(&await_expression.argument)
        }
        Statement::ExpressionStatement(statement) => {
            let Expression::AwaitExpression(await_expression) = &statement.expression else {
                return None;
            };
            Some(&await_expression.argument)
        }
        _ => None,
    }
}

fn parallel_sequence_has_serialization_signal(
    statements: &[Statement<'_>],
    ctx: &LintContext<'_>,
) -> bool {
    let mut bare_await_function = None;
    for statement in statements {
        let Some(awaited_expression) = parallel_awaited_expression(statement) else {
            return true;
        };
        let expression = awaited_expression.get_inner_expression();
        if !matches!(
            expression,
            Expression::CallExpression(_)
                | Expression::NewExpression(_)
                | Expression::ImportExpression(_)
        ) {
            return true;
        }
        let Expression::CallExpression(call) = expression else {
            continue;
        };
        if parallel_member_call_may_be_mutated(call, ctx) {
            return true;
        }
        let local_function = parallel_resolve_local_call_function(call, ctx);
        let order_independent_function = local_function
            .filter(|function_id| async_local_function_is_order_independent(*function_id, ctx));
        if matches!(statement, Statement::ExpressionStatement(_)) {
            let Some(function_id) = order_independent_function else {
                return true;
            };
            if !parallel_call_has_simple_arguments(call) {
                return true;
            }
            if bare_await_function.is_some_and(|previous| previous != function_id) {
                return true;
            }
            bare_await_function = Some(function_id);
        }
        let trail = parallel_callee_identifier_trail(call, ctx);
        if trail.iter().any(|name| {
            ORDERED_UI_FLOW_CALLEE_NAMES.contains(&name.as_str())
                || name.starts_with("findBy")
                || name.starts_with("findAllBy")
        }) {
            return true;
        }
        if order_independent_function.is_none()
            && trail
                .iter()
                .any(|name| INTENTIONAL_SEQUENCING_CALLEE_NAMES.contains(&name.as_str()))
        {
            return true;
        }
    }
    false
}

fn parallel_call_has_simple_arguments(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    call.arguments.iter().all(|argument| {
        let Some(expression) = argument.as_expression() else {
            return false;
        };
        let expression = expression.get_inner_expression();
        matches!(expression, Expression::Identifier(_)) || expression.is_literal()
    })
}

fn parallel_callee_identifier_trail(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Vec<String> {
    let span = call.callee.span();
    let mut identifiers = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            if !span.contains_inclusive(candidate.span()) {
                return None;
            }
            let name = match candidate.kind() {
                AstKind::IdentifierReference(identifier) => identifier.name.as_str(),
                AstKind::IdentifierName(identifier) => identifier.name.as_str(),
                _ => return None,
            };
            Some((candidate.span().start, name.to_string()))
        })
        .collect::<Vec<_>>();
    identifiers.sort_unstable_by_key(|(start, _)| *start);
    identifiers.into_iter().map(|(_, name)| name).collect()
}

fn parallel_awaits_are_independent(statements: &[Statement<'_>], ctx: &LintContext<'_>) -> bool {
    let mut declared_symbols = FxHashSet::default();
    for statement in statements {
        let Some(awaited_expression) = parallel_awaited_expression(statement) else {
            continue;
        };
        if ctx.nodes().iter().any(|candidate| {
            let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                return false;
            };
            awaited_expression
                .span()
                .contains_inclusive(candidate.span())
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_some_and(|symbol_id| declared_symbols.contains(&symbol_id))
        }) {
            return false;
        }
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        let pattern_span = declaration.declarations[0].id.span();
        for candidate in ctx.nodes().iter() {
            if pattern_span.contains_inclusive(candidate.span())
                && let AstKind::BindingIdentifier(identifier) = candidate.kind()
            {
                declared_symbols.insert(identifier.symbol_id());
            }
        }
    }
    true
}

fn parallel_resolve_local_call_function(
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
    parallel_resolve_symbol_function(symbol_id, &mut FxHashSet::default(), ctx)
}

fn parallel_resolve_symbol_function(
    symbol_id: SymbolId,
    visited: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    if !visited.insert(symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function) => Some(function.node_id.get()),
        AstKind::VariableDeclarator(declarator) => {
            let initializer = declarator.init.as_ref()?.get_inner_expression();
            match initializer {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                Expression::Identifier(alias) => {
                    let alias_symbol = ctx
                        .scoping()
                        .get_reference(alias.reference_id())
                        .symbol_id()?;
                    parallel_resolve_symbol_function(alias_symbol, visited, ctx)
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn parallel_member_call_may_be_mutated(
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
    ctx.nodes().iter().any(|candidate| {
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            return false;
        };
        let Some(target) = assignment.left.as_member_expression() else {
            return false;
        };
        let Expression::Identifier(target_receiver) = target.object().get_inner_expression() else {
            return false;
        };
        ctx.scoping()
            .get_reference(target_receiver.reference_id())
            .symbol_id()
            == Some(receiver_symbol_id)
            && target
                .static_property_name()
                .is_none_or(|target_property| target_property == property_name)
    })
}

fn parallel_is_inside_transaction_callback(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        for call_ancestor in ctx.nodes().ancestors(ancestor.id()) {
            let AstKind::CallExpression(call) = call_ancestor.kind() else {
                if matches!(
                    call_ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ) {
                    break;
                }
                continue;
            };
            match call.callee.get_inner_expression() {
                Expression::Identifier(identifier) if identifier.name == "transaction" => {
                    return true;
                }
                expression => {
                    if expression
                        .get_member_expr()
                        .and_then(MemberExpression::static_property_name)
                        .as_deref()
                        == Some("transaction")
                    {
                        return true;
                    }
                }
            }
            break;
        }
    }
    false
}
