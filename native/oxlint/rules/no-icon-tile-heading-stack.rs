use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This card adds a separate rounded icon tile directly above the heading. Simplify the hierarchy or align the icon with the title.";
static TILE_SIZE_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> =
    lazy_regex::lazy_regex!(r"^(?:size|h|w)-(?:8|9|10|11|12|14|16)$");

#[derive(Debug, Default, Clone)]
pub struct NoIconTileHeadingStack;

declare_oxc_lint!(
    /// Disallow card layouts that stack a boxed icon directly above a heading.
    NoIconTileHeadingStack,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow icon-tile heading stacks.",
);

impl Rule for NoIconTileHeadingStack {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !is_icon_tile(element) {
            return;
        }
        let AstKind::JSXElement(parent) = ctx.nodes().parent_node(node.id()).kind() else {
            return;
        };
        if !is_tailwind_card_surface(&parent.opening_element) {
            return;
        }
        let Some(heading) = get_next_static_jsx_element_sibling(element, node, ctx) else {
            return;
        };
        if !matches!(
            &heading.opening_element.name,
            JSXElementName::Identifier(identifier)
                if matches!(identifier.name.as_str(), "h2" | "h3" | "h4")
        ) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn is_icon_tile(element: &oxc_ast::ast::JSXElement<'_>) -> bool {
    if !contains_icon(element) {
        return false;
    }
    let Some(class_name) = get_static_class_name(&element.opening_element) else {
        return false;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    let utilities = tokens
        .iter()
        .filter(|token| token.variants.is_empty())
        .map(|token| token.utility)
        .collect::<Vec<_>>();
    utilities
        .iter()
        .any(|utility| TILE_SIZE_PATTERN.is_match(utility))
        && utilities.iter().any(|utility| {
            *utility == "rounded"
                || utility.starts_with("rounded-") && *utility != "rounded-none"
        })
        && has_visible_tailwind_fill_or_edge(&utilities)
}

fn contains_icon(element: &oxc_ast::ast::JSXElement<'_>) -> bool {
    let element_name = match &element.opening_element.name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        _ => None,
    };
    if element_name.is_some_and(|name| name == "svg" || name.ends_with("Icon")) {
        return true;
    }
    element.children.iter().any(|child| {
        let oxc_ast::ast::JSXChild::Element(child_element) = child else {
            return false;
        };
        contains_icon(child_element)
    })
}
