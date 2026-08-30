use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, CallExpression, Expression, FunctionBody, IdentifierReference,
        Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use oxc_syntax::operator::UnaryOperator;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::ImportImportName,
    rule::Rule,
};

const DETOX_ELEMENT_ACTIONS: [&str; 23] = [
    "tap",
    "multiTap",
    "longPress",
    "longPressAndDrag",
    "swipe",
    "scroll",
    "scrollTo",
    "scrollToIndex",
    "scrollToElement",
    "typeText",
    "replaceText",
    "clearText",
    "tapReturnKey",
    "tapBackspaceKey",
    "tapAtPoint",
    "pinch",
    "pinchWithAngle",
    "setColumnToValue",
    "setDatePickerDate",
    "performAccessibilityAction",
    "adjustSliderToPosition",
    "getAttributes",
    "takeScreenshot",
];
const PROMISE_SETTLE_METHODS: [&str; 3] = ["then", "catch", "finally"];
const TEST_CALL_NAMES: [&str; 3] = ["it", "specify", "test"];

#[derive(Debug, Default, Clone)]
pub struct RnDetoxMissingAwait;

declare_oxc_lint!(
    /// Disallow un-awaited Detox actions and assertions.
    RnDetoxMissingAwait,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow un-awaited Detox operations.",
);

struct DetoxChainRoot<'a, 'b> {
    callee: &'b IdentifierReference<'a>,
    root_call: &'b CallExpression<'a>,
}

impl Rule for RnDetoxMissingAwait {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        is_react_native_file_active(ctx)
            && detox_is_test_filename(&ctx.file_path().to_string_lossy().replace('\\', "/"))
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ExpressionStatement(statement) = node.kind() else {
            return;
        };
        let expression = match &statement.expression {
            Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Void => {
                unary.argument.get_inner_expression()
            }
            expression => expression,
        };
        let Expression::CallExpression(call) = expression else {
            return;
        };
        if detox_is_completed_by_done_callback(node, call, ctx) {
            return;
        }
        let Some(terminal_method) = detox_operation_method_name(call, ctx) else {
            return;
        };
        let Some(root) = detox_find_chain_root(expression) else {
            return;
        };
        let Some(root_name) = detox_canonical_root_name(&root, ctx) else {
            return;
        };
        if matches!(root_name.as_str(), "element" | "web") {
            if !DETOX_ELEMENT_ACTIONS.contains(&terminal_method) {
                return;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This Detox action (`{terminal_method}`) isn't awaited, so it runs out of order and can race. Prepend `await`."
                ))
                .with_label(statement.span),
            );
            return;
        }
        if root_name == "waitFor" {
            ctx.diagnostic(
                OxcDiagnostic::warn("This Detox `waitFor` chain isn't awaited, so the test can continue before the condition settles. Prepend `await`.")
                    .with_label(statement.span),
            );
            return;
        }
        if root_name == "expect" && detox_is_expect_subject(root.root_call, ctx) {
            ctx.diagnostic(
                OxcDiagnostic::warn("This Detox `expect(element)` assertion isn't awaited, so the test can pass or fail before the assertion settles. Prepend `await`.")
                    .with_label(statement.span),
            );
        }
    }
}

fn detox_is_test_filename(filename: &str) -> bool {
    let filename = filename.trim_start_matches("./");
    let has_e2e_directory = filename.starts_with("e2e/") || filename.contains("/e2e/");
    has_e2e_directory
        || [
            ".e2e.js",
            ".e2e.jsx",
            ".e2e.ts",
            ".e2e.tsx",
            ".e2e.cjs",
            ".e2e.cjsx",
            ".e2e.cts",
            ".e2e.ctsx",
            ".e2e.mjs",
            ".e2e.mjsx",
            ".e2e.mts",
            ".e2e.mtsx",
        ]
        .iter()
        .any(|suffix| filename.ends_with(suffix))
}

fn detox_find_chain_root<'a, 'b>(expression: &'b Expression<'a>) -> Option<DetoxChainRoot<'a, 'b>> {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call) = expression {
        return detox_find_chain_root_from_call(call);
    }
    expression
        .as_member_expression()
        .and_then(|member| detox_find_chain_root(member.object()))
}

