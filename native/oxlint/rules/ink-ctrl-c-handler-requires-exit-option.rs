use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator};

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str =
    "Ink consumes Ctrl-C before `useInput` unless `render()` disables `exitOnCtrlC`.";

#[derive(Debug, Default, Clone)]
pub struct InkCtrlCHandlerRequiresExitOption;

declare_oxc_lint!(
    /// Require Ink render to disable exitOnCtrlC before handling Ctrl-C.
    InkCtrlCHandlerRequiresExitOption,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require reachable Ink Ctrl-C handlers.",
);

impl Rule for InkCtrlCHandlerRequiresExitOption {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(use_input_call) = node.kind() else {
            return;
        };
        if !imported_module_api_matches(&use_input_call.callee, "useInput", "ink", ctx) {
            return;
        }
        let Some(handler) = use_input_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        if !ink_handler_handles_ctrl_c(handler, ctx)
            || !ctx.nodes().iter().any(|candidate| {
                let AstKind::CallExpression(render_call) = candidate.kind() else {
                    return false;
                };
                ink_render_call_is_related_to_node(render_call, node, "render", ctx)
                    && ink_render_boolean_option(render_call, "exitOnCtrlC", true) == Some(true)
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(use_input_call.span));
    }
}

fn ink_handler_handles_ctrl_c<'a>(handler: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let (handler_node_id, handler_span, parameters) = match handler.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            (function.node_id.get(), function.span, &function.params)
        }
        Expression::FunctionExpression(function) => {
            (function.node_id.get(), function.span, &function.params)
        }
        _ => return false,
    };
    let Some(BindingPattern::BindingIdentifier(input_parameter)) =
        parameters.items.first().map(|parameter| &parameter.pattern)
    else {
        return false;
    };
    let Some(BindingPattern::BindingIdentifier(key_parameter)) =
        parameters.items.get(1).map(|parameter| &parameter.pattern)
    else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        if !handler_span.contains_inclusive(candidate.span())
            || ctx
                .nodes()
                .ancestors(candidate.id())
                .find(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    )
                })
                .is_none_or(|function| function.id() != handler_node_id)
        {
            return false;
        }
        let AstKind::LogicalExpression(logical_expression) = candidate.kind() else {
            return false;
        };
        logical_expression.operator == LogicalOperator::And
            && (ink_condition_has_ctrl_operand(
                &logical_expression.left,
                key_parameter.symbol_id(),
                ctx,
            ) || ink_condition_has_ctrl_operand(
                &logical_expression.right,
                key_parameter.symbol_id(),
                ctx,
            ))
            && (ink_condition_has_c_operand(
                &logical_expression.left,
                input_parameter.symbol_id(),
                ctx,
            ) || ink_condition_has_c_operand(
                &logical_expression.right,
                input_parameter.symbol_id(),
                ctx,
            ))
    })
}

fn ink_condition_has_ctrl_operand(
    expression: &Expression<'_>,
    key_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::LogicalExpression(logical_expression) = expression
        && logical_expression.operator == LogicalOperator::And
    {
        return ink_condition_has_ctrl_operand(&logical_expression.left, key_symbol_id, ctx)
            || ink_condition_has_ctrl_operand(&logical_expression.right, key_symbol_id, ctx);
    }
    let Some(member_expression) = expression.as_member_expression() else {
        return false;
    };
    let Expression::Identifier(identifier) = member_expression.object().get_inner_expression()
    else {
        return false;
    };
    member_expression.static_property_name() == Some("ctrl")
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            == Some(key_symbol_id)
}

fn ink_condition_has_c_operand(
    expression: &Expression<'_>,
    input_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::LogicalExpression(logical_expression) = expression
        && logical_expression.operator == LogicalOperator::And
    {
        return ink_condition_has_c_operand(&logical_expression.left, input_symbol_id, ctx)
            || ink_condition_has_c_operand(&logical_expression.right, input_symbol_id, ctx);
    }
    let Expression::BinaryExpression(binary_expression) = expression else {
        return false;
    };
    if !matches!(
        binary_expression.operator,
        BinaryOperator::Equality | BinaryOperator::StrictEquality
    ) {
        return false;
    }
    ink_identifier_and_c_literal_match(
        &binary_expression.left,
        &binary_expression.right,
        input_symbol_id,
        ctx,
    ) || ink_identifier_and_c_literal_match(
        &binary_expression.right,
        &binary_expression.left,
        input_symbol_id,
        ctx,
    )
}

fn ink_identifier_and_c_literal_match(
    identifier_expression: &Expression<'_>,
    literal_expression: &Expression<'_>,
    input_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = identifier_expression.get_inner_expression() else {
        return false;
    };
    matches!(
        literal_expression.get_inner_expression(),
        Expression::StringLiteral(literal) if literal.value == "c"
    ) && ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        == Some(input_symbol_id)
}

fn ink_render_boolean_option(
    render_call: &oxc_ast::ast::CallExpression<'_>,
    option_name: &str,
    default_value: bool,
) -> Option<bool> {
    let Some(options) = render_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
    else {
        return Some(default_value);
    };
    let Expression::ObjectExpression(options) = options.get_inner_expression() else {
        return None;
    };
    let mut resolved_value = Some(default_value);
    for property in &options.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            resolved_value = None;
            continue;
        };
        let Some(property_name) = property.key.static_name() else {
            if property.computed {
                resolved_value = None;
            }
            continue;
        };
        if property_name != option_name {
            continue;
        }
        resolved_value = match property.value.get_inner_expression() {
            Expression::BooleanLiteral(value) => Some(value.value),
            _ => None,
        };
    }
    resolved_value
}
