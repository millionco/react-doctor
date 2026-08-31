use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression, FunctionBody, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::UnaryOperator;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const SUBSCRIPTION_METHOD_NAMES: [&str; 7] = [
    "subscribe",
    "addEventListener",
    "addListener",
    "on",
    "watch",
    "listen",
    "sub",
];
const CLEANUP_RETURNING_SUBSCRIPTION_METHOD_NAMES: [&str; 3] = ["subscribe", "sub", "listen"];
const RELEASE_METHOD_NAMES: [&str; 12] = [
    "abort",
    "cancel",
    "close",
    "destroy",
    "disconnect",
    "dispose",
    "off",
    "remove",
    "removeEventListener",
    "removeListener",
    "stop",
    "unsubscribe",
];

#[derive(Debug, Default, Clone)]
pub struct PreferUseSyncExternalStore;

declare_oxc_lint!(
    /// Warns about hand-rolled external store subscriptions.
    PreferUseSyncExternalStore,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns about hand-rolled external store subscriptions.",
);

#[derive(Clone, Copy)]
struct ExternalStoreStateBinding<'a> {
    value_name: &'a str,
    setter_name: &'a str,
    declarator_span: Span,
    initializer: &'a Expression<'a>,
    state_call: &'a oxc_ast::ast::CallExpression<'a>,
}

#[derive(Clone, Copy)]
struct ExternalStoreSubscription<'a, 'b> {
    call: &'b oxc_ast::ast::CallExpression<'a>,
    bound_release_name: Option<&'b str>,
    bound_subscription_name: Option<&'b str>,
}

#[derive(Default)]
struct ExternalStoreModuleIndex {
    mutable_bindings: FxHashMap<SymbolId, String>,
    subscribe_functions: FxHashSet<SymbolId>,
}

impl Rule for PreferUseSyncExternalStore {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let module_index = external_store_build_module_index(ctx);
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function) if function.is_function_declaration() => {
                    let Some(name) = function
                        .id
                        .as_ref()
                        .map(|identifier| identifier.name.as_str())
                    else {
                        continue;
                    };
                    if !external_store_is_component_or_hook_name(name) {
                        continue;
                    }
                    if let Some(body) = &function.body {
                        external_store_check_component(body, &module_index, ctx);
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
                        continue;
                    };
                    if !external_store_is_component_or_hook_name(binding.name.as_str()) {
                        continue;
                    }
                    let Some(body) = declarator.init.as_ref().and_then(|initializer| {
                        external_store_inline_function_body(initializer.get_inner_expression())
                    }) else {
                        continue;
                    };
                    external_store_check_component(body, &module_index, ctx);
                }
                _ => {}
            }
        }
    }
}

fn external_store_is_component_or_hook_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
        || crate::utils::is_react_hook_name(name)
}

fn external_store_inline_function_body<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a FunctionBody<'a>> {
    match expression {
        Expression::ArrowFunctionExpression(function) => function.body.as_function_body(),
        Expression::FunctionExpression(function) => function.body.as_deref(),
        _ => None,
    }
}

