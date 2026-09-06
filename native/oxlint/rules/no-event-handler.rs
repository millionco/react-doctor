use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MAX_EFFECT_EXECUTION_FRAMES: usize = 8;
const EFFECT_CALLBACK_DIRECT_CALLEES: [&str; 6] = [
    "queueMicrotask",
    "requestAnimationFrame",
    "requestIdleCallback",
    "setImmediate",
    "setInterval",
    "setTimeout",
];
const EFFECT_CALLBACK_MEMBER_CALLEES: [&str; 13] = [
    "catch",
    "every",
    "filter",
    "finally",
    "find",
    "findIndex",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
    "then",
];
const EVENT_HANDLER_DIRECT_CALLEES: [&str; 14] = [
    "fetch",
    "post",
    "put",
    "patch",
    "navigate",
    "navigateTo",
    "showNotification",
    "toast",
    "alert",
    "confirm",
    "logVisit",
    "captureEvent",
    "sendBeacon",
    "request",
];
const EVENT_HANDLER_MEMBER_METHODS: [&str; 8] = [
    "post", "put", "patch", "delete", "navigate", "capture", "track", "logEvent",
];
const EVENT_HANDLER_NAVIGATION_METHODS: [&str; 2] = ["push", "replace"];
const EVENT_HANDLER_NAVIGATION_RECEIVERS: [&str; 5] =
    ["router", "navigation", "navigator", "history", "location"];
const SCHEDULER_CALLEES: [&str; 4] = [
    "setTimeout",
    "setInterval",
    "queueMicrotask",
    "requestAnimationFrame",
];

#[derive(Debug, Default, Clone)]
pub struct NoEventHandler;

declare_oxc_lint!(
    /// Warns when an effect simulates an event handler through state.
    NoEventHandler,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when an effect simulates an event handler through state.",
);

impl Rule for NoEventHandler {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(effect_call) = node.kind() else {
            return;
        };
        if !is_react_hook_call(effect_call, &["useEffect"], ctx) {
            return;
        }
        let Some(callback_node_id) = effect_callback_node_id(effect_call) else {
            return;
        };
        if effect_has_cleanup(callback_node_id, ctx) {
            return;
        }
        for frame_node_id in collect_effect_execution_frames(callback_node_id, ctx) {
            for candidate in ctx.nodes().iter() {
                let AstKind::IfStatement(if_statement) = candidate.kind() else {
                    continue;
                };
                if if_statement.alternate.is_some()
                    || nearest_enclosing_function_node_id(candidate.id(), ctx)
                        != Some(frame_node_id)
                    || !consequent_has_transferable_work(
                        if_statement.consequent.span(),
                        frame_node_id,
                        ctx,
                    )
                {
                    continue;
                }
                let guard_sources = collect_reactive_sources(if_statement.test.span(), ctx);
                let event_state_sources = guard_sources
                    .state_symbol_ids
                    .iter()
                    .filter_map(|state_symbol_id| {
                        let setter_symbol_id = state_setter_symbol_id(*state_symbol_id, ctx)?;
                        let component_node_id = state_component_node_id(*state_symbol_id, ctx)?;
                        setter_is_written_only_from_event_handlers(
                            setter_symbol_id,
                            component_node_id,
                            ctx,
                        )
                        .then_some((*state_symbol_id, component_node_id))
                    })
                    .collect::<Vec<_>>();
                if event_state_sources.len() != 1 {
                    continue;
                }
                let (handler_state_symbol_id, component_node_id) = event_state_sources[0];
                if guard_sources
                    .state_symbol_ids
                    .iter()
                    .any(|state_symbol_id| *state_symbol_id != handler_state_symbol_id)
                    || guard_sources.referenced_symbol_ids.iter().any(|symbol_id| {
                        symbol_is_component_parameter(*symbol_id, component_node_id, ctx)
                    })
                    || consequent_has_additional_reactive_guard(
                        if_statement.consequent.span(),
                        frame_node_id,
                        handler_state_symbol_id,
                        component_node_id,
                        ctx,
                    )
                {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(
                        "Faking an event handler with state plus a useEffect costs an extra render & runs late.",
                    )
                    .with_label(effect_call.span),
                );
                return;
            }
        }
    }
}

#[derive(Default)]
struct ReactiveSources {
    state_symbol_ids: Vec<oxc_semantic::SymbolId>,
    referenced_symbol_ids: Vec<oxc_semantic::SymbolId>,
}

fn effect_callback_node_id(
    effect_call: &oxc_ast::ast::CallExpression<'_>,
) -> Option<oxc_semantic::NodeId> {
    match effect_call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)?
        .get_inner_expression()
    {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    }
}

