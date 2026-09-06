use oxc_ast::ast::Argument;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This drives animation work from every scroll event, which can make scrolling jank. Use a scroll timeline, IntersectionObserver, or a real timer throttle.";
const ANIMATED_STYLE_PROPERTY_NAMES: [&str; 14] = [
    "backdrop-filter",
    "backdropFilter",
    "bottom",
    "filter",
    "height",
    "left",
    "opacity",
    "right",
    "rotate",
    "scale",
    "top",
    "transform",
    "translate",
    "width",
];

#[derive(Debug, Default, Clone)]
pub struct NoUnthrottledScrollMutation;

declare_oxc_lint!(
    /// Disallow animation work on every scroll event.
    NoUnthrottledScrollMutation,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow unthrottled scroll animation work.",
);

impl Rule for NoUnthrottledScrollMutation {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(listener_call) = node.kind() else {
            return;
        };
        let Some(listener_member) = listener_call.callee.as_member_expression() else {
            return;
        };
        if listener_member.static_property_name() != Some("addEventListener")
            || !is_proven_dom_event_target(listener_member.object(), ctx, &mut Vec::new())
            || !listener_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|event_name| {
                    matches!(
                        event_name.get_inner_expression(),
                        Expression::StringLiteral(value) if value.value == "scroll"
                    )
                })
        {
            return;
        }
        let Some(handler_expression) = listener_call
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let Some(handler_node_id) = no_unthrottled_scroll_mutation_resolve_function_node_id(
            handler_expression,
            ctx,
            &mut Vec::new(),
        ) else {
            return;
        };
        let handler_span = ctx.nodes().get_node(handler_node_id).span();
        for candidate in ctx.nodes().iter() {
            if !handler_span.contains_inclusive(candidate.span())
                || !no_unthrottled_scroll_mutation_runs_every_scroll(
                    candidate,
                    handler_node_id,
                    ctx,
                )
            {
                continue;
            }
            if no_unthrottled_scroll_mutation_is_animation_mutation(candidate, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
                return;
            }
        }
    }
}

fn no_unthrottled_scroll_mutation_resolve_function_node_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(_) => Some(declaration.id()),
                AstKind::VariableDeclarator(declarator) => {
                    no_unthrottled_scroll_mutation_resolve_function_node_id(
                        declarator.init.as_ref()?,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn no_unthrottled_scroll_mutation_runs_every_scroll(
    candidate: &AstNode<'_>,
    handler_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(enclosing_function_node_id) =
        no_unthrottled_scroll_mutation_nearest_function_node_id(candidate.id(), ctx)
    else {
        return false;
    };
    enclosing_function_node_id == handler_node_id
        || no_unthrottled_scroll_mutation_is_direct_animation_frame_callback(
            enclosing_function_node_id,
            handler_node_id,
            ctx,
        )
}

fn no_unthrottled_scroll_mutation_is_direct_animation_frame_callback(
    callback_node_id: NodeId,
    handler_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let callback_node = ctx.nodes().get_node(callback_node_id);
    if !matches!(
        callback_node.kind(),
        AstKind::ArrowFunctionExpression(_) | AstKind::Function(_)
    ) {
        return false;
    }
    let callback_parent = ctx.nodes().parent_node(callback_node_id);
    let AstKind::CallExpression(animation_frame_call) = callback_parent.kind() else {
        return false;
    };
    if animation_frame_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .is_none_or(|argument| argument.span() != callback_node.span())
        || !no_unthrottled_scroll_mutation_is_global_animation_frame_callee(
            &animation_frame_call.callee,
            ctx,
        )
        || no_unthrottled_scroll_mutation_nearest_function_node_id(callback_parent.id(), ctx)
            != Some(handler_node_id)
    {
        return false;
    }
    for ancestor in ctx.nodes().ancestors(callback_parent.id()) {
        if ancestor.id() == handler_node_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::ConditionalExpression(_)
                | AstKind::IfStatement(_)
                | AstKind::LogicalExpression(_)
                | AstKind::SwitchStatement(_)
        ) {
            return false;
        }
    }
    false
}

fn no_unthrottled_scroll_mutation_is_global_animation_frame_callee(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            identifier.name == "requestAnimationFrame"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        expression => expression
            .as_member_expression()
            .is_some_and(|member_expression| {
                member_expression.static_property_name() == Some("requestAnimationFrame")
                    && matches!(
                        member_expression.object().get_inner_expression(),
                        Expression::Identifier(identifier)
                            if matches!(identifier.name.as_str(), "window" | "globalThis")
                                && ctx
                                    .scoping()
                                    .get_reference(identifier.reference_id())
                                    .symbol_id()
                                    .is_none()
                    )
            }),
    }
}

fn no_unthrottled_scroll_mutation_is_animation_mutation<'a>(
    candidate: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match candidate.kind() {
        AstKind::AssignmentExpression(assignment) => {
            let Some(target_member) = assignment.left.as_member_expression() else {
                return false;
            };
            let Some(property_name) = target_member.static_property_name() else {
                return false;
            };
            let receiver =
                no_unthrottled_scroll_mutation_outermost_member_receiver(target_member);
            ANIMATED_STYLE_PROPERTY_NAMES.contains(&property_name)
                && no_unthrottled_scroll_mutation_member_chain_contains_property(
                    target_member,
                    "style",
                )
                && is_proven_dom_event_target(receiver, ctx, &mut Vec::new())
        }
        AstKind::CallExpression(call_expression) => {
            let Some(callee_member) = call_expression.callee.as_member_expression() else {
                return false;
            };
            match callee_member.static_property_name() {
                Some("animate") => {
                    is_proven_dom_event_target(callee_member.object(), ctx, &mut Vec::new())
                }
                Some("setProperty") => {
                    let Some(style_member) = callee_member.object().as_member_expression() else {
                        return false;
                    };
                    if style_member.static_property_name() != Some("style")
                        || !call_expression
                            .arguments
                            .first()
                            .and_then(Argument::as_expression)
                            .is_some_and(|property| {
                                matches!(
                                    property.get_inner_expression(),
                                    Expression::StringLiteral(value)
                                        if ANIMATED_STYLE_PROPERTY_NAMES
                                            .contains(&value.value.as_str())
                                )
                            })
                    {
                        return false;
                    }
                    let receiver =
                        no_unthrottled_scroll_mutation_outermost_member_receiver(style_member);
                    is_proven_dom_event_target(receiver, ctx, &mut Vec::new())
                }
                _ => false,
            }
        }
        _ => false,
    }
}

fn no_unthrottled_scroll_mutation_member_chain_contains_property(
    member_expression: &oxc_ast::ast::MemberExpression<'_>,
    property_name: &str,
) -> bool {
    let mut current = Some(member_expression);
    while let Some(member) = current {
        if member.static_property_name() == Some(property_name) {
            return true;
        }
        current = member.object().as_member_expression();
    }
    false
}

fn no_unthrottled_scroll_mutation_outermost_member_receiver<'a>(
    member_expression: &'a oxc_ast::ast::MemberExpression<'a>,
) -> &'a Expression<'a> {
    let mut receiver = member_expression.object();
    while let Some(member) = receiver.as_member_expression() {
        receiver = member.object();
    }
    receiver
}

fn no_unthrottled_scroll_mutation_nearest_function_node_id(
    node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}