fn external_store_check_component<'a>(
    body: &'a FunctionBody<'a>,
    module_index: &ExternalStoreModuleIndex,
    ctx: &LintContext<'a>,
) {
    let state_bindings = external_store_collect_state_bindings(&body.statements, ctx);
    if state_bindings.is_empty() {
        return;
    }
    let effect_calls = external_store_effect_calls(body.span, ctx);
    let mut module_reported_declarators = FxHashSet::default();

    for effect_call_id in effect_calls {
        let AstKind::CallExpression(effect_call) = ctx.nodes().get_node(effect_call_id).kind()
        else {
            continue;
        };
        if !external_store_has_empty_dependencies(effect_call) {
            continue;
        }
        let Some(callback_id) = external_store_effect_callback_id(effect_call, ctx) else {
            continue;
        };
        let callback_node = ctx.nodes().get_node(callback_id);
        if let Some(callback_body) = external_store_function_body(callback_node) {
            let effect_statements = callback_body
                .statements
                .iter()
                .filter(|statement| !is_no_op_statement(statement))
                .collect::<Vec<_>>();
            if effect_statements.len() >= 2
                && let Some(subscription) =
                    external_store_find_member_subscription(&effect_statements)
                && let Some(handler) =
                    external_store_subscription_handler(subscription.call, &effect_statements, ctx)
                && let Some((setter_name, setter_argument)) =
                    external_store_single_setter_call(handler, ctx)
                && let Some(binding) = state_bindings
                    .iter()
                    .find(|binding| binding.setter_name == setter_name)
            {
                let is_url_search_params = external_store_url_search_params_equal(
                    binding.initializer,
                    setter_argument,
                    ctx,
                );
                if (is_url_search_params
                    || external_store_expressions_equal(
                        binding.initializer,
                        setter_argument,
                        false,
                        ctx,
                    ))
                    && !external_store_is_trivial_literal(setter_argument, ctx)
                    && external_store_cleanup_releases(
                        &effect_statements,
                        subscription,
                        is_url_search_params,
                        ctx,
                    )
                {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(format!(
                            "Your users can see stale or torn values because useState \"{}\" syncs an outside store through a useEffect.",
                            binding.value_name
                        ))
                        .with_label(binding.declarator_span),
                    );
                }
            }
        }

        for binding in &state_bindings {
            if module_reported_declarators.contains(&binding.declarator_span)
                || module_index.mutable_bindings.is_empty()
                || module_index.subscribe_functions.is_empty()
            {
                continue;
            }
            let Some((store_symbol_id, store_name)) =
                external_store_module_snapshot(binding.state_call, module_index, ctx)
            else {
                continue;
            };
            if !module_index.mutable_bindings.contains_key(&store_symbol_id)
                || !external_store_effect_calls_module_subscribe(
                    callback_node.span(),
                    binding.setter_name,
                    module_index,
                    ctx,
                )
            {
                continue;
            }
            module_reported_declarators.insert(binding.declarator_span);
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users can miss updates or see torn values because useState \"{}\" snapshots module store \"{}\" at render but only subscribes later in a useEffect.",
                    binding.value_name, store_name
                ))
                .with_label(binding.declarator_span),
            );
        }
    }
}

fn external_store_collect_state_bindings<'a>(
    statements: &'a [Statement<'a>],
    ctx: &LintContext<'a>,
) -> Vec<ExternalStoreStateBinding<'a>> {
    let mut bindings = Vec::new();
    for statement in statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(value)) =
                pattern.elements.first().and_then(Option::as_ref)
            else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(setter)) =
                pattern.elements.get(1).and_then(Option::as_ref)
            else {
                continue;
            };
            if !external_store_is_setter_name(setter.name.as_str()) {
                continue;
            }
            let Some(Expression::CallExpression(call)) = declarator
                .init
                .as_ref()
                .map(Expression::get_inner_expression)
            else {
                continue;
            };
            if !is_react_api_call(call, "useState", ctx) {
                continue;
            }
            let Some(mut initializer) = call.arguments.first().and_then(Argument::as_expression)
            else {
                continue;
            };
            if let Expression::ArrowFunctionExpression(function) =
                initializer.get_inner_expression()
                && let Some(expression) = function.get_expression()
            {
                initializer = expression;
            }
            bindings.push(ExternalStoreStateBinding {
                value_name: value.name.as_str(),
                setter_name: setter.name.as_str(),
                declarator_span: declarator.span,
                initializer,
                state_call: call,
            });
        }
    }
    bindings
}

fn external_store_is_setter_name(name: &str) -> bool {
    name.starts_with("set") && name.as_bytes().get(3).is_some_and(u8::is_ascii_uppercase)
}

fn external_store_effect_calls(body_span: Span, ctx: &LintContext<'_>) -> Vec<NodeId> {
    ctx.nodes()
        .iter()
        .filter_map(|node| {
            let AstKind::CallExpression(call) = node.kind() else {
                return None;
            };
            (body_span.contains_inclusive(call.span)
                && EFFECT_HOOK_NAMES
                    .iter()
                    .any(|hook_name| is_react_api_call(call, hook_name, ctx)))
            .then_some(node.id())
        })
        .collect()
}