fn detox_find_chain_root_from_call<'a, 'b>(
    call: &'b CallExpression<'a>,
) -> Option<DetoxChainRoot<'a, 'b>> {
    let callee = call.callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        return Some(DetoxChainRoot {
            callee: identifier,
            root_call: call,
        });
    }
    let member = callee.as_member_expression()?;
    let receiver = member.object().get_inner_expression();
    if let Expression::Identifier(identifier) = receiver
        && member.static_property_name() == Some("element")
    {
        return Some(DetoxChainRoot {
            callee: identifier,
            root_call: call,
        });
    }
    detox_find_chain_root(member.object())
}

fn detox_canonical_root_name<'a>(
    root: &DetoxChainRoot<'a, '_>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    if let Some(import_entry) = resolve_identifier_import(root.callee, ctx) {
        if import_entry.module_request.name() != "detox" {
            return None;
        }
        return Some(match &import_entry.import_name {
            ImportImportName::Name(name) => name.name().to_string(),
            ImportImportName::Default(_) | ImportImportName::NamespaceObject => {
                root.callee.name.to_string()
            }
        });
    }
    ctx.scoping()
        .get_reference(root.callee.reference_id())
        .symbol_id()
        .is_none()
        .then(|| root.callee.name.to_string())
}

fn detox_terminal_method_name<'a>(call: &'a CallExpression<'a>) -> Option<&'a str> {
    call.callee
        .get_inner_expression()
        .as_member_expression()?
        .static_property_name()
}

fn detox_operation_method_name<'a, 'b>(
    call: &'b CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'b str> {
    let mut current = call;
    loop {
        let method_name = detox_terminal_method_name(current)?;
        if !PROMISE_SETTLE_METHODS.contains(&method_name) {
            return Some(method_name);
        }
        if method_name == "catch" {
            if detox_is_callable_handler(current.arguments.first(), ctx, &mut FxHashSet::default())
            {
                return None;
            }
        } else if method_name == "then"
            && detox_is_callable_handler(current.arguments.get(1), ctx, &mut FxHashSet::default())
        {
            return None;
        }
        let member = current
            .callee
            .get_inner_expression()
            .as_member_expression()?;
        let Expression::CallExpression(receiver) = member.object().get_inner_expression() else {
            return None;
        };
        current = receiver;
    }
}

fn detox_is_callable_handler<'a>(
    argument: Option<&Argument<'a>>,
    ctx: &LintContext<'a>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(expression) = argument.and_then(Argument::as_expression) else {
        return false;
    };
    detox_is_callable_expression(expression, ctx, visited)
}

fn detox_is_callable_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) || expression.as_member_expression().is_some()
    {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id();
    if identifier.name == "undefined" && symbol_id.is_none() {
        return false;
    }
    let Some(symbol_id) = symbol_id else {
        return true;
    };
    if !visited.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if matches!(
        declaration.kind(),
        AstKind::Function(_)
            | AstKind::ImportSpecifier(_)
            | AstKind::ImportDefaultSpecifier(_)
            | AstKind::ImportNamespaceSpecifier(_)
            | AstKind::FormalParameter(_)
    ) {
        return true;
    }
    matches!(declaration.kind(), AstKind::VariableDeclarator(declarator) if declarator.init.as_ref().is_some_and(|initializer| detox_is_callable_expression(initializer, ctx, visited)))
}

fn detox_is_expect_subject<'a>(root_call: &CallExpression<'a>, ctx: &LintContext<'a>) -> bool {
    let Some(Expression::CallExpression(subject_call)) = root_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let Some(subject_root) = detox_find_chain_root_from_call(subject_call) else {
        return false;
    };
    detox_canonical_root_name(&subject_root, ctx)
        .is_some_and(|name| matches!(name.as_str(), "element" | "web"))
}

