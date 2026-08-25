use lazy_regex::{lazy_regex, Lazy, Regex};
use oxc_ast::{
    ast::{Expression, JSXChild, JSXElement, JSXExpression, JSXFragment},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MANUFACTURED_COPY_PATTERN_MIN_COUNT: usize = 3;
const STATIC_COPY_BOUNDARY: &str = "?!";
const LONG_FORM_CONTENT_PATH_SEGMENTS: [&str; 8] = [
    "blog",
    "changelog",
    "content",
    "doc",
    "docs",
    "documentation",
    "post",
    "posts",
];
static NOT_THEN_ASSERTION_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?-u:\b)not\s+(?:just\s+)?[^.!?]{3,60}[.!?]\s+(?:it(?:'s| is)|we|you|a|an|the)(?-u:\b)"
);
static NO_JUST_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?-u:\b)no\s+[^.!?]{2,50}[.!?]\s+just\s+[^.!?]{2,60}(?:[.!?]|$)");
static ASSERTION_THEN_RESTRICTION_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?-u:\b)[^.!?]{3,60}\.\s+(?:no|just)\s+[^.!?]{2,60}(?:[.!?]|$)");

#[derive(Debug, Default, Clone)]
pub struct NoManufacturedContrastCopy;

declare_oxc_lint!(
    /// Disallow repeated contrast-first sentence patterns in page copy.
    NoManufacturedContrastCopy,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow repeated contrast-first sentence patterns in page copy.",
);

impl Rule for NoManufacturedContrastCopy {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && !is_long_form_content_path(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !is_top_level_page_copy_root(element, node, ctx)
            || is_inside_excluded_copy_context(element, node, ctx)
        {
            return;
        }
        let Some(static_copy) = get_static_element_copy(element, ctx) else {
            return;
        };
        let page_text = normalize_copy_whitespace(&static_copy);
        let pattern_count = count_non_overlapping_pattern_ranges(&page_text);
        if pattern_count < MANUFACTURED_COPY_PATTERN_MIN_COUNT {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This page uses contrast-first sentence patterns {pattern_count} times. Rewrite the claims as direct, concrete statements."
            ))
            .with_label(element.opening_element.span),
        );
    }
}

fn is_long_form_content_path(ctx: &ContextHost<'_>) -> bool {
    let root_directory = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("rootDirectory"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let filename = ctx.file_path().to_string_lossy();
    [root_directory, filename.as_ref()]
        .into_iter()
        .flat_map(|path| path.split(['/', '\\']))
        .any(|segment| {
            LONG_FORM_CONTENT_PATH_SEGMENTS
                .iter()
                .any(|candidate| segment.eq_ignore_ascii_case(candidate))
        })
}

fn is_inside_excluded_copy_context<'a>(
    element: &'a JSXElement<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    is_statically_hidden_opening_element(&element.opening_element, ctx)
        || is_inside_statically_hidden_jsx_subtree(node, ctx)
        || ctx.nodes().ancestors(node.id()).any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::JSXElement(ancestor_element) if is_excluded_copy_element(ancestor_element)
            )
        })
}

fn is_excluded_copy_element(element: &JSXElement<'_>) -> bool {
    let Some(element_name) = resolve_jsx_element_name(&element.opening_element) else {
        return false;
    };
    matches!(
        element_name.to_ascii_lowercase().as_str(),
        "code" | "kbd" | "pre" | "samp"
    ) || ["Code", "Console", "Markdown", "MDX", "Mdx", "Terminal"]
        .iter()
        .any(|fragment| element_name.contains(fragment))
}

fn get_static_element_copy<'a>(
    element: &'a JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    if is_excluded_copy_element(element)
        || is_statically_hidden_opening_element(&element.opening_element, ctx)
    {
        return Some(STATIC_COPY_BOUNDARY.to_string());
    }
    get_static_children_copy(&element.children, ctx)
}

fn get_static_fragment_copy<'a>(
    fragment: &'a JSXFragment<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    get_static_children_copy(&fragment.children, ctx)
}

fn get_static_children_copy<'a>(
    children: &'a [JSXChild<'a>],
    ctx: &LintContext<'a>,
) -> Option<String> {
    children
        .iter()
        .map(|child| get_static_child_copy(child, ctx))
        .collect::<Option<Vec<_>>>()
        .map(|copy| copy.join(" "))
}

fn get_static_child_copy<'a>(child: &'a JSXChild<'a>, ctx: &LintContext<'a>) -> Option<String> {
    match child {
        JSXChild::Text(text) => Some(text.value.to_string()),
        JSXChild::Element(element) => get_static_element_copy(element, ctx),
        JSXChild::Fragment(fragment) => get_static_fragment_copy(fragment, ctx),
        JSXChild::ExpressionContainer(container) => match &container.expression {
            JSXExpression::EmptyExpression(_) => Some(String::new()),
            expression => expression
                .as_expression()
                .and_then(|expression| get_static_expression_copy(expression, ctx)),
        },
        _ => None,
    }
}

fn get_static_expression_copy<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    match expression {
        Expression::StringLiteral(string_literal) => Some(string_literal.value.to_string()),
        Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => Some(String::new()),
        Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_) => Some(STATIC_COPY_BOUNDARY.to_string()),
        Expression::TemplateLiteral(template_literal)
            if template_literal.expressions.is_empty() =>
        {
            Some(
                template_literal
                    .quasis
                    .iter()
                    .map(|quasi| quasi.value.raw.as_str())
                    .collect::<String>(),
            )
        }
        Expression::JSXElement(element) => get_static_element_copy(element, ctx),
        Expression::JSXFragment(fragment) => get_static_fragment_copy(fragment, ctx),
        _ => None,
    }
}

fn normalize_copy_whitespace(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut has_pending_whitespace = false;
    for character in value.chars() {
        if is_js_whitespace(character) {
            has_pending_whitespace = !normalized.is_empty();
            continue;
        }
        if has_pending_whitespace {
            normalized.push(' ');
            has_pending_whitespace = false;
        }
        normalized.push(character);
    }
    normalized
}

fn count_non_overlapping_pattern_ranges(text: &str) -> usize {
    let mut ranges = [
        &*NOT_THEN_ASSERTION_PATTERN,
        &*NO_JUST_PATTERN,
        &*ASSERTION_THEN_RESTRICTION_PATTERN,
    ]
    .into_iter()
    .flat_map(|pattern| pattern.find_iter(text).map(|matched| matched.range()))
    .collect::<Vec<_>>();
    ranges.sort_by_key(|range| range.start);

    let mut pattern_count = 0;
    let mut previous_range_end = None;
    for range in ranges {
        if previous_range_end.is_some_and(|previous_end| range.start < previous_end) {
            continue;
        }
        pattern_count += 1;
        previous_range_end = Some(range.end);
    }
    pattern_count
}