fn effect_has_cleanup(callback_node_id: oxc_semantic::NodeId, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        matches!(
            candidate.kind(),
            AstKind::ReturnStatement(return_statement) if return_statement.argument.is_some()
        ) && nearest_enclosing_function_node_id(candidate.id(), ctx) == Some(callback_node_id)
    })
}

fn collect_effect_execution_frames(
    callback_node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> Vec<oxc_semantic::NodeId> {
    let mut frame_node_ids = vec![callback_node_id];
    let mut frame_index = 0;
    while frame_index < frame_node_ids.len() && frame_node_ids.len() < MAX_EFFECT_EXECUTION_FRAMES {
        let frame_node_id = frame_node_ids[frame_index];
        frame_index += 1;
        for candidate in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                continue;
            };
            if nearest_enclosing_function_node_id(candidate.id(), ctx) != Some(frame_node_id) {
                continue;
            }
            if let Some(called_function_node_id) =
                local_called_function_node_id(call_expression, ctx)
                && !frame_node_ids.contains(&called_function_node_id)
            {
                frame_node_ids.push(called_function_node_id);
                if frame_node_ids.len() == MAX_EFFECT_EXECUTION_FRAMES {
                    break;
                }
            }
            if !call_invokes_function_arguments(call_expression) {
                continue;
            }
            for argument in &call_expression.arguments {
                let Some(argument_function_node_id) = argument
                    .as_expression()
                    .and_then(|expression| expression_function_node_id(expression, ctx))
                else {
                    continue;
                };
                if !frame_node_ids.contains(&argument_function_node_id) {
                    frame_node_ids.push(argument_function_node_id);
                    if frame_node_ids.len() == MAX_EFFECT_EXECUTION_FRAMES {
                        break;
                    }
                }
            }
        }
    }
    frame_node_ids
}

fn call_invokes_function_arguments(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            EFFECT_CALLBACK_DIRECT_CALLEES.contains(&identifier.name.as_str())
        }
        expression => expression
            .as_member_expression()
            .and_then(|member_expression| member_expression.static_property_name())
            .is_some_and(|method_name| EFFECT_CALLBACK_MEMBER_CALLEES.contains(&method_name)),
    }
}

fn expression_function_node_id(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) if !function.r#async => {
            Some(function.node_id.get())
        }
        Expression::FunctionExpression(function) if !function.r#async => {
            Some(function.node_id.get())
        }
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .and_then(|symbol_id| symbol_function_node_id(symbol_id, ctx))
            .filter(|function_node_id| !function_node_is_async(*function_node_id, ctx)),
        _ => None,
    }
}

fn local_called_function_node_id(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    match call_expression.callee.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) if !function.r#async => {
            Some(function.node_id.get())
        }
        Expression::FunctionExpression(function) if !function.r#async => {
            Some(function.node_id.get())
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            symbol_function_node_id(symbol_id, ctx)
                .filter(|function_node_id| !function_node_is_async(*function_node_id, ctx))
        }
        _ => None,
    }
}

fn function_node_is_async(function_node_id: oxc_semantic::NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(function_node_id).kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn nearest_enclosing_function_node_id(
    node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}

fn collect_reactive_sources(span: oxc_span::Span, ctx: &LintContext<'_>) -> ReactiveSources {
    let mut sources = ReactiveSources::default();
    let mut visited_symbol_ids = Vec::new();
    collect_reactive_sources_in_span(span, ctx, &mut visited_symbol_ids, &mut sources);
    sources
}

fn collect_reactive_sources_in_span(
    span: oxc_span::Span,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    sources: &mut ReactiveSources,
) {
    for candidate in ctx.nodes().iter() {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            continue;
        };
        if !span.contains_inclusive(identifier.span) {
            continue;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            continue;
        };
        collect_reactive_source_symbol(symbol_id, ctx, visited_symbol_ids, sources);
    }
}

fn collect_reactive_source_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    sources: &mut ReactiveSources,
) {
    if !sources.referenced_symbol_ids.contains(&symbol_id) {
        sources.referenced_symbol_ids.push(symbol_id);
    }
    if symbol_is_state_value(symbol_id, ctx) {
        if !sources.state_symbol_ids.contains(&symbol_id) {
            sources.state_symbol_ids.push(symbol_id);
        }
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return;
    };
    let Some(initializer) = &declarator.init else {
        return;
    };
    collect_reactive_sources_in_span(initializer.span(), ctx, visited_symbol_ids, sources);
}