fn detox_is_completed_by_done_callback<'a>(
    statement_node: &AstNode<'a>,
    chain_call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if detox_terminal_method_name(chain_call) != Some("then") {
        return false;
    }
    let Some(test_callback) = crate::ast_util::get_enclosing_function(statement_node, ctx) else {
        return false;
    };
    let callback_root = transparent_expression_root(test_callback, ctx);
    let test_call_node = ctx.nodes().parent_node(callback_root.id());
    let AstKind::CallExpression(test_call) = test_call_node.kind() else {
        return false;
    };
    if !test_call.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == callback_root.span())
    }) {
        return false;
    }
    let is_parameterized = detox_is_parameterized_test_call(&test_call.callee);
    if !TEST_CALL_NAMES.contains(&detox_test_call_name(&test_call.callee).unwrap_or(""))
        && !is_parameterized
    {
        return false;
    }
    let Some((parameter_count, done_symbol_id)) = detox_done_parameter(test_callback) else {
        return false;
    };
    if (!is_parameterized && parameter_count != 1) || parameter_count == 0 {
        return false;
    }
    let Some(fulfillment_handler) = chain_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    if detox_identifier_symbol_id(fulfillment_handler.get_inner_expression(), ctx)
        == Some(done_symbol_id)
    {
        return true;
    }
    detox_handler_schedules_done(fulfillment_handler, done_symbol_id, ctx)
}

fn detox_test_call_name<'a>(callee: &'a Expression<'a>) -> Option<&'a str> {
    let callee = callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        return Some(identifier.name.as_str());
    }
    let member = callee.as_member_expression()?;
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return None;
    };
    Some(receiver.name.as_str())
}

fn detox_is_parameterized_test_call(callee: &Expression<'_>) -> bool {
    let Expression::CallExpression(each_call) = callee.get_inner_expression() else {
        return false;
    };
    let Some(each_member) = each_call
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if each_member.static_property_name() != Some("each") {
        return false;
    }
    matches!(each_member.object().get_inner_expression(), Expression::Identifier(identifier) if TEST_CALL_NAMES.contains(&identifier.name.as_str()))
}

fn detox_done_parameter(function_node: &AstNode<'_>) -> Option<(usize, oxc_semantic::SymbolId)> {
    let formal_parameters = match function_node.kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return None,
    };
    if formal_parameters.rest.is_some() {
        return None;
    }
    let parameter = formal_parameters.items.last()?;
    let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
        return None;
    };
    Some((formal_parameters.items.len(), identifier.symbol_id()))
}

fn detox_handler_schedules_done<'a>(
    handler: &Expression<'a>,
    done_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(completion) = detox_handler_completion_expression(handler) else {
        return false;
    };
    if detox_call_targets_symbol(completion, done_symbol_id, ctx) {
        return true;
    }
    let Expression::CallExpression(timer_call) = completion.get_inner_expression() else {
        return false;
    };
    let Expression::Identifier(timer_callee) = timer_call.callee.get_inner_expression() else {
        return false;
    };
    if timer_callee.name != "setTimeout"
        || ctx
            .scoping()
            .get_reference(timer_callee.reference_id())
            .symbol_id()
            .is_some()
    {
        return false;
    }
    let Some(timer_handler) = timer_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    if detox_identifier_symbol_id(timer_handler.get_inner_expression(), ctx) == Some(done_symbol_id)
    {
        return true;
    }
    detox_handler_schedules_done(timer_handler, done_symbol_id, ctx)
}

fn detox_handler_completion_expression<'a, 'b>(
    handler: &'b Expression<'a>,
) -> Option<&'b Expression<'a>> {
    match handler.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => function.get_expression().or_else(|| {
            function
                .body
                .as_function_body()
                .and_then(detox_function_body_completion)
        }),
        Expression::FunctionExpression(function) => function
            .body
            .as_ref()
            .and_then(|body| detox_function_body_completion(body)),
        _ => None,
    }
}

fn detox_function_body_completion<'a, 'b>(
    body: &'b FunctionBody<'a>,
) -> Option<&'b Expression<'a>> {
    if !body.directives.is_empty() {
        return None;
    }
    let [statement] = body.statements.as_slice() else {
        return None;
    };
    match statement {
        Statement::ExpressionStatement(statement) => Some(&statement.expression),
        Statement::ReturnStatement(statement) => statement.argument.as_ref(),
        _ => None,
    }
}

fn detox_call_targets_symbol(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    detox_identifier_symbol_id(call.callee.get_inner_expression(), ctx) == Some(symbol_id)
}

fn detox_identifier_symbol_id(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}