fn external_store_has_empty_dependencies(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    matches!(call.arguments.get(1).and_then(Argument::as_expression).map(Expression::get_inner_expression),
        Some(Expression::ArrayExpression(array)) if array.elements.is_empty())
}

fn external_store_effect_callback_id(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let callback = call.arguments.first()?.as_expression()?;
    match callback.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) => Some(function.node_id.get()),
                AstKind::VariableDeclarator(declarator) => {
                    match declarator.init.as_ref()?.get_inner_expression() {
                        Expression::ArrowFunctionExpression(function) => {
                            Some(function.node_id.get())
                        }
                        Expression::FunctionExpression(function) => Some(function.node_id.get()),
                        _ => None,
                    }
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn external_store_function_body<'a, 'b>(
    node: &'b crate::AstNode<'a>,
) -> Option<&'b FunctionBody<'a>> {
    match node.kind() {
        AstKind::ArrowFunctionExpression(function) => function.body.as_function_body(),
        AstKind::Function(function) => function.body.as_deref(),
        _ => None,
    }
}

fn external_store_find_member_subscription<'a, 'b>(
    statements: &[&'b Statement<'a>],
) -> Option<ExternalStoreSubscription<'a, 'b>> {
    for statement in statements {
        match statement {
            Statement::VariableDeclaration(declaration) => {
                for declarator in &declaration.declarations {
                    let Some(Expression::CallExpression(call)) = declarator
                        .init
                        .as_ref()
                        .map(Expression::get_inner_expression)
                    else {
                        continue;
                    };
                    let Some(method_name) = call
                        .callee
                        .get_inner_expression()
                        .as_member_expression()
                        .and_then(oxc_ast::ast::MemberExpression::static_property_name)
                    else {
                        continue;
                    };
                    if !SUBSCRIPTION_METHOD_NAMES.contains(&method_name) {
                        continue;
                    }
                    let bound_name = declarator
                        .id
                        .get_binding_identifier()
                        .map(|identifier| identifier.name.as_str());
                    let returns_cleanup = CLEANUP_RETURNING_SUBSCRIPTION_METHOD_NAMES
                        .contains(&method_name)
                        && (method_name != "listen"
                            || call.arguments.iter().any(|argument| {
                                matches!(
                                    argument
                                        .as_expression()
                                        .map(Expression::get_inner_expression),
                                    Some(
                                        Expression::ArrowFunctionExpression(_)
                                            | Expression::FunctionExpression(_)
                                    )
                                )
                            }));
                    return Some(ExternalStoreSubscription {
                        call,
                        bound_release_name: returns_cleanup.then_some(bound_name).flatten(),
                        bound_subscription_name: bound_name,
                    });
                }
            }
            Statement::ExpressionStatement(statement) => {
                let Expression::CallExpression(call) = statement.expression.get_inner_expression()
                else {
                    continue;
                };
                let Some(method_name) = call
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .and_then(oxc_ast::ast::MemberExpression::static_property_name)
                else {
                    continue;
                };
                if SUBSCRIPTION_METHOD_NAMES.contains(&method_name) {
                    return Some(ExternalStoreSubscription {
                        call,
                        bound_release_name: None,
                        bound_subscription_name: None,
                    });
                }
            }
            _ => {}
        }
    }
    None
}

fn external_store_subscription_handler<'a, 'b>(
    call: &'b oxc_ast::ast::CallExpression<'a>,
    effect_statements: &[&'b Statement<'a>],
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    for argument in &call.arguments {
        let Some(expression) = argument.as_expression() else {
            continue;
        };
        match expression.get_inner_expression() {
            Expression::ArrowFunctionExpression(function) => return Some(function.node_id.get()),
            Expression::FunctionExpression(function) => return Some(function.node_id.get()),
            Expression::Identifier(identifier) => {
                let Some(symbol_id) = ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                else {
                    continue;
                };
                for statement in effect_statements {
                    let Statement::VariableDeclaration(declaration) = statement else {
                        continue;
                    };
                    for declarator in &declaration.declarations {
                        if declarator
                            .id
                            .get_binding_identifier()
                            .is_none_or(|binding| binding.symbol_id() != symbol_id)
                        {
                            continue;
                        }
                        let Some(initializer) = &declarator.init else {
                            continue;
                        };
                        match initializer.get_inner_expression() {
                            Expression::ArrowFunctionExpression(function) => {
                                return Some(function.node_id.get());
                            }
                            Expression::FunctionExpression(function) => {
                                return Some(function.node_id.get());
                            }
                            _ => {}
                        }
                    }
                }
            }
            _ => {}
        }
    }
    None
}

fn external_store_single_setter_call<'a, 'b>(
    function_id: NodeId,
    ctx: &'b LintContext<'a>,
) -> Option<(&'b str, &'b Expression<'a>)> {
    let function_node = ctx.nodes().get_node(function_id);
    let expression = match function_node.kind() {
        AstKind::ArrowFunctionExpression(function) => function.get_expression().or_else(|| {
            function
                .body
                .as_function_body()
                .and_then(external_store_single_statement_expression)
        })?,
        AstKind::Function(function) => function
            .body
            .as_deref()
            .and_then(external_store_single_statement_expression)?,
        _ => return None,
    };
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return None;
    };
    let Expression::Identifier(setter) = call.callee.get_inner_expression() else {
        return None;
    };
    if !external_store_is_setter_name(setter.name.as_str()) {
        return None;
    }
    Some((
        setter.name.as_str(),
        call.arguments.first()?.as_expression()?,
    ))
}

