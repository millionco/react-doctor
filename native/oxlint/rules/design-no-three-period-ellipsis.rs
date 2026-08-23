use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Use the real ellipsis character (\"…\") instead of three period characters.";
static TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN: Lazy<Regex> =
    lazy_regex!(r"[\p{L}\p{N}]\.\.\.");

#[derive(Debug, Default, Clone)]
pub struct DesignNoThreePeriodEllipsis;

declare_oxc_lint!(
    /// Disallow three periods in user-facing UI text.
    DesignNoThreePeriodEllipsis,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow three periods in user-facing UI text.",
);

impl Rule for DesignNoThreePeriodEllipsis {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => {
                let oxc_ast::ast::JSXAttributeName::Identifier(attribute_name) = &attribute.name
                else {
                    return;
                };
                if !is_user_facing_text_attribute(attribute_name.name.as_str()) {
                    return;
                }
                let Some(text_value) = get_string_literal_attribute_value(attribute) else {
                    return;
                };
                if !TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN.is_match(text_value) {
                    return;
                }
                let span = attribute
                    .value
                    .as_ref()
                    .map_or(attribute.span, GetSpan::span);
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(span));
            }
            AstKind::JSXExpressionContainer(container) => {
                if matches!(
                    ctx.nodes().parent_node(node.id()).kind(),
                    AstKind::JSXAttribute(_)
                ) || is_inside_excluded_typography_ancestor(node, ctx)
                {
                    return;
                }
                let Some(expression) = container.expression.as_expression() else {
                    return;
                };
                report_static_expression_ellipses(expression, ctx);
            }
            AstKind::JSXText(text) => {
                if TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN.is_match(text.value.as_str())
                    && !is_inside_excluded_typography_ancestor(node, ctx)
                {
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(text.span));
                }
            }
            _ => {}
        }
    }
}

fn is_user_facing_text_attribute(attribute_name: &str) -> bool {
    matches!(
        attribute_name.to_ascii_lowercase().as_str(),
        "alt" | "aria-label" | "placeholder" | "title"
    )
}

fn report_static_expression_ellipses(
    expression: &oxc_ast::ast::Expression,
    ctx: &LintContext<'_>,
) {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::StringLiteral(string_literal) => {
            if TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN.is_match(string_literal.value.as_str()) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(string_literal.span));
            }
        }
        oxc_ast::ast::Expression::TemplateLiteral(template_literal)
            if template_literal.expressions.is_empty() && template_literal.quasis.len() == 1 =>
        {
            let quasi = &template_literal.quasis[0];
            let text_value = quasi
                .value
                .cooked
                .as_ref()
                .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str());
            if TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN.is_match(text_value) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(template_literal.span));
            }
        }
        oxc_ast::ast::Expression::ConditionalExpression(conditional_expression) => {
            report_static_expression_ellipses(&conditional_expression.consequent, ctx);
            report_static_expression_ellipses(&conditional_expression.alternate, ctx);
        }
        oxc_ast::ast::Expression::LogicalExpression(logical_expression) => {
            report_static_expression_ellipses(&logical_expression.right, ctx);
        }
        _ => {}
    }
}
