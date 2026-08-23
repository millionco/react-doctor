use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EM_DASH_PROSE_MIN_WORD_COUNT: usize = 5;
const MESSAGE: &str = "Em dash (—) in UI text reads like AI output to your users.";
const LONG_FORM_CONTENT_PATH_SEGMENTS: [&str; 9] = [
    "article",
    "articles",
    "blog",
    "changelog",
    "content",
    "doc",
    "docs",
    "post",
    "posts",
];
static EM_DASH_ENTITY_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)&(?:mdash|#0*8212|#x0*2014);");
static PROSE_EM_DASH_PATTERN: Lazy<Regex> = lazy_regex!(r"\p{L}[^—\n]*—[^—\n]*\p{L}");
static LETTER_WORD_PATTERN: Lazy<Regex> = lazy_regex!(r"\p{L}+");

#[derive(Debug, Default, Clone)]
pub struct DesignNoEmDashInJsxText;

declare_oxc_lint!(
    /// Disallow em dashes embedded in UI prose.
    DesignNoEmDashInJsxText,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow em dashes embedded in UI prose.",
);

impl Rule for DesignNoEmDashInJsxText {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && !is_long_form_content_path(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXExpressionContainer(container) => {
                if matches!(
                    ctx.nodes().parent_node(node.id()).kind(),
                    AstKind::JSXAttribute(_)
                ) || is_inside_excluded_typography_ancestor(node, ctx)
                    || is_inside_statically_hidden_jsx_subtree(node, ctx)
                {
                    return;
                }
                let Some(expression) = container.expression.as_expression() else {
                    return;
                };
                if has_prose_em_dash_in_static_expression(expression) {
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(container.span));
                }
            }
            AstKind::JSXText(text) => {
                let rendered_text = EM_DASH_ENTITY_PATTERN.replace_all(text.value.as_str(), "—");
                if has_prose_em_dash(&rendered_text)
                    && !is_inside_excluded_typography_ancestor(node, ctx)
                    && !is_inside_statically_hidden_jsx_subtree(node, ctx)
                {
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(text.span));
                }
            }
            _ => {}
        }
    }
}

fn is_long_form_content_path(ctx: &ContextHost) -> bool {
    ctx.file_path()
        .to_string_lossy()
        .split(['/', '\\'])
        .any(|segment| {
            LONG_FORM_CONTENT_PATH_SEGMENTS
                .iter()
                .any(|candidate| segment.eq_ignore_ascii_case(candidate))
        })
}

fn has_prose_em_dash(text: &str) -> bool {
    text.contains('—')
        && text.split(['\r', '\n']).any(|line| {
            PROSE_EM_DASH_PATTERN.is_match(line)
                && LETTER_WORD_PATTERN.find_iter(line).count() >= EM_DASH_PROSE_MIN_WORD_COUNT
        })
}

fn has_prose_em_dash_in_static_expression(expression: &oxc_ast::ast::Expression) -> bool {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::StringLiteral(string_literal) => {
            has_prose_em_dash(string_literal.value.as_str())
        }
        oxc_ast::ast::Expression::TemplateLiteral(template_literal) => {
            template_literal.quasis.iter().any(|quasi| {
                has_prose_em_dash(
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str()),
                )
            })
        }
        oxc_ast::ast::Expression::ConditionalExpression(conditional_expression) => {
            has_prose_em_dash_in_static_expression(&conditional_expression.consequent)
                || has_prose_em_dash_in_static_expression(&conditional_expression.alternate)
        }
        oxc_ast::ast::Expression::LogicalExpression(logical_expression) => {
            has_prose_em_dash_in_static_expression(&logical_expression.right)
        }
        _ => false,
    }
}