fn external_store_single_statement_expression<'a>(
    body: &'a FunctionBody<'a>,
) -> Option<&'a Expression<'a>> {
    let mut expressions = body.statements.iter().filter_map(|statement| {
        if is_no_op_statement(statement) {
            return None;
        }
        match statement {
            Statement::ExpressionStatement(statement) => Some(&statement.expression),
            Statement::ReturnStatement(statement) => statement.argument.as_ref(),
            _ => None,
        }
    });
    let expression = expressions.next()?;
    expressions.next().is_none().then_some(expression)
}

fn external_store_is_trivial_literal(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    match expression.get_inner_expression() {
        expression if expression.is_literal() => true,
        Expression::Identifier(identifier) => {
            identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::UnaryNegation => {
            unary.argument.get_inner_expression().is_literal()
        }
        Expression::TemplateLiteral(template) => template.expressions.is_empty(),
        _ => false,
    }
}

fn external_store_cleanup_releases<'a, 'b>(
    statements: &[&'b Statement<'a>],
    subscription: ExternalStoreSubscription<'a, 'b>,
    requires_exact_event_listener_cleanup: bool,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(Statement::ReturnStatement(return_statement)) = statements.last().copied() else {
        return false;
    };
    let Some(returned) = &return_statement.argument else {
        return false;
    };
    if requires_exact_event_listener_cleanup {
        return external_store_event_listener_cleanup_matches(subscription.call, returned, ctx);
    }
    match returned.get_inner_expression() {
        Expression::Identifier(identifier) => subscription
            .bound_release_name
            .is_some_and(|name| identifier.name == name),
        Expression::CallExpression(call) => call
            .callee
            .get_inner_expression()
            .as_member_expression()
            .and_then(oxc_ast::ast::MemberExpression::static_property_name)
            .is_some_and(|method| CLEANUP_RETURNING_SUBSCRIPTION_METHOD_NAMES.contains(&method)),
        Expression::ArrowFunctionExpression(function) => external_store_function_has_release_call(
            function.node_id.get(),
            subscription.bound_subscription_name,
            ctx,
        ),
        Expression::FunctionExpression(function) => external_store_function_has_release_call(
            function.node_id.get(),
            subscription.bound_subscription_name,
            ctx,
        ),
        _ => false,
    }
}

fn external_store_function_has_release_call(
    function_id: NodeId,
    bound_subscription_name: Option<&str>,
    ctx: &LintContext<'_>,
) -> bool {
    let span = ctx.nodes().get_node(function_id).span();
    ctx.nodes().iter().any(|node| {
        if !span.contains_inclusive(node.span()) {
            return false;
        }
        let AstKind::CallExpression(call) = node.kind() else {
            return false;
        };
        match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => matches!(
                identifier.name.as_str(),
                "clearInterval" | "clearTimeout" | "unsubscribe" | "dispose" | "cancel"
            ),
            expression => expression
                .as_member_expression()
                .and_then(oxc_ast::ast::MemberExpression::static_property_name)
                .is_some_and(|method| {
                    RELEASE_METHOD_NAMES.contains(&method)
                        && (method != "remove"
                            || bound_subscription_name.is_some_and(|name| {
                                expression
                                    .as_member_expression()
                                    .is_some_and(|member| matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == name))
                            }))
                }),
        }
    })
}

