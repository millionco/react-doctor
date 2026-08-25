use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeName, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This positioned overlay sits inside an overflow-clipping ancestor, so menus or tooltips can be cut off. Portal it outside the container.";
const OVERLAY_ROLES: [&str; 4] = ["dialog", "listbox", "menu", "tooltip"];
const CLIPPING_CLASS_NAMES: [&str; 2] = ["overflow-clip", "overflow-hidden"];

#[derive(Debug, Default, Clone)]
pub struct NoClippedOverlay;

declare_oxc_lint!(
    /// Disallow absolute overlays inside overflow-clipping ancestors.
    NoClippedOverlay,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow absolute overlays inside overflow-clipping ancestors.",
);

impl Rule for NoClippedOverlay {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !is_absolute_overlay(&element.opening_element)
            || !ctx.nodes().ancestors(node.id()).any(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::JSXElement(ancestor_element)
                        if has_base_class_name_token(
                            &ancestor_element.opening_element,
                            &CLIPPING_CLASS_NAMES,
                        )
                )
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn is_absolute_overlay(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let JSXElementName::Identifier(identifier) = &opening_element.name else {
        return false;
    };
    if identifier
        .name
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_uppercase)
    {
        return false;
    }
    let Some(role) = find_jsx_attribute_ignore_ascii_case(opening_element, "role")
        .and_then(|attribute| get_string_literal_attribute_value(attribute))
    else {
        return false;
    };
    OVERLAY_ROLES
        .iter()
        .any(|overlay_role| role.eq_ignore_ascii_case(overlay_role))
        && has_base_class_name_token(opening_element, &["absolute"])
}

fn find_jsx_attribute_ignore_ascii_case<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    target_name: &str,
) -> Option<&'b oxc_ast::ast::JSXAttribute<'a>> {
    opening_element.attributes.iter().find_map(|attribute| {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            return None;
        };
        match &attribute.name {
            JSXAttributeName::Identifier(identifier)
                if identifier.name.eq_ignore_ascii_case(target_name) =>
            {
                Some(attribute.as_ref())
            }
            _ => None,
        }
    })
}

fn has_base_class_name_token(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    target_tokens: &[&str],
) -> bool {
    get_static_class_name(opening_element).is_some_and(|class_name| {
        tailwind_class_name_tokens(class_name).iter().any(|token| {
            token.variants.is_empty() && target_tokens.contains(&token.utility)
        })
    })
}