fn symbol_is_state_value(symbol_id: oxc_semantic::SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let oxc_ast::ast::BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    let Some(oxc_ast::ast::BindingPattern::BindingIdentifier(state_identifier)) =
        pattern.elements.first().and_then(Option::as_ref)
    else {
        return false;
    };
    let Some(Expression::CallExpression(use_state_call)) = &declarator.init else {
        return false;
    };
    state_identifier.symbol_id() == symbol_id
        && is_react_hook_call(use_state_call, &["useState"], ctx)
}

fn state_component_node_id(
    state_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    let declaration = ctx.symbol_declaration(state_symbol_id);
    nearest_enclosing_function_node_id(declaration.id(), ctx)
}

fn symbol_is_component_parameter(
    symbol_id: oxc_semantic::SymbolId,
    component_node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let declaration_span = ctx.symbol_declaration(symbol_id).span();
    match ctx.nodes().get_node(component_node_id).kind() {
        AstKind::Function(function) => function.params.span.contains_inclusive(declaration_span),
        AstKind::ArrowFunctionExpression(function) => {
            function.params.span.contains_inclusive(declaration_span)
        }
        _ => false,
    }
}

fn consequent_has_additional_reactive_guard(
    consequent_span: oxc_span::Span,
    frame_node_id: oxc_semantic::NodeId,
    handler_state_symbol_id: oxc_semantic::SymbolId,
    component_node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IfStatement(if_statement) = candidate.kind() else {
            return false;
        };
        if !consequent_span.contains_inclusive(candidate.span())
            || nearest_enclosing_function_node_id(candidate.id(), ctx) != Some(frame_node_id)
        {
            return false;
        }
        let sources = collect_reactive_sources(if_statement.test.span(), ctx);
        sources
            .state_symbol_ids
            .iter()
            .any(|state_symbol_id| *state_symbol_id != handler_state_symbol_id)
            || sources
                .referenced_symbol_ids
                .iter()
                .any(|symbol_id| symbol_is_component_parameter(*symbol_id, component_node_id, ctx))
    })
}

fn consequent_has_transferable_work(
    consequent_span: oxc_span::Span,
    frame_node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return false;
        };
        consequent_span.contains_inclusive(candidate.span())
            && nearest_enclosing_function_node_id(candidate.id(), ctx) == Some(frame_node_id)
            && call_is_transferable_work(call_expression, ctx)
    })
}

fn call_is_transferable_work(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if is_deferred_focus_synchronization(call_expression, ctx) {
        return false;
    }
    if call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
        .is_some_and(|member_expression| is_collection_ref_mutation(member_expression, ctx))
    {
        return false;
    }
    if call_contains_triggered_side_effect(call_expression, ctx) {
        return true;
    }
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return true;
            };
            !symbol_eventually_calls_state_setter(symbol_id, ctx, &mut Vec::new())
                && !symbol_is_custom_hook_result(symbol_id, ctx)
        }
        expression => {
            let Some(member_expression) = expression.as_member_expression() else {
                return false;
            };
            let Some(method_name) = member_expression.static_property_name() else {
                return false;
            };
            if method_name == "setAttribute" {
                return true;
            }
            let Some(root_identifier) = member_root_identifier(member_expression.object()) else {
                return false;
            };
            ctx.scoping()
                .get_reference(root_identifier.reference_id())
                .symbol_id()
                .is_some_and(|symbol_id| {
                    ctx.nodes()
                        .ancestors(ctx.symbol_declaration(symbol_id).id())
                        .any(|ancestor| {
                            matches!(
                                ancestor.kind(),
                                AstKind::FormalParameter(_) | AstKind::FormalParameters(_)
                            )
                        })
                })
        }
    }
}

fn call_contains_triggered_side_effect(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(candidate_call) = candidate.kind() else {
            return false;
        };
        call_expression.span.contains_inclusive(candidate.span())
            && call_is_named_triggered_side_effect(candidate_call)
    })
}

fn call_is_named_triggered_side_effect(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            EVENT_HANDLER_DIRECT_CALLEES.contains(&identifier.name.as_str())
        }
        expression => {
            let Some(member_expression) = expression.as_member_expression() else {
                return false;
            };
            let Some(method_name) = member_expression.static_property_name() else {
                return false;
            };
            if EVENT_HANDLER_MEMBER_METHODS.contains(&method_name) {
                return true;
            }
            let Some(root_identifier) = member_root_identifier(member_expression.object()) else {
                return false;
            };
            EVENT_HANDLER_NAVIGATION_METHODS.contains(&method_name)
                && EVENT_HANDLER_NAVIGATION_RECEIVERS.contains(&root_identifier.name.as_str())
        }
    }
}

