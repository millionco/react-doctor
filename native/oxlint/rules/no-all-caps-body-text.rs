use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const LONG_BODY_TEXT_MIN_CHARACTERS: usize = 48;
const BODY_TEXT_ELEMENT_NAMES: [&str; 6] = ["blockquote", "dd", "figcaption", "li", "p", "td"];
const MESSAGE: &str = "Long all-caps copy is difficult to scan. Use sentence case here and keep uppercase treatment for compact labels.";

#[derive(Debug, Default, Clone)]
pub struct NoAllCapsBodyText;

declare_oxc_lint!(
    /// Disallow long static body copy in all caps.
    NoAllCapsBodyText,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow long all-caps body copy.",
);

impl Rule for NoAllCapsBodyText {
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
        if !BODY_TEXT_ELEMENT_NAMES.contains(&identifier.name.as_str()) {
            return;
        }
        let static_text = normalize_js_whitespace(&get_static_jsx_text(element));
        if static_text.encode_utf16().count() < LONG_BODY_TEXT_MIN_CHARACTERS
            || !static_text
                .chars()
                .any(|character| character.is_uppercase() || character.is_lowercase())
        {
            return;
        }
        let is_literal_uppercase = static_text.chars().any(char::is_uppercase)
            && static_text.to_uppercase() == static_text;
        if !is_literal_uppercase && !has_uppercase_style(&element.opening_element) {
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

fn has_uppercase_style(opening_element: &oxc_ast::ast::JSXOpeningElement) -> bool {
    if get_static_class_name(opening_element).is_some_and(|class_name| {
        tailwind_class_name_tokens(class_name)
            .iter()
            .any(|token| token.variants.is_empty() && token.utility == "uppercase")
    }) {
        return true;
    }
    opening_element.attributes.iter().any(|attribute| {
        let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
            return false;
        };
        let Some(style) = get_inline_style_object_expression(attribute) else {
            return false;
        };
        get_effective_static_style_property_string_value(style, "textTransform")
            .is_some_and(|(_, value)| value.to_lowercase() == "uppercase")
    })
}
