use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::BinaryOperator;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "A bare path string prefix also accepts sibling paths such as `<root>-backup`. Use a boundary-aware path containment check.";
const PATH_MODULE_SOURCES: [&str; 2] = ["node:path", "path"];
const PATH_SEPARATORS: [&str; 2] = ["/", "\\"];

#[derive(Debug, Default, Clone)]
pub struct NoPathPrefixContainment;

declare_oxc_lint!(
    /// Disallow path containment checks that compare a resolved path with a bare string prefix.
    NoPathPrefixContainment,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow path containment checks that use a bare string prefix.",
);

impl Rule for NoPathPrefixContainment {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call) = node.kind() else {
            return;
        };
        let Some(member) = call.callee.get_inner_expression().get_member_expr() else {
            return;
        };
        if member.static_property_name().as_deref() != Some("startsWith")
            || call.arguments.len() != 1
        {
            return;
        }
        let Some(prefix_expression) = call.arguments.first().and_then(Argument::as_expression)
        else {
            return;
        };
        if path_prefix_has_separator_suffix(prefix_expression, ctx) {
            return;
        }
        let Some(resolved_path_call) = path_prefix_resolved_path_call(member.object(), ctx) else {
            return;
        };
        if resolved_path_call.arguments.len() < 2 {
            return;
        }
        let Some(root_expression) = resolved_path_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        if !path_prefix_same_stable_expressions(root_expression, prefix_expression, ctx)
            && !path_prefix_is_separator_suffixed_version_of(
                root_expression,
                prefix_expression,
                ctx,
            )
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
    }
}

fn path_prefix_resolved_path_call<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::CallExpression<'a>> {
    let resolved_expression =
        path_prefix_resolve_stable_expression(expression, ctx, &mut Vec::new());
    let Expression::CallExpression(call) = resolved_expression.get_inner_expression() else {
        return None;
    };
    module_api_path_matches(&call.callee, &["resolve"], &PATH_MODULE_SOURCES, true, ctx)
        .then_some(call)
}

fn path_prefix_resolve_stable_expression<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> &'a Expression<'a> {
    let resolved_expression = expression.get_inner_expression();
    let Expression::Identifier(identifier) = resolved_expression else {
        return resolved_expression;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return resolved_expression;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return resolved_expression;
    }
    let Some(initializer) = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx) else {
        return resolved_expression;
    };
    visited_symbol_ids.push(symbol_id);
    path_prefix_resolve_stable_expression(initializer, ctx, visited_symbol_ids)
}

fn path_prefix_same_stable_expressions<'a>(
    first_expression: &'a Expression<'a>,
    second_expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let first_expression =
        path_prefix_resolve_stable_expression(first_expression, ctx, &mut Vec::new());
    let second_expression =
        path_prefix_resolve_stable_expression(second_expression, ctx, &mut Vec::new());
    path_prefix_expressions_structurally_equal(first_expression, second_expression, ctx)
}

fn path_prefix_expressions_structurally_equal(
    first_expression: &Expression<'_>,
    second_expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let first_expression = first_expression.get_inner_expression();
    let second_expression = second_expression.get_inner_expression();
    match (first_expression, second_expression) {
        (Expression::ThisExpression(_), Expression::ThisExpression(_))
        | (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::Identifier(first), Expression::Identifier(second)) => {
            path_prefix_identifiers_equal(first, second, ctx)
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
            first.raw == second.raw
        }
        (Expression::CallExpression(first), Expression::CallExpression(second)) => {
            path_prefix_expressions_structurally_equal(&first.callee, &second.callee, ctx)
                && first.arguments.len() == second.arguments.len()
                && first.arguments.iter().zip(&second.arguments).all(
                    |(first_argument, second_argument)| {
                        let (Some(first_argument), Some(second_argument)) = (
                            first_argument.as_expression(),
                            second_argument.as_expression(),
                        ) else {
                            return false;
                        };
                        path_prefix_expressions_structurally_equal(
                            first_argument,
                            second_argument,
                            ctx,
                        )
                    },
                )
        }
        _ => match (
            first_expression.as_member_expression(),
            second_expression.as_member_expression(),
        ) {
            (Some(first_member), Some(second_member)) => {
                path_prefix_member_expressions_equal(first_member, second_member, ctx)
            }
            _ => false,
        },
    }
}

fn path_prefix_member_expressions_equal(
    first_member: &MemberExpression<'_>,
    second_member: &MemberExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match (first_member, second_member) {
        (
            MemberExpression::StaticMemberExpression(first),
            MemberExpression::StaticMemberExpression(second),
        ) => {
            first.property.name == second.property.name
                && path_prefix_expressions_structurally_equal(&first.object, &second.object, ctx)
        }
        (
            MemberExpression::ComputedMemberExpression(first),
            MemberExpression::ComputedMemberExpression(second),
        ) => {
            path_prefix_expressions_structurally_equal(&first.object, &second.object, ctx)
                && path_prefix_expressions_structurally_equal(
                    &first.expression,
                    &second.expression,
                    ctx,
                )
        }
        _ => false,
    }
}

