use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const CENTERED_COPY_MIN_COUNT: usize = 3;
const CENTERED_COPY_MIN_CHARACTERS: usize = 48;

#[derive(Debug, Default, Clone)]
pub struct NoExcessiveCenteredCopy;

declare_oxc_lint!(
    /// Disallow repeated centered body-copy blocks on a page.
    NoExcessiveCenteredCopy,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow excessive centered body copy.",
);

impl Rule for NoExcessiveCenteredCopy {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !is_top_level_page_copy_root(element, node, ctx) {
            return;
        }
        let centered_paragraph_count = count_centered_paragraphs(element);
        if centered_paragraph_count < CENTERED_COPY_MIN_COUNT {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This page centers {centered_paragraph_count} substantial paragraphs. Left-align body copy to improve scanning and keep centered composition from becoming a template default."
            ))
            .with_label(element.opening_element.span),
        );
    }
}

fn count_centered_paragraphs(element: &oxc_ast::ast::JSXElement) -> usize {
    usize::from(is_centered_paragraph(element))
        + count_centered_paragraphs_in_children(&element.children)
}

fn count_centered_paragraphs_in_children(children: &[oxc_ast::ast::JSXChild]) -> usize {
    children
        .iter()
        .map(|child| match child {
            oxc_ast::ast::JSXChild::Element(element) => count_centered_paragraphs(element),
            oxc_ast::ast::JSXChild::Fragment(fragment) => {
                count_centered_paragraphs_in_children(&fragment.children)
            }
            _ => 0,
        })
        .sum()
}

fn is_centered_paragraph(element: &oxc_ast::ast::JSXElement) -> bool {
    if !matches!(
        &element.opening_element.name,
        JSXElementName::Identifier(identifier) if identifier.name == "p"
    ) {
        return false;
    }
    let text = normalize_js_whitespace(&get_static_jsx_text(element));
    if text.encode_utf16().count() < CENTERED_COPY_MIN_CHARACTERS {
        return false;
    }
    get_static_class_name(&element.opening_element).is_some_and(|class_name| {
        tailwind_class_name_tokens(class_name)
            .iter()
            .any(|token| token.variants.is_empty() && token.utility == "text-center")
    })
}

fn normalize_js_whitespace(value: &str) -> String {
    value
        .split(|character| is_js_whitespace(character))
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
