use oxc_ast::{
    AstKind,
    ast::{AssignmentTarget, Expression, FunctionType},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This callback schedules itself forever with no stop path and discards the active request ID. Add a stop condition and retain the ID for cancelAnimationFrame().";

#[derive(Debug, Default, Clone)]
pub struct NoUnboundedAnimationFrameLoop;

struct AnimationFrameLoopState {
    function_name: String,
    function_body_span: oxc_span::Span,
    has_stop_gate: bool,
    recursive_request_span: Option<oxc_span::Span>,
}

declare_oxc_lint!(
    /// Disallow animation frame loops without a stop path or retained request ID.
    NoUnboundedAnimationFrameLoop,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow unbounded animation frame loops.",
);

impl Rule for NoUnboundedAnimationFrameLoop {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut states = FxHashMap::<NodeId, AnimationFrameLoopState>::default();
        for function_node in ctx.nodes().iter() {
            if !matches!(
                function_node.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) {
                continue;
            }
            let Some(function_name) =
                animation_frame_loop_function_binding_name(function_node, ctx)
            else {
                continue;
            };
            let Some(function_body_span) = animation_frame_loop_function_body_span(function_node)
            else {
                continue;
            };
            states.insert(
                function_node.id(),
                AnimationFrameLoopState {
                    function_name: function_name.to_string(),
                    function_body_span,
                    has_stop_gate: false,
                    recursive_request_span: None,
                },
            );
        }

        for candidate in ctx.nodes().iter() {
            let Some(function_id) = local_callback_nearest_function_id(candidate.id(), ctx) else {
                continue;
            };
            let Some(state) = states.get_mut(&function_id) else {
                continue;
            };
            if !state
                .function_body_span
                .contains_inclusive(candidate.span())
            {
                continue;
            }
            if matches!(
                candidate.kind(),
                AstKind::IfStatement(_)
                    | AstKind::ConditionalExpression(_)
                    | AstKind::LogicalExpression(_)
                    | AstKind::SwitchStatement(_)
                    | AstKind::TryStatement(_)
            ) {
                state.has_stop_gate = true;
                continue;
            }
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                continue;
            };
            if animation_frame_loop_is_global_request_callee(&call_expression.callee, ctx)
                && matches!(
                    call_expression
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression),
                    Some(Expression::Identifier(identifier))
                        if identifier.name.as_str() == state.function_name
                )
                && !animation_frame_loop_request_id_is_retained(candidate, ctx)
            {
                state.recursive_request_span = Some(call_expression.span);
            }
        }

        for function_node in ctx.nodes().iter() {
            let Some(state) = states.get(&function_node.id()) else {
                continue;
            };
            if !state.has_stop_gate
                && let Some(span) = state.recursive_request_span
            {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(span));
            }
        }
    }
}

fn animation_frame_loop_function_body_span(function_node: &AstNode<'_>) -> Option<oxc_span::Span> {
    match function_node.kind() {
        AstKind::Function(function) => function.body.as_ref().map(|body| body.span),
        AstKind::ArrowFunctionExpression(function) => Some(function.body.span()),
        _ => None,
    }
}

fn animation_frame_loop_function_binding_name<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a str> {
    if let AstKind::Function(function) = function_node.kind()
        && function.r#type == FunctionType::FunctionDeclaration
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.name.as_str());
    }

    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .id
            .get_binding_identifier()
            .map(|identifier| identifier.name.as_str()),
        AstKind::AssignmentExpression(assignment)
            if assignment.right.span() == function_root.span() =>
        {
            match &assignment.left {
                AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
                    Some(identifier.name.as_str())
                }
                _ => None,
            }
        }
        AstKind::CallExpression(_) => {
            let call_parent = ctx.nodes().parent_node(parent.id());
            let AstKind::VariableDeclarator(declarator) = call_parent.kind() else {
                return None;
            };
            declarator
                .id
                .get_binding_identifier()
                .map(|identifier| identifier.name.as_str())
        }
        _ => None,
    }
}

fn animation_frame_loop_is_global_request_callee(
    callee: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match callee {
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
                        member_expression.object(),
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

fn animation_frame_loop_request_id_is_retained(
    call_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(call_node.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .init
            .as_ref()
            .is_some_and(|initializer| initializer.span() == call_node.span()),
        AstKind::AssignmentExpression(assignment) => assignment.right.span() == call_node.span(),
        AstKind::ReturnStatement(statement) => statement
            .argument
            .as_ref()
            .is_some_and(|argument| argument.span() == call_node.span()),
        _ => false,
    }
}
