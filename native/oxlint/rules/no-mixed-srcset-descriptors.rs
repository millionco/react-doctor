use oxc_ast::{ast::JSXAttributeItem, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "This srcSet mixes width and pixel-density descriptors, which is invalid candidate syntax. Use one descriptor family consistently.";

#[derive(Debug, Default, Clone)]
pub struct NoMixedSrcsetDescriptors;

declare_oxc_lint!(
    /// Disallow mixed width and density srcSet descriptors.
    NoMixedSrcsetDescriptors,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow mixed width and density srcSet descriptors.",
);

impl Rule for NoMixedSrcsetDescriptors {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type(opening_element, ctx).map(|(name, _)| name) != Some("img")
            || opening_element
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        {
            return;
        }
        let Some(source_set_attribute) = opening_element.attributes.iter().find_map(|attribute| {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                return None;
            };
            matches!(
                &attribute.name,
                oxc_ast::ast::JSXAttributeName::Identifier(identifier)
                    if identifier.name == "srcSet"
            )
            .then_some(attribute.as_ref())
        }) else {
            return;
        };
        let Some(source_set) = get_string_literal_attribute_value(source_set_attribute) else {
            return;
        };
        if source_set.is_empty() || !has_mixed_descriptors(source_set) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(source_set_attribute.span));
    }
}

fn has_mixed_descriptors(source_set: &str) -> bool {
    if source_set.contains("data:") {
        return false;
    }
    let mut has_width_descriptor = false;
    let mut has_density_descriptor = false;
    for candidate in source_set.split(',') {
        let mut descriptor_parts = candidate.split_whitespace();
        descriptor_parts.next();
        let descriptor = match descriptor_parts.next() {
            Some(first_descriptor_part) => descriptor_parts.last().unwrap_or(first_descriptor_part),
            None => "",
        };
        if is_width_descriptor(descriptor) {
            has_width_descriptor = true;
        } else if descriptor.is_empty() || is_density_descriptor(descriptor) {
            has_density_descriptor = true;
        } else {
            return false;
        }
    }
    has_width_descriptor && has_density_descriptor
}

fn is_width_descriptor(descriptor: &str) -> bool {
    descriptor.strip_suffix('w').is_some_and(|number| {
        !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
    })
}

fn is_density_descriptor(descriptor: &str) -> bool {
    let Some(number) = descriptor.strip_suffix('x') else {
        return false;
    };
    if let Some(fraction) = number.strip_prefix('.') {
        return !fraction.is_empty() && fraction.bytes().all(|byte| byte.is_ascii_digit());
    }
    let mut parts = number.split('.');
    let integer = parts.next().unwrap_or_default();
    let fraction = parts.next();
    !integer.is_empty()
        && integer.bytes().all(|byte| byte.is_ascii_digit())
        && fraction.is_none_or(|fraction| {
            !fraction.is_empty() && fraction.bytes().all(|byte| byte.is_ascii_digit())
        })
        && parts.next().is_none()
}
