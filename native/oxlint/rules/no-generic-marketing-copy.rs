use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXChild, JSXElement, JSXExpression, JSXFragment},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const STATIC_COPY_BOUNDARY: &str = "\0";
const GENERIC_MARKETING_PHRASES: [&str; 27] = [
    "best of breed",
    "best-in-class",
    "built for the modern",
    "cutting-edge",
    "drive engagement",
    "drive growth",
    "drive results",
    "empower your",
    "enterprise-grade",
    "future-proof",
    "game changing",
    "game-changer",
    "harness the power",
    "industry-leading",
    "leverage the power",
    "next-generation",
    "seamless experience",
    "seamlessly integrate",
    "streamline your",
    "supercharge your",
    "transform your business",
    "trusted by leading",
    "trusted by the world",
    "unleash the power",
    "unleash your",
    "unlock your potential",
    "world-class",
];
const MARKETING_COPY_EXCLUDED_ELEMENT_NAMES: [&str; 27] = [
    "code",
    "codeblock",
    "codesnippet",
    "demo",
    "example",
    "fixture",
    "kbd",
    "markdown",
    "markdownblock",
    "markdowncontent",
    "markdownrenderer",
    "markdowntext",
    "markdownview",
    "mdx",
    "mdxcontent",
    "mdxremote",
    "playground",
    "pre",
    "preview",
    "reactmarkdown",
    "renderproxy",
    "samp",
    "script",
    "story",
    "style",
    "syntaxhighlighter",
    "template",
];
static LEXICAL_CHARACTER_PATTERN: Lazy<Regex> = lazy_regex!(r"^[\p{L}\p{N}]$");

#[derive(Debug, Default, Clone)]
pub struct NoGenericMarketingCopy;

declare_oxc_lint!(
    /// Disallow generic marketing language in page copy.
    NoGenericMarketingCopy,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow generic marketing language in page copy.",
);

impl Rule for NoGenericMarketingCopy {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !is_top_level_page_copy_root(element, node, ctx)
            || is_inside_excluded_marketing_copy_element(node, ctx)
            || is_inside_statically_hidden_jsx_subtree(node, ctx)
        {
            return;
        }
        let page_text =
            normalize_marketing_copy_whitespace(&get_static_rendered_marketing_copy(element, ctx))
                .to_lowercase();
        let Some(matched_phrase) = find_first_marketing_phrase(&page_text) else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "The phrase “{matched_phrase}” makes a broad promise without saying what the product actually does. Use specific copy."
            ))
            .with_label(element.opening_element.span),
        );
    }
}

fn is_excluded_marketing_copy_element<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let element_type = resolve_jsx_element_type_name(opening_element, ctx);
    let element_name = element_type.rsplit('.').next().unwrap_or_default();
    MARKETING_COPY_EXCLUDED_ELEMENT_NAMES
        .iter()
        .any(|excluded| element_name.eq_ignore_ascii_case(excluded))
}

fn is_inside_excluded_marketing_copy_element(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::JSXElement(element)
                if is_excluded_marketing_copy_element(&element.opening_element, ctx)
        )
    })
}

fn get_static_rendered_marketing_copy<'a>(
    element: &'a JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> String {
    if is_excluded_marketing_copy_element(&element.opening_element, ctx)
        || is_statically_hidden_opening_element(&element.opening_element, ctx)
    {
        return String::new();
    }
    get_static_marketing_children_copy(&element.children, ctx)
}

fn get_static_marketing_fragment_copy<'a>(
    fragment: &'a JSXFragment<'a>,
    ctx: &LintContext<'a>,
) -> String {
    get_static_marketing_children_copy(&fragment.children, ctx)
}

fn get_static_marketing_children_copy<'a>(
    children: &'a [JSXChild<'a>],
    ctx: &LintContext<'a>,
) -> String {
    children
        .iter()
        .map(|child| get_static_marketing_child_copy(child, ctx))
        .collect::<Vec<_>>()
        .join(" ")
}