fn symbol_eventually_calls_state_setter(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if symbol_resolves_to_state_setter(symbol_id, ctx, &mut Vec::new()) {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let Some(function_node_id) = symbol_function_node_id(symbol_id, ctx) else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return false;
        };
        if nearest_enclosing_function_node_id(candidate.id(), ctx) != Some(function_node_id) {
            return false;
        }
        let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression()
        else {
            return false;
        };
        ctx.scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|called_symbol_id| {
                symbol_eventually_calls_state_setter(called_symbol_id, ctx, visited_symbol_ids)
            })
    })
}

fn symbol_resolves_to_state_setter(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if symbol_is_state_setter(symbol_id, ctx) {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(binding_identifier) = declarator.id.get_binding_identifier() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if binding_identifier.symbol_id() != symbol_id
        || !matches!(parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
    {
        return false;
    }
    let Some(Expression::Identifier(initializer)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    ctx.scoping()
        .get_reference(initializer.reference_id())
        .symbol_id()
        .is_some_and(|initializer_symbol_id| {
            symbol_resolves_to_state_setter(initializer_symbol_id, ctx, visited_symbol_ids)
        })
}

fn symbol_function_node_id(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function) => Some(function.node_id.get()),
        AstKind::VariableDeclarator(declarator) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                Expression::CallExpression(wrapper_call)
                    if is_react_hook_call(wrapper_call, &["useCallback"], ctx) =>
                {
                    wrapper_call
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression)
                        .and_then(|expression| match expression.get_inner_expression() {
                            Expression::ArrowFunctionExpression(function) => {
                                Some(function.node_id.get())
                            }
                            Expression::FunctionExpression(function) => {
                                Some(function.node_id.get())
                            }
                            _ => None,
                        })
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn symbol_is_state_setter(symbol_id: oxc_semantic::SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let oxc_ast::ast::BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    let Some(oxc_ast::ast::BindingPattern::BindingIdentifier(setter_identifier)) =
        pattern.elements.get(1).and_then(Option::as_ref)
    else {
        return false;
    };
    let Some(Expression::CallExpression(use_state_call)) = &declarator.init else {
        return false;
    };
    setter_identifier.symbol_id() == symbol_id
        && is_react_hook_call(use_state_call, &["useState"], ctx)
}

fn symbol_is_custom_hook_result(symbol_id: oxc_semantic::SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(Expression::CallExpression(initializer_call)) = &declarator.init else {
        return false;
    };
    matches!(
        initializer_call.callee.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name != "useReducer"
                && identifier.name.starts_with("use")
                && identifier
                    .name
                    .as_bytes()
                    .get(3)
                    .is_some_and(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
    )
}

fn is_deferred_focus_synchronization(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let scheduler_name = match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier)
            if SCHEDULER_CALLEES.contains(&identifier.name.as_str())
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none() =>
        {
            Some(identifier.name.as_str())
        }
        expression => expression
            .as_member_expression()
            .and_then(|member_expression| member_expression.static_property_name())
            .filter(|method_name| SCHEDULER_CALLEES.contains(method_name)),
    };
    scheduler_name.is_some()
        && ctx.nodes().iter().any(|candidate| {
            let AstKind::CallExpression(nested_call) = candidate.kind() else {
                return false;
            };
            call_expression.span.contains_inclusive(candidate.span())
                && nested_call
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .and_then(|member_expression| member_expression.static_property_name())
                    == Some("focus")
        })
}

fn is_collection_ref_mutation(
    member_expression: &oxc_ast::ast::MemberExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(method_name) = member_expression.static_property_name() else {
        return false;
    };
    if !["set", "add", "delete", "clear"].contains(&method_name) {
        return false;
    }
    let Some(root_identifier) = member_root_identifier(member_expression.object()) else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(root_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(Expression::CallExpression(use_ref_call)) = &declarator.init else {
        return false;
    };
    if !is_react_hook_call(use_ref_call, &["useRef"], ctx) {
        return false;
    }
    matches!(
        use_ref_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .map(Expression::get_inner_expression),
        Some(Expression::NewExpression(new_expression))
            if matches!(
                new_expression.callee.get_inner_expression(),
                Expression::Identifier(identifier)
                    if (identifier.name == "Map" || identifier.name == "Set")
                        && ctx
                            .scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                            .is_none()
            )
    )
}

fn member_root_identifier<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier),
        expression => member_root_identifier(expression.as_member_expression()?.object()),
    }
}
