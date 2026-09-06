use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This element is marked presentational but is also focusable or carries global ARIA state, so assistive technologies may expose conflicting semantics. Remove one side of the conflict.";
const GLOBAL_ARIA_ATTRIBUTES: [&str; 21] = [
    "aria-atomic",
    "aria-braillelabel",
    "aria-brailleroledescription",
    "aria-busy",
    "aria-controls",
    "aria-current",
    "aria-describedby",
    "aria-description",
    "aria-details",
    "aria-disabled",
    "aria-errormessage",
    "aria-flowto",
    "aria-haspopup",
    "aria-invalid",
    "aria-keyshortcuts",
    "aria-label",
    "aria-labelledby",
    "aria-live",
    "aria-owns",
    "aria-relevant",
    "aria-roledescription",
];

#[derive(Debug, Default, Clone)]
pub struct NoPresentationRoleConflict;

declare_oxc_lint!(
    /// Disallow presentational elements with conflicting semantics.
    NoPresentationRoleConflict,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow presentational elements with conflicting semantics.",
);

impl Rule for NoPresentationRoleConflict {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let element_type = resolve_jsx_element_type_name(opening_element, ctx);
        if element_type
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_uppercase)
            || !has_presentational_semantics(opening_element, &element_type)
        {
            return;
        }
        let global_aria_attribute = opening_element.attributes.iter().find_map(|attribute| {
            let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
                return None;
            };
            let oxc_ast::ast::JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                return None;
            };
            GLOBAL_ARIA_ATTRIBUTES
                .iter()
                .any(|name| attribute_name.name.eq_ignore_ascii_case(name))
                .then_some(attribute)
        });
        if !is_focusable_jsx_opening_element(opening_element, &element_type, true)
            && global_aria_attribute.is_none()
        {
            return;
        }
        let span = global_aria_attribute
            .map_or_else(|| opening_element.name.span(), |attribute| attribute.span);
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(span));
    }
}

fn has_presentational_semantics(
    opening_element: &oxc_ast::ast::JSXOpeningElement,
    element_type: &str,
) -> bool {
    if get_authoritative_jsx_attribute(opening_element, "role", false)
        .and_then(|attribute| get_string_literal_attribute_value(attribute))
        .and_then(|role| first_js_whitespace_token(role))
        .is_some_and(|role| {
            role.eq_ignore_ascii_case("none") || role.eq_ignore_ascii_case("presentation")
        })
    {
        return true;
    }
    element_type == "img"
        && get_authoritative_jsx_attribute(opening_element, "alt", false)
            .and_then(|attribute| get_string_literal_attribute_value(attribute))
            == Some("")
}
