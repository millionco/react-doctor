use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXChild, JSXElement, JSXElementName, JSXExpression, JSXFragment},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This heading uses emoji as decoration. Keep the heading typographic and move visual identity into a consistent icon or illustration system.";
const EXCLUDED_CONTENT_DIRECTORIES: [&str; 16] = [
    "__tests__",
    "doc",
    "docs",
    "documentation",
    "demo",
    "demos",
    "example",
    "examples",
    "sandbox",
    "sandboxes",
    "playground",
    "playgrounds",
    "story",
    "stories",
    "test",
    "tests",
];
static EMOJI_PATTERN: Lazy<Regex> = lazy_regex!(r"\p{Extended_Pictographic}");

#[derive(Debug, Default, Clone)]
pub struct NoEmojiHeadingDecoration;

declare_oxc_lint!(
    /// Disallow decorative emoji at the beginning of native headings.
    NoEmojiHeadingDecoration,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow decorative emoji at the beginning of native headings.",
);

impl Rule for NoEmojiHeadingDecoration {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_non_production_file(ctx)
            && !is_excluded_content_path(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &element.opening_element.name else {
            return;
        };
        if !matches!(identifier.name.as_str(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
            || !has_leading_static_emoji_in_element(element)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn is_excluded_content_path(ctx: &ContextHost<'_>) -> bool {
    let root_directory = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("rootDirectory"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    format!("{root_directory}/{}", ctx.file_path().to_string_lossy())
        .split(['/', '\\'])
        .any(|segment| {
            EXCLUDED_CONTENT_DIRECTORIES
                .iter()
                .any(|directory| segment.eq_ignore_ascii_case(directory))
        })
}

fn has_leading_static_emoji_in_element(element: &JSXElement<'_>) -> bool {
    is_intrinsic_element(element) && has_leading_static_emoji_in_children(&element.children)
}

fn is_intrinsic_element(element: &JSXElement<'_>) -> bool {
    matches!(
        &element.opening_element.name,
        JSXElementName::Identifier(identifier)
            if identifier.name.to_lowercase() == identifier.name.as_str()
    )
}

fn has_leading_static_emoji_in_fragment(fragment: &JSXFragment<'_>) -> bool {
    has_leading_static_emoji_in_children(&fragment.children)
}

fn has_leading_static_emoji_in_children(children: &[JSXChild<'_>]) -> bool {
    children
        .iter()
        .find(|child| {
            !matches!(
                child,
                JSXChild::Text(text)
                    if text.value.chars().all(|character| is_js_whitespace(character))
            )
        })
        .is_some_and(has_leading_static_emoji_in_child)
}

fn has_leading_static_emoji_in_child(child: &JSXChild<'_>) -> bool {
    match child {
        JSXChild::Text(text) => has_leading_emoji(text.value.as_str()),
        JSXChild::Element(element) => has_leading_static_emoji_in_element(element),
        JSXChild::Fragment(fragment) => has_leading_static_emoji_in_fragment(fragment),
        JSXChild::ExpressionContainer(container) => match &container.expression {
            JSXExpression::EmptyExpression(_) => false,
            expression => expression
                .as_expression()
                .is_some_and(has_leading_static_emoji_in_expression),
        },
        _ => false,
    }
}

fn has_leading_static_emoji_in_expression(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::StringLiteral(string_literal) => {
            has_leading_emoji(string_literal.value.as_str())
        }
        Expression::TemplateLiteral(template_literal)
            if template_literal.expressions.is_empty() && template_literal.quasis.len() == 1 =>
        {
            let template_value = &template_literal.quasis[0].value;
            has_leading_emoji(
                template_value
                    .cooked
                    .as_ref()
                    .map_or(template_value.raw.as_str(), |cooked| cooked.as_str()),
            )
        }
        Expression::ConditionalExpression(conditional_expression) => {
            has_leading_static_emoji_in_expression(&conditional_expression.consequent)
                || has_leading_static_emoji_in_expression(&conditional_expression.alternate)
        }
        Expression::JSXElement(element) => has_leading_static_emoji_in_element(element),
        Expression::JSXFragment(fragment) => has_leading_static_emoji_in_fragment(fragment),
        _ => false,
    }
}

fn has_leading_emoji(value: &str) -> bool {
    let trimmed_value = value.trim_start_matches(|character| is_js_whitespace(character));
    EMOJI_PATTERN
        .find(trimmed_value)
        .is_some_and(|matched| matched.start() == 0)
}
