use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This focusable control sits inside role=text, which can flatten descendant semantics and hide the control from assistive technology. Move it outside or remove role=text.";

#[derive(Debug, Default, Clone)]
pub struct NoFocusableContentInRoleText;

declare_oxc_lint!(
    /// Disallow focusable controls inside role=text.
    NoFocusableContentInRoleText,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow focusable controls inside role=text.",
);

impl Rule for NoFocusableContentInRoleText {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let element_type = resolve_jsx_element_type_name(opening_element, ctx);
        if element_type
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_uppercase)
            || !is_focusable_jsx_opening_element(opening_element, &element_type, false)
            || !has_role_text_ancestor(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn has_role_text_ancestor<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        match ancestor.kind() {
            AstKind::JSXAttribute(_) => return false,
            AstKind::JSXElement(element) => {
                let opening_element = &element.opening_element;
                let element_type = resolve_jsx_element_type_name(opening_element, ctx);
                if element_type
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_uppercase)
                {
                    return false;
                }
                if get_authoritative_jsx_attribute(opening_element, "role", false)
                    .and_then(|attribute| get_string_literal_attribute_value(attribute))
                    .and_then(|role| first_js_whitespace_token(role))
                    .is_some_and(|role| role.eq_ignore_ascii_case("text"))
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}
