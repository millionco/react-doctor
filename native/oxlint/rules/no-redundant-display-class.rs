use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const BLOCK_DEFAULT_TAGS: [&str; 27] = [
    "div",
    "p",
    "section",
    "article",
    "main",
    "header",
    "footer",
    "nav",
    "aside",
    "figure",
    "figcaption",
    "blockquote",
    "form",
    "fieldset",
    "address",
    "pre",
    "ul",
    "ol",
    "dl",
    "dt",
    "dd",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
];
const INLINE_DEFAULT_TAGS: [&str; 21] = [
    "span", "a", "b", "i", "em", "strong", "small", "code", "abbr", "cite", "label", "mark", "q",
    "s", "u", "sub", "sup", "kbd", "samp", "var", "time",
];
const TAILWIND_DISPLAY_TOKENS: [&str; 21] = [
    "block",
    "inline-block",
    "inline",
    "flex",
    "inline-flex",
    "table",
    "inline-table",
    "table-caption",
    "table-cell",
    "table-column",
    "table-column-group",
    "table-footer-group",
    "table-header-group",
    "table-row-group",
    "table-row",
    "flow-root",
    "grid",
    "inline-grid",
    "contents",
    "list-item",
    "hidden",
];

#[derive(Debug, Default, Clone)]
pub struct NoRedundantDisplayClass;

declare_oxc_lint!(
    /// Disallow Tailwind display utilities that match the element default.
    NoRedundantDisplayClass,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow redundant Tailwind display utilities.",
);

impl Rule for NoRedundantDisplayClass {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &opening_element.name else {
            return;
        };
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        let mut display_token = None;
        for token in tailwind_class_name_tokens(class_name) {
            let raw_token = token.raw_token;
            if raw_token.starts_with('!') || raw_token.ends_with('!') {
                continue;
            }
            if !TAILWIND_DISPLAY_TOKENS.contains(&raw_token) {
                continue;
            }
            if display_token.is_some_and(|existing_token| existing_token != raw_token) {
                return;
            }
            display_token = Some(raw_token);
        }
        let Some(display_token) = display_token else {
            return;
        };
        let tag_name = identifier.name.as_str();
        if display_token == "block" && BLOCK_DEFAULT_TAGS.contains(&tag_name) {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "`block` is the default display of `<{tag_name}>`, so the class does nothing — remove it."
                ))
                .with_label(opening_element.span),
            );
        } else if display_token == "inline" && INLINE_DEFAULT_TAGS.contains(&tag_name) {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "`inline` is the default display of `<{tag_name}>`, so the class does nothing — remove it."
                ))
                .with_label(opening_element.span),
            );
        }
    }
}