fn path_prefix_identifiers_equal(
    first_identifier: &oxc_ast::ast::IdentifierReference<'_>,
    second_identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let first_symbol_id = ctx
        .scoping()
        .get_reference(first_identifier.reference_id())
        .symbol_id();
    let second_symbol_id = ctx
        .scoping()
        .get_reference(second_identifier.reference_id())
        .symbol_id();
    match (first_symbol_id, second_symbol_id) {
        (Some(first_symbol_id), Some(second_symbol_id)) if first_symbol_id == second_symbol_id => {
            let earlier_span = if first_identifier.span.start <= second_identifier.span.start {
                first_identifier.span
            } else {
                second_identifier.span
            };
            let later_span = if earlier_span == first_identifier.span {
                second_identifier.span
            } else {
                first_identifier.span
            };
            !path_prefix_symbol_has_write_between(first_symbol_id, earlier_span, later_span, ctx)
        }
        (None, None) => first_identifier.name == second_identifier.name,
        _ => false,
    }
}

fn path_prefix_symbol_has_write_between(
    symbol_id: SymbolId,
    earlier_span: Span,
    later_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_span = ctx.nodes().get_node(reference.node_id()).span();
            reference.is_write()
                && reference_span.start > earlier_span.end
                && reference_span.start < later_span.start
        })
}

fn path_prefix_is_separator_expression<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let resolved_expression =
        path_prefix_resolve_stable_expression(expression, ctx, &mut Vec::new());
    if get_static_string_expression(resolved_expression)
        .is_some_and(|value| PATH_SEPARATORS.contains(&value))
    {
        return true;
    }
    module_api_path_matches(
        resolved_expression,
        &["sep"],
        &PATH_MODULE_SOURCES,
        true,
        ctx,
    )
}

fn path_prefix_has_separator_suffix<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let resolved_expression =
        path_prefix_resolve_stable_expression(expression, ctx, &mut Vec::new());
    if get_static_string_expression(resolved_expression)
        .is_some_and(path_prefix_string_has_separator_suffix)
    {
        return true;
    }
    if let Expression::BinaryExpression(binary) = resolved_expression.get_inner_expression()
        && binary.operator == BinaryOperator::Addition
        && path_prefix_is_separator_expression(&binary.right, ctx)
    {
        return true;
    }
    let Expression::TemplateLiteral(template) = resolved_expression.get_inner_expression() else {
        return false;
    };
    let Some(trailing_quasi) = template.quasis.last() else {
        return false;
    };
    let trailing_text = trailing_quasi
        .value
        .cooked
        .as_ref()
        .map_or(trailing_quasi.value.raw.as_str(), |cooked| cooked.as_str());
    path_prefix_string_has_separator_suffix(trailing_text)
        || trailing_text.is_empty()
            && template
                .expressions
                .last()
                .is_some_and(|expression| path_prefix_is_separator_expression(expression, ctx))
}

fn path_prefix_is_separator_suffixed_version_of<'a>(
    suffixed_expression: &'a Expression<'a>,
    bare_expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let suffixed_expression =
        path_prefix_resolve_stable_expression(suffixed_expression, ctx, &mut Vec::new());
    let bare_expression =
        path_prefix_resolve_stable_expression(bare_expression, ctx, &mut Vec::new());
    if let (Some(suffixed_value), Some(bare_value)) = (
        get_static_string_expression(suffixed_expression),
        get_static_string_expression(bare_expression),
    ) {
        return PATH_SEPARATORS
            .iter()
            .any(|separator| suffixed_value == format!("{bare_value}{separator}"));
    }
    if let Expression::BinaryExpression(binary) = suffixed_expression.get_inner_expression()
        && binary.operator == BinaryOperator::Addition
        && path_prefix_is_separator_expression(&binary.right, ctx)
    {
        return path_prefix_same_stable_expressions(&binary.left, bare_expression, ctx);
    }
    let Expression::TemplateLiteral(template) = suffixed_expression.get_inner_expression() else {
        return false;
    };
    if template.expressions.len() == 1 && template.quasis.len() == 2 {
        let leading_text = path_prefix_template_quasi_text(&template.quasis[0]);
        let trailing_text = path_prefix_template_quasi_text(&template.quasis[1]);
        return leading_text.is_empty()
            && PATH_SEPARATORS.contains(&trailing_text)
            && path_prefix_same_stable_expressions(&template.expressions[0], bare_expression, ctx);
    }
    template.expressions.len() == 2
        && template.quasis.len() == 3
        && template
            .quasis
            .iter()
            .all(|quasi| path_prefix_template_quasi_text(quasi).is_empty())
        && path_prefix_is_separator_expression(&template.expressions[1], ctx)
        && path_prefix_same_stable_expressions(&template.expressions[0], bare_expression, ctx)
}

fn path_prefix_template_quasi_text<'a>(quasi: &'a oxc_ast::ast::TemplateElement<'a>) -> &'a str {
    quasi
        .value
        .cooked
        .as_ref()
        .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
}

fn path_prefix_string_has_separator_suffix(value: &str) -> bool {
    PATH_SEPARATORS
        .iter()
        .any(|separator| value.ends_with(separator))
}
