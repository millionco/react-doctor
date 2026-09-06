use oxc_ast::{ast::JSXElementName, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const DISPLAY_TEXT_CLASS_NAMES: [&str; 5] =
    ["text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl"];

#[derive(Debug, Default, Clone)]
pub struct NoItalicSerifDisplayHeading;

declare_oxc_lint!(
    /// Disallow oversized italic serif headings.
    NoItalicSerifDisplayHeading,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow oversized italic serif headings.",
);

impl Rule for NoItalicSerifDisplayHeading {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !matches!(
            &opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "h1" || identifier.name == "h2"
        ) {
            return;
        }
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        let unvariant_utilities = tailwind_class_name_tokens(class_name)
            .into_iter()
            .filter(|token| token.variants.is_empty())
            .map(|token| token.utility)
            .collect::<Vec<_>>();
        if !unvariant_utilities.contains(&"font-serif")
            || !unvariant_utilities.contains(&"italic")
            || !DISPLAY_TEXT_CLASS_NAMES
                .iter()
                .any(|utility| unvariant_utilities.contains(utility))
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(
                "This oversized italic serif treatment is visually overdetermined. Use roman display type or keep the italic accent smaller.",
            )
            .with_label(opening_element.span),
        );
    }
}