fn get_static_marketing_child_copy<'a>(child: &'a JSXChild<'a>, ctx: &LintContext<'a>) -> String {
    match child {
        JSXChild::Text(text) => text.value.to_string(),
        JSXChild::Element(element) => get_static_rendered_marketing_copy(element, ctx),
        JSXChild::Fragment(fragment) => get_static_marketing_fragment_copy(fragment, ctx),
        JSXChild::ExpressionContainer(container) => match &container.expression {
            JSXExpression::EmptyExpression(_) => String::new(),
            expression => expression.as_expression().map_or_else(
                || STATIC_COPY_BOUNDARY.to_string(),
                |expression| get_static_marketing_expression_copy(expression, ctx),
            ),
        },
        _ => STATIC_COPY_BOUNDARY.to_string(),
    }
}

fn get_static_marketing_expression_copy<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> String {
    match expression {
        Expression::StringLiteral(string_literal) => string_literal.value.to_string(),
        Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_) => String::new(),
        Expression::TemplateLiteral(template_literal) => {
            let static_segments = template_literal
                .quasis
                .iter()
                .map(|quasi| quasi.value.raw.as_str())
                .collect::<Vec<_>>();
            if template_literal.expressions.is_empty() {
                return static_segments.concat();
            }
            format!(
                "{STATIC_COPY_BOUNDARY}{}{STATIC_COPY_BOUNDARY}",
                static_segments.join(STATIC_COPY_BOUNDARY)
            )
        }
        Expression::JSXElement(element) => get_static_rendered_marketing_copy(element, ctx),
        Expression::JSXFragment(fragment) => get_static_marketing_fragment_copy(fragment, ctx),
        Expression::ConditionalExpression(conditional_expression) => format!(
            "{STATIC_COPY_BOUNDARY}{}{STATIC_COPY_BOUNDARY}{}{STATIC_COPY_BOUNDARY}",
            get_static_marketing_expression_copy(&conditional_expression.consequent, ctx),
            get_static_marketing_expression_copy(&conditional_expression.alternate, ctx),
        ),
        Expression::LogicalExpression(logical_expression) => format!(
            "{STATIC_COPY_BOUNDARY}{}{STATIC_COPY_BOUNDARY}",
            get_static_marketing_expression_copy(&logical_expression.right, ctx),
        ),
        _ => STATIC_COPY_BOUNDARY.to_string(),
    }
}

fn normalize_marketing_copy_whitespace(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut has_pending_whitespace = false;
    for character in value.chars() {
        if is_js_whitespace(character) {
            has_pending_whitespace = true;
            continue;
        }
        if has_pending_whitespace {
            normalized.push(' ');
            has_pending_whitespace = false;
        }
        normalized.push(character);
    }
    if has_pending_whitespace {
        normalized.push(' ');
    }
    normalized
}

fn find_first_marketing_phrase(page_text: &str) -> Option<&'static str> {
    let mut first_phrase = None;
    let mut first_phrase_index = page_text.len();
    for phrase in GENERIC_MARKETING_PHRASES {
        let mut search_start_index = 0;
        while search_start_index < page_text.len() {
            let Some(relative_phrase_index) = page_text[search_start_index..].find(phrase) else {
                break;
            };
            let phrase_index = search_start_index + relative_phrase_index;
            if phrase_index >= first_phrase_index {
                break;
            }
            let phrase_end = phrase_index + phrase.len();
            let preceding_character = page_text[..phrase_index].chars().next_back();
            let following_character = page_text[phrase_end..].chars().next();
            if !preceding_character.is_some_and(is_lexical_marketing_character)
                && !following_character.is_some_and(is_lexical_marketing_character)
            {
                first_phrase = Some(phrase);
                first_phrase_index = phrase_index;
                break;
            }
            search_start_index = phrase_end;
        }
    }
    first_phrase
}

fn is_lexical_marketing_character(character: char) -> bool {
    let mut encoded = [0; 4];
    LEXICAL_CHARACTER_PATTERN.is_match(character.encode_utf8(&mut encoded))
}
