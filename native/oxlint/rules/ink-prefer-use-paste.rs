use oxc_ast::{
    ast::{Argument, BindingPattern, Expression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::BinaryOperator;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str =
    "Use `usePaste()` instead of inferring paste events from `useInput()` chunks.";
const PASTE_METHOD_NAMES: [&str; 2] = ["includes", "split"];

#[derive(Debug, Default, Clone)]
pub struct InkPreferUsePaste;

declare_oxc_lint!(
    /// Prefer Ink usePaste over interpreting pasted useInput chunks.
    InkPreferUsePaste,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer Ink usePaste for pasted input.",
);

impl Rule for InkPreferUsePaste {
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
        let Some((handler_node_id, handler_body_span, input_symbol_id)) =
            input_handler_details(handler)
        else {
            return;
        };
        if ctx.nodes().iter().any(|candidate| {
            handler_body_span.contains_inclusive(candidate.span())
                && nearest_function_node_id(candidate, ctx) == Some(handler_node_id)
                && interprets_pasted_input(candidate, input_symbol_id, ctx)
        }) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(use_input_call.span));
        }
    }
}

fn input_handler_details(
    expression: &Expression<'_>,
) -> Option<(oxc_semantic::NodeId, oxc_span::Span, oxc_semantic::SymbolId)> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            let parameter = function.params.items.first()?;
            let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
                return None;
            };
            Some((
                function.node_id.get(),
                function.body.span(),
                identifier.symbol_id(),
            ))
        }
        Expression::FunctionExpression(function) => {
            let parameter = function.params.items.first()?;
            let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
                return None;
            };
            Some((
                function.node_id.get(),
                function.body.as_ref()?.span,
                identifier.symbol_id(),
            ))
        }
        _ => None,
    }
}

fn interprets_pasted_input(
    node: &AstNode<'_>,
    input_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    match node.kind() {
        AstKind::CallExpression(call_expression) => {
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                return false;
            };
            if !member_expression
                .static_property_name()
                .is_some_and(|method_name| PASTE_METHOD_NAMES.contains(&method_name))
                || !expression_is_symbol(member_expression.object(), input_symbol_id, ctx)
            {
                return false;
            }
            call_expression.arguments.iter().any(|argument| {
                matches!(
                    argument,
                    Argument::StringLiteral(string_literal) if string_literal.value == "\n"
                )
            })
        }
        AstKind::BinaryExpression(binary_expression) => {
            let Some(member_expression) = binary_expression.left.as_member_expression() else {
                return false;
            };
            if member_expression.static_property_name() != Some("length")
                || !expression_is_symbol(member_expression.object(), input_symbol_id, ctx)
            {
                return false;
            }
            let Expression::NumericLiteral(length) = binary_expression.right.get_inner_expression()
            else {
                return false;
            };
            match binary_expression.operator {
                BinaryOperator::GreaterThan => length.value >= 1.0,
                BinaryOperator::GreaterEqualThan => length.value >= 2.0,
                _ => false,
            }
        }
        _ => false,
    }
}

fn expression_is_symbol(
    expression: &Expression<'_>,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::Identifier(identifier)
            if ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                == Some(symbol_id)
    )
}

fn nearest_function_node_id(
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