fn external_store_event_listener_cleanup_matches(
    subscription: &oxc_ast::ast::CallExpression<'_>,
    returned: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some((subscribe_receiver, subscribe_event, subscribe_handler)) =
        external_store_event_listener_parts(subscription, "addEventListener")
    else {
        return false;
    };
    let cleanup_call = match returned.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => function
            .get_expression()
            .and_then(|expression| match expression.get_inner_expression() {
                Expression::CallExpression(call) => Some(call.as_ref()),
                _ => None,
            })
            .or_else(|| {
                function
                    .body
                    .as_function_body()
                    .and_then(external_store_single_statement_expression)
                    .and_then(|expression| match expression.get_inner_expression() {
                        Expression::CallExpression(call) => Some(call.as_ref()),
                        _ => None,
                    })
            }),
        Expression::FunctionExpression(function) => function
            .body
            .as_deref()
            .and_then(external_store_single_statement_expression)
            .and_then(|expression| match expression.get_inner_expression() {
                Expression::CallExpression(call) => Some(call.as_ref()),
                _ => None,
            }),
        _ => None,
    };
    let Some((cleanup_receiver, cleanup_event, cleanup_handler)) = cleanup_call
        .and_then(|call| external_store_event_listener_parts(call, "removeEventListener"))
    else {
        return false;
    };
    external_store_expressions_equal(subscribe_receiver, cleanup_receiver, true, ctx)
        && external_store_expressions_equal(subscribe_event, cleanup_event, true, ctx)
        && external_store_expressions_equal(subscribe_handler, cleanup_handler, true, ctx)
}

fn external_store_event_listener_parts<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    method_name: &str,
) -> Option<(&'a Expression<'a>, &'a Expression<'a>, &'a Expression<'a>)> {
    let member = call.callee.get_inner_expression().as_member_expression()?;
    if member.is_computed() || member.static_property_name().as_deref() != Some(method_name) {
        return None;
    }
    Some((
        member.object(),
        call.arguments.first()?.as_expression()?,
        call.arguments.get(1)?.as_expression()?,
    ))
}

fn external_store_url_search_params_equal(
    first: &Expression<'_>,
    second: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let (Expression::NewExpression(first), Expression::NewExpression(second)) =
        (first.get_inner_expression(), second.get_inner_expression())
    else {
        return false;
    };
    let (Expression::Identifier(first_callee), Expression::Identifier(second_callee)) = (
        first.callee.get_inner_expression(),
        second.callee.get_inner_expression(),
    ) else {
        return false;
    };
    first_callee.name == "URLSearchParams"
        && second_callee.name == "URLSearchParams"
        && ctx
            .scoping()
            .get_reference(first_callee.reference_id())
            .symbol_id()
            .is_none()
        && ctx
            .scoping()
            .get_reference(second_callee.reference_id())
            .symbol_id()
            .is_none()
        && first.arguments.len() == second.arguments.len()
        && !first.arguments.is_empty()
        && first
            .arguments
            .iter()
            .zip(&second.arguments)
            .all(
                |(first, second)| match (first.as_expression(), second.as_expression()) {
                    (Some(first), Some(second)) => {
                        external_store_expressions_equal(first, second, true, ctx)
                    }
                    _ => false,
                },
            )
}

