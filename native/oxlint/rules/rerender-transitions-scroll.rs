use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression, Statement},
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

const HIGH_FREQUENCY_DOM_EVENTS: [&str; 6] = [
    "scroll",
    "mousemove",
    "wheel",
    "pointermove",
    "touchmove",
    "drag",
];
const SCHEDULING_CALLEES: [&str; 3] = [
    "startTransition",
    "requestAnimationFrame",
    "requestIdleCallback",
];

#[derive(Debug, Default, Clone)]
pub struct RerenderTransitionsScroll;

struct RerenderScrollHandler {
    handler_id: NodeId,
    handler_body_span: Span,
    handler_span: Span,
    event_name: String,
}

declare_oxc_lint!(
    /// Warns when state updates redraw on every high-frequency DOM event.
    RerenderTransitionsScroll,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when state updates redraw on every high-frequency DOM event.",
);

impl Rule for RerenderTransitionsScroll {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let handlers = rerender_scroll_handlers(ctx);
        if handlers.is_empty() {
            return;
        }
        let handler_body_spans = handlers
            .iter()
            .map(|handler| (handler.handler_id, handler.handler_body_span))
            .collect::<FxHashMap<_, _>>();
        let handler_ids = handler_body_spans.keys().copied().collect::<FxHashSet<_>>();
        let setter_ids = rerender_scroll_state_setter_calls(&handler_body_spans, ctx);
        let deduplicated_handler_ids = rerender_scroll_deduplicated_handler_ids(&handler_ids, ctx);

        for handler in handlers {
            let Some(setter_id) = setter_ids.get(&handler.handler_id) else {
                continue;
            };
            let setter_node = ctx.nodes().get_node(*setter_id);
            if deduplicated_handler_ids.contains(&handler.handler_id)
                || rerender_scroll_setter_is_scheduled(setter_node, handler.handler_span, ctx)
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This can make scrolling stutter because setState in a \"{}\" handler redraws on every event. Wrap it in startTransition, use useDeferredValue, or keep the value in a ref and throttle with requestAnimationFrame.",
                    handler.event_name
                ))
                .with_label(setter_node.span()),
            );
        }
    }
}

fn rerender_scroll_handlers(ctx: &LintContext<'_>) -> Vec<RerenderScrollHandler> {
    ctx.nodes()
        .iter()
        .filter_map(|node| {
            let AstKind::CallExpression(listener_call) = node.kind() else {
                return None;
            };
            if !rerender_scroll_is_add_event_listener_callee(&listener_call.callee) {
                return None;
            }
            let Expression::StringLiteral(event_literal) = listener_call
                .arguments
                .first()
                .and_then(Argument::as_expression)?
            else {
                return None;
            };
            if !HIGH_FREQUENCY_DOM_EVENTS.contains(&event_literal.value.as_str()) {
                return None;
            }
            let handler = listener_call
                .arguments
                .get(1)
                .and_then(Argument::as_expression)?;
            let (handler_id, handler_body_span) = match handler {
                Expression::ArrowFunctionExpression(function) => (
                    function.node_id.get(),
                    function
                        .get_expression()
                        .map_or(function.body.span(), GetSpan::span),
                ),
                Expression::FunctionExpression(function) if function.body.is_some() => {
                    (function.node_id.get(), function.body.as_ref()?.span)
                }
                _ => return None,
            };
            Some(RerenderScrollHandler {
                handler_id,
                handler_body_span,
                handler_span: handler.span(),
                event_name: event_literal.value.to_string(),
            })
        })
        .collect()
}

fn rerender_scroll_is_add_event_listener_callee(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::StaticMemberExpression(member) => member.property.name == "addEventListener",
        Expression::ComputedMemberExpression(member) => {
            matches!(&member.expression, Expression::Identifier(identifier) if identifier.name == "addEventListener")
        }
        _ => false,
    }
}

fn rerender_scroll_state_setter_calls(
    handler_body_spans: &FxHashMap<NodeId, Span>,
    ctx: &LintContext<'_>,
) -> FxHashMap<NodeId, NodeId> {
    let mut setter_ids = FxHashMap::<NodeId, NodeId>::default();
    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        let Expression::Identifier(setter) = &call.callee else {
            continue;
        };
        if !rerender_scroll_is_setter_name(setter.name.as_str())
            || !rerender_scroll_is_use_state_setter_in_scope(candidate, setter.name.as_str(), ctx)
            || rerender_scroll_is_constant_only_argument(call.arguments.first())
        {
            continue;
        }
        for ancestor in ctx.nodes().ancestors(candidate.id()) {
            let Some(handler_body_span) = handler_body_spans.get(&ancestor.id()) else {
                continue;
            };
            if !handler_body_span.contains_inclusive(candidate.span()) {
                continue;
            }
            setter_ids
                .entry(ancestor.id())
                .and_modify(|setter_id| {
                    if candidate.span().start < ctx.nodes().get_node(*setter_id).span().start {
                        *setter_id = candidate.id();
                    }
                })
                .or_insert(candidate.id());
        }
    }
    setter_ids
}

