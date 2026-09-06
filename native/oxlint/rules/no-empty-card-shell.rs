use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This empty semantic container still draws a padded card shell. Remove the surface until it has content, or render a purposeful empty state.";
static PADDING_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> =
    lazy_regex::lazy_regex!(r"^p[xytrbles]?-(?:px|[0-9.]+|\[[^\]]+\])$");

#[derive(Debug, Default, Clone)]
pub struct NoEmptyCardShell;

declare_oxc_lint!(
    /// Disallow empty semantic elements styled as padded cards.
    NoEmptyCardShell,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow empty semantic card shells.",
);

impl Rule for NoEmptyCardShell {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &element.opening_element.name else {
            return;
        };
        if !matches!(identifier.name.as_str(), "article" | "aside" | "section")
            || element.children.iter().any(|child| match child {
                oxc_ast::ast::JSXChild::Text(text) => {
                    !text.value.trim_matches(is_js_whitespace).is_empty()
                }
                _ => true,
            })
            || element
                .opening_element
                .attributes
                .iter()
                .any(is_content_bearing_attribute)
        {
            return;
        }
        let Some(class_name) = get_static_class_name(&element.opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let utilities = tokens
            .iter()
            .filter(|token| token.variants.is_empty())
            .map(|token| token.utility)
            .collect::<Vec<_>>();
        if !utilities
            .iter()
            .any(|utility| *utility == "rounded" || utility.starts_with("rounded-"))
            || !utilities
                .iter()
                .any(|utility| PADDING_PATTERN.is_match(utility))
            || !has_visible_tailwind_fill_or_edge(&utilities)
            || utilities.iter().any(|utility| {
                utility.starts_with("animate-")
                    || matches!(*utility, "skeleton" | "shimmer" | "placeholder")
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn is_content_bearing_attribute(attribute: &oxc_ast::ast::JSXAttributeItem<'_>) -> bool {
    let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
        return true;
    };
    matches!(
        &attribute.name,
        oxc_ast::ast::JSXAttributeName::Identifier(identifier)
            if matches!(
                identifier.name.as_str(),
                "children" | "contentEditable" | "dangerouslySetInnerHTML" | "role"
            )
    )
}
