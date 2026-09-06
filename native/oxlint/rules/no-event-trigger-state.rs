use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, Statement, UnaryOperator},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EVENT_TRIGGER_EFFECT_HOOKS: [&str; 3] =
    ["useEffect", "useInsertionEffect", "useLayoutEffect"];
const EVENT_TRIGGER_DIRECT_CALLEES: [&str; 14] = [
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
const EVENT_TRIGGER_MEMBER_METHODS: [&str; 8] = [
    "post", "put", "patch", "delete", "navigate", "capture", "track", "logEvent",
];
const EVENT_TRIGGER_NAVIGATION_METHODS: [&str; 2] = ["push", "replace"];
const EVENT_TRIGGER_NAVIGATION_RECEIVERS: [&str; 5] =
    ["router", "navigation", "navigator", "history", "location"];

#[derive(Debug, Default, Clone)]
pub struct NoEventTriggerState;

declare_oxc_lint!(
    /// Warns when state exists only to trigger an event-shaped effect.
    NoEventTriggerState,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when state exists only to trigger an event-shaped effect.",
);

impl Rule for NoEventTriggerState {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(effect_call) = node.kind() else {
            return;
        };
        if !is_react_hook_call(effect_call, &EVENT_TRIGGER_EFFECT_HOOKS, ctx) {
            return;
        }
        let Some(Expression::ArrayExpression(dependencies)) = effect_call
            .arguments
            .get(1)
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        if dependencies.elements.len() != 1 {
            return;
        }
        let Some(Expression::Identifier(dependency_identifier)) = dependencies
            .elements
            .first()
            .and_then(oxc_ast::ast::ArrayExpressionElement::as_expression)
        else {
            return;
        };
        let Some(state_symbol_id) = ctx
            .scoping()
            .get_reference(dependency_identifier.reference_id())
            .symbol_id()
        else {
            return;
        };
        let Some(setter_symbol_id) = state_setter_symbol_id(state_symbol_id, ctx) else {
            return;
        };
        let Some(component_node_id) = event_trigger_component_node_id(node, ctx) else {
            return;
        };
        let Some(callback) = effect_callback(effect_call) else {
            return;
        };
        let Some(if_statement) = sole_if_statement(callback) else {
            return;
        };
        if !guard_references_state(&if_statement.test, state_symbol_id, ctx)
            || state_is_render_reachable(
                state_symbol_id,
                dependency_identifier.span,
                callback.span(),
                component_node_id,
                ctx,
            )
            || !setter_is_written_only_from_event_handlers(setter_symbol_id, component_node_id, ctx)
        {
            return;
        }
        let Some(side_effect_name) =
            find_event_trigger_side_effect(if_statement.consequent.span(), ctx)
        else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "useState \"{}\" forces an extra render just to fire \"{}(...)\" from a useEffect.",
                dependency_identifier.name, side_effect_name,
            ))
            .with_label(effect_call.span),
        );
    }
}

fn effect_callback<'a>(
    effect_call: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<&'a Expression<'a>> {
    effect_call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
}

fn sole_if_statement<'a>(
    callback: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IfStatement<'a>> {
    let statements = match callback {
        Expression::ArrowFunctionExpression(function) => {
            &function.body.as_function_body()?.statements
        }
        Expression::FunctionExpression(function) => &function.body.as_ref()?.statements,
        _ => return None,
    };
    if statements.len() != 1 {
        return None;
    }
    let Statement::IfStatement(if_statement) = &statements[0] else {
        return None;
    };
    Some(if_statement)
}

fn guard_references_state(
    expression: &Expression<'_>,
    state_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            reference_symbol_id(identifier, ctx) == Some(state_symbol_id)
        }
        Expression::BinaryExpression(binary_expression) => {
            matches!(
                binary_expression.operator,
                oxc_syntax::operator::BinaryOperator::StrictInequality
                    | oxc_syntax::operator::BinaryOperator::StrictEquality
                    | oxc_syntax::operator::BinaryOperator::Inequality
                    | oxc_syntax::operator::BinaryOperator::Equality
            ) && [&binary_expression.left, &binary_expression.right]
                .iter()
                .any(|side| {
                    matches!(
                        side.get_inner_expression(),
                        Expression::Identifier(identifier)
                            if reference_symbol_id(identifier, ctx) == Some(state_symbol_id)
                    )
                })
        }
        Expression::StaticMemberExpression(member_expression) => {
            member_expression.property.name == "length"
                && matches!(
                    member_expression.object.get_inner_expression(),
                    Expression::Identifier(identifier)
                        if reference_symbol_id(identifier, ctx) == Some(state_symbol_id)
                )
        }
        Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == UnaryOperator::LogicalNot =>
        {
            guard_references_state(&unary_expression.argument, state_symbol_id, ctx)
        }
        _ => false,
    }
}

fn reference_symbol_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn event_trigger_component_node_id<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        let is_component = match ancestor.kind() {
            AstKind::Function(function) if function.is_function_declaration() => {
                function.id.as_ref().is_some_and(|identifier| {
                    is_event_trigger_component_name(identifier.name.as_str())
                })
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                let parent = ctx.nodes().parent_node(ancestor.id());
                matches!(
                    parent.kind(),
                    AstKind::VariableDeclarator(declarator)
                        if matches!(
                            &declarator.id,
                            BindingPattern::BindingIdentifier(identifier)
                                if is_event_trigger_component_name(identifier.name.as_str())
                        )
                )
            }
            _ => false,
        };
        is_component.then(|| ancestor.id())
    })
}

fn is_event_trigger_component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

fn state_is_render_reachable<'a>(
    state_symbol_id: oxc_semantic::SymbolId,
    dependency_span: oxc_span::Span,
    callback_span: oxc_span::Span,
    component_node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(state_symbol_id)
        .filter(|reference| {
            let span = ctx.nodes().get_node(reference.node_id()).span();
            span != dependency_span && !callback_span.contains_inclusive(span)
        })
        .any(|reference| is_render_reference(reference.node_id(), component_node_id, ctx))
}

fn is_render_reference(
    reference_node_id: oxc_semantic::NodeId,
    component_node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(reference_node_id) {
        if ancestor.id() == component_node_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
    }
    false
}

fn find_event_trigger_side_effect(
    consequent_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) -> Option<String> {
    ctx.nodes()
        .iter()
        .filter(|candidate| consequent_span.contains_inclusive(candidate.span()))
        .find_map(|candidate| {
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return None;
            };
            match call_expression.callee.get_inner_expression() {
                Expression::Identifier(identifier)
                    if EVENT_TRIGGER_DIRECT_CALLEES.contains(&identifier.name.as_str()) =>
                {
                    Some(identifier.name.to_string())
                }
                expression => {
                    let member_expression = expression.as_member_expression()?;
                    let method_name = member_expression.static_property_name()?;
                    let root_name = event_trigger_root_name(member_expression.object())?;
                    if EVENT_TRIGGER_MEMBER_METHODS.contains(&method_name)
                        || (EVENT_TRIGGER_NAVIGATION_METHODS.contains(&method_name)
                            && EVENT_TRIGGER_NAVIGATION_RECEIVERS.contains(&root_name))
                    {
                        Some(format!("{root_name}.{method_name}"))
                    } else {
                        None
                    }
                }
            }
        })
}

fn event_trigger_root_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => event_trigger_root_name(expression.as_member_expression()?.object()),
    }
}