fn rerender_scroll_is_setter_name(name: &str) -> bool {
    name.starts_with("set") && name.as_bytes().get(3).is_some_and(u8::is_ascii_uppercase)
}

fn rerender_scroll_is_constant_only_argument(argument: Option<&Argument<'_>>) -> bool {
    let Some(argument) = argument else {
        return true;
    };
    argument
        .as_expression()
        .is_some_and(rerender_scroll_is_constant_expression)
}

fn rerender_scroll_is_constant_expression(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::StringLiteral(_) => true,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        Expression::TemplateLiteral(template) => template.expressions.is_empty(),
        Expression::UnaryExpression(unary) => {
            rerender_scroll_is_constant_expression(&unary.argument)
        }
        _ => false,
    }
}

fn rerender_scroll_is_use_state_setter_in_scope(
    node: &AstNode<'_>,
    setter_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .any(|ancestor| match ancestor.kind() {
            AstKind::BlockStatement(block) => {
                rerender_scroll_statements_bind_setter(&block.body, setter_name)
            }
            AstKind::FunctionBody(body) => {
                rerender_scroll_statements_bind_setter(&body.statements, setter_name)
            }
            AstKind::Program(program) => {
                rerender_scroll_statements_bind_setter(&program.body, setter_name)
            }
            _ => false,
        })
}

fn rerender_scroll_statements_bind_setter(statements: &[Statement<'_>], setter_name: &str) -> bool {
    statements.iter().any(|statement| {
        let Statement::VariableDeclaration(declaration) = statement else {
            return false;
        };
        declaration.declarations.iter().any(|declarator| {
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                return false;
            };
            let Some(BindingPattern::BindingIdentifier(setter)) =
                pattern.elements.get(1).and_then(Option::as_ref)
            else {
                return false;
            };
            let Some(Expression::CallExpression(hook_call)) = &declarator.init else {
                return false;
            };
            setter.name == setter_name
                && rerender_scroll_callee_name(&hook_call.callee) == Some("useState")
        })
    })
}

fn rerender_scroll_callee_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        Expression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        Expression::ComputedMemberExpression(member) => {
            let Expression::Identifier(identifier) = &member.expression else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        _ => None,
    }
}

fn rerender_scroll_deduplicated_handler_ids(
    handler_ids: &FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> FxHashSet<NodeId> {
    let mut guard_handler_ids = FxHashMap::<NodeId, NodeId>::default();
    for candidate in ctx.nodes().iter() {
        let AstKind::IfStatement(_) = candidate.kind() else {
            continue;
        };
        if let Some(handler_id) = local_callback_nearest_function_id(candidate.id(), ctx)
            && handler_ids.contains(&handler_id)
        {
            guard_handler_ids.insert(candidate.id(), handler_id);
        }
    }
    let guard_ids = guard_handler_ids.keys().copied().collect::<FxHashSet<_>>();
    let mut guards_reading_ref = FxHashSet::<NodeId>::default();
    let mut guards_with_return = FxHashSet::<NodeId>::default();
    for candidate in ctx.nodes().iter() {
        let is_current_read = match candidate.kind() {
            AstKind::StaticMemberExpression(member) => member.property.name == "current",
            AstKind::ComputedMemberExpression(member) => {
                matches!(&member.expression, Expression::Identifier(identifier) if identifier.name == "current")
            }
            _ => false,
        };
        if is_current_read {
            for ancestor in ctx.nodes().ancestors(candidate.id()) {
                let AstKind::IfStatement(statement) = ancestor.kind() else {
                    continue;
                };
                if guard_ids.contains(&ancestor.id())
                    && statement.test.span().contains_inclusive(candidate.span())
                {
                    guards_reading_ref.insert(ancestor.id());
                }
            }
        }
        if !matches!(candidate.kind(), AstKind::ReturnStatement(_)) {
            continue;
        }
        for ancestor in ctx.nodes().ancestors(candidate.id()) {
            if rerender_scroll_is_function_node(ancestor) {
                break;
            }
            let AstKind::IfStatement(statement) = ancestor.kind() else {
                continue;
            };
            if guard_ids.contains(&ancestor.id())
                && statement
                    .consequent
                    .span()
                    .contains_inclusive(candidate.span())
            {
                guards_with_return.insert(ancestor.id());
            }
        }
    }
    guard_handler_ids
        .into_iter()
        .filter_map(|(guard_id, handler_id)| {
            (guards_reading_ref.contains(&guard_id) && guards_with_return.contains(&guard_id))
                .then_some(handler_id)
        })
        .collect()
}

fn rerender_scroll_is_function_node(node: &AstNode<'_>) -> bool {
    matches!(
        node.kind(),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
    )
}

fn rerender_scroll_setter_is_scheduled(
    setter_node: &AstNode<'_>,
    handler_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(setter_node.id()) {
        if ancestor.span() == handler_span {
            break;
        }
        let AstKind::CallExpression(call) = ancestor.kind() else {
            continue;
        };
        let Expression::Identifier(callee) = &call.callee else {
            continue;
        };
        if SCHEDULING_CALLEES.contains(&callee.name.as_str()) {
            return true;
        }
    }
    false
}