fn external_store_expressions_equal(
    first: &Expression<'_>,
    second: &Expression<'_>,
    use_symbol_identity: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let first = first.get_inner_expression();
    let second = second.get_inner_expression();
    match (first, second) {
        (Expression::ThisExpression(_), Expression::ThisExpression(_))
        | (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::Identifier(first), Expression::Identifier(second)) => {
            if !use_symbol_identity {
                return first.name == second.name;
            }
            let first_symbol = ctx
                .scoping()
                .get_reference(first.reference_id())
                .symbol_id();
            let second_symbol = ctx
                .scoping()
                .get_reference(second.reference_id())
                .symbol_id();
            first_symbol == second_symbol && (first_symbol.is_some() || first.name == second.name)
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
        (Expression::PrivateFieldExpression(first), Expression::PrivateFieldExpression(second)) => {
            first.field.name == second.field.name
        }
        (Expression::CallExpression(first), Expression::CallExpression(second)) => {
            external_store_expressions_equal(
                &first.callee,
                &second.callee,
                use_symbol_identity,
                ctx,
            ) && first.arguments.len() == second.arguments.len()
                && first
                    .arguments
                    .iter()
                    .zip(&second.arguments)
                    .all(
                        |(first, second)| match (first.as_expression(), second.as_expression()) {
                            (Some(first), Some(second)) => external_store_expressions_equal(
                                first,
                                second,
                                use_symbol_identity,
                                ctx,
                            ),
                            _ => false,
                        },
                    )
        }
        _ => match (first.as_member_expression(), second.as_member_expression()) {
            (Some(first), Some(second)) if first.is_computed() == second.is_computed() => {
                external_store_expressions_equal(
                    first.object(),
                    second.object(),
                    use_symbol_identity,
                    ctx,
                ) && match (first, second) {
                    (
                        oxc_ast::ast::MemberExpression::StaticMemberExpression(first),
                        oxc_ast::ast::MemberExpression::StaticMemberExpression(second),
                    ) => first.property.name == second.property.name,
                    (
                        oxc_ast::ast::MemberExpression::ComputedMemberExpression(first),
                        oxc_ast::ast::MemberExpression::ComputedMemberExpression(second),
                    ) => external_store_expressions_equal(
                        &first.expression,
                        &second.expression,
                        use_symbol_identity,
                        ctx,
                    ),
                    _ => false,
                }
            }
            _ => false,
        },
    }
}

fn external_store_build_module_index(ctx: &LintContext<'_>) -> ExternalStoreModuleIndex {
    let mut index = ExternalStoreModuleIndex::default();
    let mut listener_names = FxHashSet::default();
    let mut function_nodes = Vec::new();
    for node in ctx.nodes().iter() {
        match node.kind() {
            AstKind::VariableDeclarator(declarator) => {
                let Some(binding) = declarator.id.get_binding_identifier() else {
                    continue;
                };
                if !ctx
                    .scoping()
                    .scope_flags(ctx.scoping().symbol_scope_id(binding.symbol_id()))
                    .is_top()
                {
                    continue;
                }
                let Some(initializer) = &declarator.init else {
                    continue;
                };
                let declaration = ctx.nodes().parent_node(node.id());
                let AstKind::VariableDeclaration(declaration) = declaration.kind() else {
                    continue;
                };
                if matches!(
                    declaration.kind,
                    oxc_ast::ast::VariableDeclarationKind::Let
                        | oxc_ast::ast::VariableDeclarationKind::Var
                ) && external_store_inline_function_body(initializer.get_inner_expression())
                    .is_none()
                {
                    index
                        .mutable_bindings
                        .insert(binding.symbol_id(), binding.name.as_str().to_string());
                    continue;
                }
                if external_store_is_listener_collection(initializer) {
                    listener_names.insert(binding.name.as_str().to_string());
                } else if let Some(body) =
                    external_store_inline_function_body(initializer.get_inner_expression())
                {
                    function_nodes.push((binding.symbol_id(), body.span));
                }
            }
            AstKind::Function(function)
                if function.is_function_declaration()
                    && function.id.as_ref().is_some_and(|identifier| {
                        ctx.scoping()
                            .scope_flags(ctx.scoping().symbol_scope_id(identifier.symbol_id()))
                            .is_top()
                    }) =>
            {
                if let (Some(identifier), Some(body)) = (&function.id, &function.body) {
                    function_nodes.push((identifier.symbol_id(), body.span));
                }
            }
            _ => {}
        }
    }
    for (symbol_id, body_span) in function_nodes {
        let declaration = ctx.symbol_declaration(symbol_id);
        let first_parameter_name = match declaration.kind() {
            AstKind::Function(function) => function
                .params
                .items
                .first()
                .and_then(|parameter| parameter.pattern.get_binding_identifier())
                .map(|identifier| identifier.name.as_str()),
            AstKind::VariableDeclarator(declarator) => declarator
                .init
                .as_ref()
                .and_then(|initializer| match initializer.get_inner_expression() {
                    Expression::ArrowFunctionExpression(function) => function
                        .params
                        .items
                        .first()
                        .and_then(|parameter| parameter.pattern.get_binding_identifier()),
                    Expression::FunctionExpression(function) => function
                        .params
                        .items
                        .first()
                        .and_then(|parameter| parameter.pattern.get_binding_identifier()),
                    _ => None,
                })
                .map(|identifier| identifier.name.as_str()),
            _ => None,
        };
        let Some(parameter_name) = first_parameter_name else {
            continue;
        };
        let registers = ctx.nodes().iter().any(|node| {
            if !body_span.contains_inclusive(node.span()) {
                return false;
            }
            let AstKind::CallExpression(call) = node.kind() else {
                return false;
            };
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            let Some(method_name) = member.static_property_name() else {
                return false;
            };
            if !matches!(method_name.as_ref(), "add" | "push") {
                return false;
            }
            matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                if listener_names.contains(identifier.name.as_str()))
                && matches!(call.arguments.first().and_then(Argument::as_expression).map(Expression::get_inner_expression),
                    Some(Expression::Identifier(identifier)) if identifier.name == parameter_name)
        });
        if registers {
            index.subscribe_functions.insert(symbol_id);
        }
    }
    index
}

