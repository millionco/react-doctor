use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, rule::Rule};

const MESSAGE: &str = "This table header has no accessible text, so users cannot tell what its cells represent. Add header text or an accessible name.";

#[derive(Debug, Default, Clone)]
pub struct EmptyTableHeader;

declare_oxc_lint!(
    /// Require accessible text on table headers.
    EmptyTableHeader,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible text on table headers.",
);

impl Rule for EmptyTableHeader {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &crate::context::LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let opening_element = &element.opening_element;
        let element_type = resolve_jsx_element_type_name(opening_element, ctx);
        if element_type
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_uppercase)
            || (element_type != "th" && !has_table_header_role(opening_element))
            || object_has_accessible_child(element, ctx)
            || has_potential_accessible_name(opening_element)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn has_table_header_role(opening_element: &oxc_ast::ast::JSXOpeningElement) -> bool {
    get_authoritative_jsx_attribute(opening_element, "role", false)
        .and_then(get_string_literal_attribute_value)
        .is_some_and(|role| {
            matches!(
                role.to_ascii_lowercase().as_str(),
                "columnheader" | "rowheader"
            )
        })
}

fn has_potential_accessible_name(opening_element: &oxc_ast::ast::JSXOpeningElement) -> bool {
    ["aria-label", "aria-labelledby"]
        .iter()
        .any(|attribute_name| {
            let Some(attribute) =
                get_authoritative_jsx_attribute(opening_element, attribute_name, false)
            else {
                return false;
            };
            get_string_literal_attribute_value(attribute)
                .is_none_or(|value| !value.trim().is_empty())
        })
}
