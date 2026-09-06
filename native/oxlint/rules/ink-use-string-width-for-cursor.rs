use oxc_ast::{
    ast::{Argument, Expression, ObjectPropertyKind},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::BinaryOperator;
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "JavaScript string length is not a terminal column width for Unicode text.";

#[derive(Debug, Default, Clone)]
pub struct InkUseStringWidthForCursor;

declare_oxc_lint!(
    /// Require terminal column measurement for Ink cursor positions.
    InkUseStringWidthForCursor,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require terminal column measurement for Ink cursor positions.",
);

impl Rule for InkUseStringWidthForCursor {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(cursor_position_call) = node.kind() else {
            return;
        };
        let Some(cursor_member) = cursor_position_call.callee.as_member_expression() else {
            return;
        };
        if cursor_member.static_property_name() != Some("setCursorPosition")
            || !is_cursor_expression(cursor_member.object(), ctx)
        {
            return;
        }
        let Some(horizontal_position) = horizontal_cursor_position(cursor_position_call) else {
            return;
        };
        let Some(length_member) = horizontal_position.as_member_expression() else {
            return;
        };
        if length_member.static_property_name() != Some("length")
            || is_provably_ascii_string(length_member.object(), ctx, &mut FxHashSet::default())
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(horizontal_position.span()));
    }
}

fn is_cursor_expression<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call_expression) = expression {
        return imported_module_api_matches(&call_expression.callee, "useCursor", "ink", ctx);
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    resolve_direct_unreassigned_initializer(identifier, ctx).is_some_and(|initializer| {
        matches!(
            initializer.get_inner_expression(),
            Expression::CallExpression(call_expression)
                if imported_module_api_matches(&call_expression.callee, "useCursor", "ink", ctx)
        )
    })
}

fn horizontal_cursor_position<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<&'a Expression<'a>> {
    let position = call_expression
        .arguments
        .first()
        .and_then(Argument::as_expression)?;
    let Expression::ObjectExpression(position_object) = position.get_inner_expression() else {
        return Some(position);
    };
    position_object.properties.iter().find_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        property
            .key
            .static_name()
            .is_some_and(|property_name| property_name == "x")
            .then_some(&property.value)
    })
}

fn is_provably_ascii_string<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::StringLiteral(string_literal) => string_literal
            .value
            .chars()
            .all(|character| (' '..='~').contains(&character)),
        Expression::TemplateLiteral(template_literal) => {
            template_literal.expressions.is_empty()
                && template_literal.quasis.iter().all(|quasi| {
                    quasi
                        .value
                        .raw
                        .chars()
                        .all(|character| (' '..='~').contains(&character))
                })
        }
        Expression::BinaryExpression(binary_expression)
            if binary_expression.operator == BinaryOperator::Addition =>
        {
            is_provably_ascii_string(&binary_expression.left, ctx, visited_symbol_ids)
                && is_provably_ascii_string(&binary_expression.right, ctx, visited_symbol_ids)
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            resolve_direct_unreassigned_initializer(identifier, ctx).is_some_and(|initializer| {
                is_provably_ascii_string(initializer, ctx, visited_symbol_ids)
            })
        }
        _ => false,
    }
}
