use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, rule::Rule};

const ROLE_DESCRIPTION_MESSAGE: &str = "This braille role description has no non-braille equivalent. Add a nonempty aria-roledescription for other assistive technologies.";
const LABEL_MESSAGE: &str = "This braille label is the element's only accessible name. Add visible text, aria-label, aria-labelledby, alt, or title for non-braille assistive technology.";
const ACCESSIBLE_NAME_ATTRIBUTES: [&str; 4] = ["aria-label", "aria-labelledby", "alt", "title"];

#[derive(Debug, Default, Clone)]
pub struct AriaBrailleEquivalent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LiteralAttributeState {
    Missing,
    Dynamic,
    Empty,
    Nonempty,
}

declare_oxc_lint!(
    /// Require non-braille equivalents for braille labels.
    AriaBrailleEquivalent,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require non-braille equivalents for braille labels.",
);

impl Rule for AriaBrailleEquivalent {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &crate::context::LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let opening_element = &element.opening_element;
        if opening_element.attributes.iter().any(|attribute| {
            matches!(
                attribute,
                oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
            )
        }) {
            return;
        }
        if literal_attribute_state(opening_element, "aria-brailleroledescription")
            == LiteralAttributeState::Nonempty
            && matches!(
                literal_attribute_state(opening_element, "aria-roledescription"),
                LiteralAttributeState::Missing | LiteralAttributeState::Empty
            )
            && let Some(attribute) = get_authoritative_jsx_attribute(
                opening_element,
                "aria-brailleroledescription",
                false,
            )
        {
            ctx.diagnostic(
                OxcDiagnostic::warn(ROLE_DESCRIPTION_MESSAGE).with_label(attribute.span),
            );
        }
        if literal_attribute_state(opening_element, "aria-braillelabel")
            != LiteralAttributeState::Nonempty
            || object_has_accessible_child(element, ctx)
            || ACCESSIBLE_NAME_ATTRIBUTES.iter().any(|attribute_name| {
                matches!(
                    literal_attribute_state(opening_element, attribute_name),
                    LiteralAttributeState::Dynamic | LiteralAttributeState::Nonempty
                )
            })
        {
            return;
        }
        let Some(attribute) =
            get_authoritative_jsx_attribute(opening_element, "aria-braillelabel", false)
        else {
            return;
        };
        ctx.diagnostic(OxcDiagnostic::warn(LABEL_MESSAGE).with_label(attribute.span));
    }
}

fn literal_attribute_state(
    opening_element: &oxc_ast::ast::JSXOpeningElement,
    attribute_name: &str,
) -> LiteralAttributeState {
    let Some(attribute) = get_authoritative_jsx_attribute(opening_element, attribute_name, false)
    else {
        return LiteralAttributeState::Missing;
    };
    let Some(value) = get_string_literal_attribute_value(attribute) else {
        return LiteralAttributeState::Dynamic;
    };
    if value.trim().is_empty() {
        LiteralAttributeState::Empty
    } else {
        LiteralAttributeState::Nonempty
    }
}
