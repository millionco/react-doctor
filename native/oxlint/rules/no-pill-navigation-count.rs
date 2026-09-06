use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This navigation count is styled as a pill, adding visual noise to a repeated row. Use aligned plain text with tabular numerals.";
static HORIZONTAL_PADDING_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> =
    lazy_regex::lazy_regex!(r"^px-(?:px|[0-9.]+|\[[^\]]+\])$");

#[derive(Debug, Default, Clone)]
pub struct NoPillNavigationCount;

declare_oxc_lint!(
    /// Disallow pill badges for navigation counts.
    NoPillNavigationCount,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow pill badges for navigation counts.",
);

impl Rule for NoPillNavigationCount {
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
        if !matches!(identifier.name.as_str(), "small" | "span")
            || element
                .children
                .iter()
                .any(|child| matches!(child, oxc_ast::ast::JSXChild::ExpressionContainer(_)))
            || !is_inside_navigation(node, ctx)
        {
            return;
        }
        let text = get_static_jsx_text(element);
        let text = text.trim_matches(is_js_whitespace);
        if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
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
        if !utilities.contains(&"rounded-full")
            || !utilities
                .iter()
                .any(|utility| HORIZONTAL_PADDING_PATTERN.is_match(utility))
            || !has_visible_tailwind_fill_or_edge(&utilities)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}