fn external_store_is_listener_collection(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::ArrayExpression(_)
    ) || matches!(expression.get_inner_expression(), Expression::NewExpression(new_expression)
            if matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "Set"))
}

fn external_store_module_snapshot<'a, 'b>(
    state_call: &oxc_ast::ast::CallExpression<'a>,
    index: &'b ExternalStoreModuleIndex,
    ctx: &LintContext<'a>,
) -> Option<(SymbolId, &'b str)> {
    let mut initializer = state_call.arguments.first()?.as_expression()?;
    if let Expression::ArrowFunctionExpression(function) = initializer.get_inner_expression()
        && let Some(expression) = function.get_expression()
    {
        initializer = expression;
    }
    let Expression::Identifier(identifier) = initializer.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    index
        .mutable_bindings
        .get(&symbol_id)
        .map(|name| (symbol_id, name.as_str()))
}

fn external_store_effect_calls_module_subscribe(
    callback_span: Span,
    setter_name: &str,
    index: &ExternalStoreModuleIndex,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|node| {
        if !callback_span.contains_inclusive(node.span()) {
            return false;
        }
        let AstKind::CallExpression(call) = node.kind() else {
            return false;
        };
        let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
            return false;
        };
        let Some(callee_symbol_id) = ctx
            .scoping()
            .get_reference(callee.reference_id())
            .symbol_id()
        else {
            return false;
        };
        index.subscribe_functions.contains(&callee_symbol_id)
            && call.arguments.iter().any(|argument| {
                let Some(argument) = argument.as_expression() else {
                    return false;
                };
                match argument.get_inner_expression() {
                    Expression::Identifier(identifier) => identifier.name == setter_name,
                    Expression::ArrowFunctionExpression(function) => {
                        external_store_function_calls_setter(
                            function.node_id.get(),
                            setter_name,
                            ctx,
                        )
                    }
                    Expression::FunctionExpression(function) => {
                        external_store_function_calls_setter(
                            function.node_id.get(),
                            setter_name,
                            ctx,
                        )
                    }
                    _ => false,
                }
            })
    })
}

fn external_store_function_calls_setter(
    function_id: NodeId,
    setter_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let span = ctx.nodes().get_node(function_id).span();
    ctx.nodes().iter().any(|node| {
        if !span.contains_inclusive(node.span()) {
            return false;
        }
        let AstKind::CallExpression(call) = node.kind() else {
            return false;
        };
        let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
            return false;
        };
        identifier.name == setter_name
    })
}
