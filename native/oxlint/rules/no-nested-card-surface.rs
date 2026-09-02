use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const CARD_CONTAINER_ELEMENT_NAMES: [&str; 10] = [
    "article", "aside", "details", "div", "fieldset", "figure", "form", "li", "main", "section",
];
const MESSAGE: &str = "This full card treatment sits inside another card and adds unnecessary visual depth. Flatten the inner group.";

#[derive(Debug, Default, Clone)]
pub struct NoNestedCardSurface;

declare_oxc_lint!(
    /// Disallow complete card surfaces nested inside another card.
    NoNestedCardSurface,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow nested card surfaces.",
);

impl Rule for NoNestedCardSurface {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !is_card_container(&element.opening_element)
            || !is_tailwind_padded_card_surface(&element.opening_element)
            || !has_card_ancestor(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn is_card_container(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let JSXElementName::Identifier(identifier) = &opening_element.name else {
        return false;
    };
    CARD_CONTAINER_ELEMENT_NAMES.contains(&identifier.name.as_str())
        && get_authoritative_jsx_attribute(opening_element, "style", true).is_none()
        && !opening_element
            .attributes
            .iter()
            .any(|attribute| matches!(attribute, oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)))
}

fn has_card_ancestor<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        let JSXElementName::Identifier(identifier) = &element.opening_element.name else {
            return false;
        };
        if identifier.name != identifier.name.to_ascii_lowercase() {
            return false;
        }
        if is_card_container(&element.opening_element)
            && is_tailwind_card_surface(&element.opening_element)
        {
            return true;
        }
    }
    false
}
