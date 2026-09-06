use oxc_ast::{AstKind, ast::JSXAttributeName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const BLOCK_LEVEL_ELEMENTS: [&str; 31] = [
    "address",
    "article",
    "aside",
    "blockquote",
    "details",
    "div",
    "dl",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hgroup",
    "hr",
    "main",
    "menu",
    "nav",
    "ol",
    "p",
    "pre",
    "search",
    "section",
    "table",
    "ul",
];

#[derive(Debug, Default, Clone)]
pub struct HtmlNoInvalidParagraphChild;

declare_oxc_lint!(
    /// Disallow block-level elements inside paragraphs.
    HtmlNoInvalidParagraphChild,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow block-level elements inside paragraphs.",
);

impl Rule for HtmlNoInvalidParagraphChild {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some((child_tag_name, child_name_span)) = resolve_jsx_element_type(opening_element, ctx)
        else {
            return;
        };
        if !BLOCK_LEVEL_ELEMENTS.contains(&child_tag_name)
            || !has_enclosing_paragraph(node, ctx)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users get reshuffled HTML because `<{child_tag_name}>` can't go inside a `<p>`, so the browser closes the paragraph early. Move it out of the `<p>`, or use a `<div>` instead."
            ))
            .with_label(child_name_span),
        );
    }
}

fn has_enclosing_paragraph(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let owning_element = ctx.nodes().parent_node(node.id());
    for ancestor in ctx.nodes().ancestors(owning_element.id()) {
        match ancestor.kind() {
            AstKind::JSXAttribute(attribute) => {
                if !matches!(
                    &attribute.name,
                    JSXAttributeName::Identifier(identifier) if identifier.name == "children"
                ) {
                    return false;
                }
            }
            AstKind::JSXElement(element)
                if resolve_jsx_element_type(&element.opening_element, ctx)
                    .is_some_and(|(element_name, _)| element_name == "p") =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}
