use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const SHORT_DECORATIVE_LABEL_MAX_CHARACTERS: usize = 32;
const PREFORMATTED_ELEMENT_NAMES: [&str; 5] = ["code", "kbd", "pre", "samp", "var"];
const MESSAGE: &str = "This short label combines uppercase and monospace as a decorative technical motif. Use normal interface typography unless the content is actually code.";

#[derive(Debug, Default, Clone)]
pub struct NoUppercaseMonoLabel;

declare_oxc_lint!(
    /// Disallow decorative uppercase monospace labels.
    NoUppercaseMonoLabel,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow uppercase monospace labels.",
);

impl Rule for NoUppercaseMonoLabel {
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
        let text = normalize_js_whitespace(&get_static_jsx_text(element));
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
        let effective_font_family = get_effective_tailwind_class_name_token(&tokens, |utility| {
            matches!(utility, "font-mono" | "font-sans" | "font-serif")
        });
        let effective_case = get_effective_tailwind_class_name_token(&tokens, |utility| {
            matches!(
                utility,
                "capitalize" | "lowercase" | "normal-case" | "uppercase"
            )
        });
        if effective_font_family != Some("font-mono")
            || effective_case != Some("uppercase")
            || get_effective_nonzero_tailwind_tracking(&tokens).is_none()
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn normalize_js_whitespace(value: &str) -> String {
    value
        .split(|character| is_js_whitespace(character))
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
