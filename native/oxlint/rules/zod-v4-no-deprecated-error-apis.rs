use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const DEPRECATED_ZOD_ERROR_MEMBERS: [&str; 6] = [
    "addIssue",
    "addIssues",
    "errors",
    "flatten",
    "formErrors",
    "format",
];
const MESSAGE: &str =
    "This ZodError API was removed in Zod 4, so error handling can break during the upgrade.";

#[derive(Debug, Default, Clone)]
#[allow(non_camel_case_types)]
pub struct Zod_v4NoDeprecatedErrorApis;

pub type ZodV4NoDeprecatedErrorApis = Zod_v4NoDeprecatedErrorApis;

declare_oxc_lint!(
    /// Warns about Zod 3 error APIs removed in Zod 4.
    Zod_v4NoDeprecatedErrorApis,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns about Zod 3 error APIs removed in Zod 4.",
);

impl Rule for Zod_v4NoDeprecatedErrorApis {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let diagnostic_span = match node.kind() {
            AstKind::CallExpression(call_expression) => {
                if is_zod_error_create_call(call_expression, ctx) {
                    if is_receiver_of_deprecated_zod_error_member(node, ctx) {
                        return;
                    }
                } else if !is_deprecated_zod_error_member_expression(
                    &call_expression.callee,
                    ctx,
                ) {
                    return;
                }
                call_expression.span
            }
            AstKind::StaticMemberExpression(member_expression) => {
                if is_call_callee(node, ctx)
                    || !DEPRECATED_ZOD_ERROR_MEMBERS
                        .contains(&member_expression.property.name.as_str())
                    || !is_direct_zod_error_value(&member_expression.object, ctx)
                {
                    return;
                }
                member_expression.span
            }
            AstKind::ComputedMemberExpression(member_expression) => {
                if is_call_callee(node, ctx)
                    || !member_expression.static_property_name().is_some_and(|member_name| {
                        DEPRECATED_ZOD_ERROR_MEMBERS.contains(&member_name.as_str())
                    })
                    || !is_direct_zod_error_value(&member_expression.object, ctx)
                {
                    return;
                }
                member_expression.span
            }
            _ => return,
        };
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(diagnostic_span));
    }
}

fn is_zod_error_reference<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => direct_named_import_matches(
            identifier,
            &["ZodError"],
            &DIRECT_ZOD_MODULE_SOURCES,
            ctx,
        ),
        expression => expression
            .as_member_expression()
            .is_some_and(|member_expression| {
                member_expression.static_property_name() == Some("ZodError")
                    && matches!(
                        member_expression.object().get_inner_expression(),
                        Expression::Identifier(identifier)
                            if is_direct_zod_namespace_identifier(identifier, ctx)
                    )
            }),
    }
}

fn is_direct_zod_error_value<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    match expression.get_inner_expression() {
        Expression::NewExpression(new_expression) => {
            is_zod_error_reference(&new_expression.callee, ctx)
        }
        Expression::CallExpression(call_expression) => {
            is_zod_error_create_call(call_expression, ctx)
        }
        _ => false,
    }
}

fn is_zod_error_create_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
        .is_some_and(|member_expression| {
            member_expression.static_property_name() == Some("create")
                && is_zod_error_reference(member_expression.object(), ctx)
        })
}

fn is_deprecated_zod_error_member_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    expression
        .get_inner_expression()
        .as_member_expression()
        .is_some_and(|member_expression| {
            member_expression.static_property_name().is_some_and(|member_name| {
                DEPRECATED_ZOD_ERROR_MEMBERS.contains(&member_name)
            }) && is_direct_zod_error_value(member_expression.object(), ctx)
        })
}

fn is_receiver_of_deprecated_zod_error_member<'a>(
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let call_root = transparent_expression_root(call_node, ctx);
    let parent = ctx.nodes().parent_node(call_root.id());
    match parent.kind() {
        AstKind::StaticMemberExpression(member_expression) => {
            member_expression.object.get_inner_expression().span() == call_node.span()
                && DEPRECATED_ZOD_ERROR_MEMBERS
                    .contains(&member_expression.property.name.as_str())
        }
        AstKind::ComputedMemberExpression(member_expression) => {
            member_expression.object.get_inner_expression().span() == call_node.span()
                && member_expression.static_property_name().is_some_and(|member_name| {
                    DEPRECATED_ZOD_ERROR_MEMBERS.contains(&member_name.as_str())
                })
        }
        _ => false,
    }
}

fn is_call_callee<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let expression_root = transparent_expression_root(node, ctx);
    matches!(
        ctx.nodes().parent_node(expression_root.id()).kind(),
        AstKind::CallExpression(call_expression)
            if call_expression.callee.get_inner_expression().span() == node.span()
    )
}
