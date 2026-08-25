use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const SHORT_DECORATIVE_LABEL_MAX_CHARACTERS: usize = 32;
const TINY_UPPERCASE_TRACKED_LABEL_MAX_PX: f64 = 11.0;
const PREFORMATTED_ELEMENT_NAMES: [&str; 5] = ["code", "kbd", "pre", "samp", "var"];
const MESSAGE: &str = "This tiny uppercase tracked label is difficult to scan and makes the interface feel mechanically styled. Use readable sentence-case text.";

#[derive(Debug, Default, Clone)]
pub struct NoTinyUppercaseTrackedLabel;

declare_oxc_lint!(
    /// Disallow tiny uppercase labels with decorative tracking.
    NoTinyUppercaseTrackedLabel,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow tiny uppercase tracked labels.",
);

impl Rule for NoTinyUppercaseTrackedLabel {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &element.opening_element.name else {
            return;
        };
        if identifier.name != identifier.name.to_lowercase()
            || PREFORMATTED_ELEMENT_NAMES.contains(&identifier.name.as_str())
            || element.opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            })
            || get_authoritative_jsx_attribute(&element.opening_element, "style", true).is_some()
            || element
                .children
                .iter()
                .any(|child| matches!(child, oxc_ast::ast::JSXChild::ExpressionContainer(_)))
        {
            return;
        }
        let text = normalize_static_jsx_whitespace(&get_static_jsx_text(element));
        if text.is_empty()
            || text.encode_utf16().count() > SHORT_DECORATIVE_LABEL_MAX_CHARACTERS
            || is_technical_label_text(&text)
        {
            return;
        }
        let Some(class_name) = get_static_class_name(&element.opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let Some(font_size_px) = get_static_tailwind_font_size(class_name) else {
            return;
        };
        if font_size_px <= 0.0 || font_size_px > TINY_UPPERCASE_TRACKED_LABEL_MAX_PX {
            return;
        }
        let effective_case = get_effective_tailwind_class_name_token(&tokens, |utility| {
            matches!(
                utility,
                "capitalize" | "lowercase" | "normal-case" | "uppercase"
            )
        });
        if effective_case != Some("uppercase")
            || get_effective_nonzero_tailwind_tracking(&tokens).is_none()
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}
