use oxc_ast::{
    ast::{Argument, Expression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::operator::BinaryOperator;

use crate::{context::LintContext, rule::Rule, AstNode};

const FRAME_ARITHMETIC_OPERATORS: [BinaryOperator; 3] = [
    BinaryOperator::Addition,
    BinaryOperator::Subtraction,
    BinaryOperator::Remainder,
];
const MESSAGE: &str = "This frame-counter interval is an Ink animation; prefer `useAnimation()`.";
const REACT_EFFECT_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];

#[derive(Debug, Default, Clone)]
pub struct InkPreferUseAnimation;

declare_oxc_lint!(
    /// Prefer Ink useAnimation over frame-counter intervals.
    InkPreferUseAnimation,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer Ink useAnimation over frame-counter intervals.",
);

impl Rule for InkPreferUseAnimation {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(interval_call) = node.kind() else {
            return;
        };
        let Expression::Identifier(callee) = interval_call.callee.get_inner_expression() else {
            return;
        };
        if callee.name != "setInterval"
            || ctx
                .scoping()
                .get_reference(callee.reference_id())
                .symbol_id()
                .is_some()
        {
            return;
        }
        let Some(interval_callback) = interval_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        if !is_frame_increment(interval_callback, ctx) {
            return;
        }
        let Some(effect_call_node) = ctx.nodes().ancestors(node.id()).find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::CallExpression(call_expression)
                    if REACT_EFFECT_NAMES.iter().any(|effect_name| {
                        imported_module_api_matches(
                            &call_expression.callee,
                            effect_name,
                            "react",
                            ctx,
                        )
                    })
            )
        }) else {
            return;
        };
        if !is_render_phase_component_or_hook(effect_call_node, ctx) {
            return;
        }
        let Some(component_node) = ctx
            .nodes()
            .ancestors(effect_call_node.id())
            .find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ) && component_or_hook_function_name(ancestor, ctx).is_some()
            })
        else {
            return;
        };
        if component_renders_ink(component_node, ctx) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(interval_call.span));
        }
    }
}

fn is_frame_increment(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let Some((callback_node_id, callback_body_span)) = function_body_details(expression) else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        if !callback_body_span.contains_inclusive(candidate.span())
            || nearest_animation_function_node_id(candidate, ctx) != Some(callback_node_id)
        {
            return false;
        }
        let AstKind::CallExpression(set_frame_call) = candidate.kind() else {
            return false;
        };
        matches!(
            set_frame_call.callee.get_inner_expression(),
            Expression::Identifier(identifier) if identifier.name == "setFrame"
        ) && set_frame_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|updater| has_increment_expression(updater, ctx))
    })
}

fn has_increment_expression(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::ArrowFunctionExpression(function) = expression {
        if let Some(returned_expression) = function.get_expression() {
            return is_frame_arithmetic_expression(returned_expression);
        }
    }
    let Some((function_node_id, function_body_span)) = function_body_details(expression) else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        if !function_body_span.contains_inclusive(candidate.span())
            || nearest_animation_function_node_id(candidate, ctx) != Some(function_node_id)
        {
            return false;
        }
        matches!(
            candidate.kind(),
            AstKind::ReturnStatement(return_statement)
                if return_statement
                    .argument
                    .as_ref()
                    .is_some_and(is_frame_arithmetic_expression)
        )
    })
}

fn is_frame_arithmetic_expression(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::BinaryExpression(binary_expression)
            if FRAME_ARITHMETIC_OPERATORS.contains(&binary_expression.operator)
    )
}

fn function_body_details(
    expression: &Expression<'_>,
) -> Option<(oxc_semantic::NodeId, oxc_span::Span)> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            Some((function.node_id.get(), function.body.span()))
        }
        Expression::FunctionExpression(function) => {
            Some((function.node_id.get(), function.body.as_ref()?.span))
        }
        _ => None,
    }
}

fn nearest_animation_function_node_id(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}
