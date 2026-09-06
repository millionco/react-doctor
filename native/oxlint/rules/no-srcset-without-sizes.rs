use oxc_ast::{AstKind, ast::JSXAttributeItem};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule, utils::has_jsx_prop};

const MESSAGE: &str = "This responsive image supplies srcSet without sizes, so the browser assumes a 100vw slot and may download an unnecessarily large candidate. Describe its actual responsive width with sizes.";

#[derive(Debug, Default, Clone)]
pub struct NoSrcsetWithoutSizes;

declare_oxc_lint!(
    /// Require sizes for responsive width-descriptor images.
    NoSrcsetWithoutSizes,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Require sizes for responsive width-descriptor images.",
);

impl Rule for NoSrcsetWithoutSizes {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !resolve_jsx_element_type(opening_element, ctx)
            .is_some_and(|(element_type, _)| element_type == "img")
            || opening_element
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
            || has_jsx_prop(opening_element, "sizes").is_some()
        {
            return;
        }
        let Some(JSXAttributeItem::Attribute(source_set_attribute)) =
            has_jsx_prop(opening_element, "srcSet")
        else {
            return;
        };
        if get_string_literal_attribute_value(source_set_attribute)
            .is_some_and(has_width_descriptor)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(source_set_attribute.span));
        }
    }
}

fn has_width_descriptor(source_set: &str) -> bool {
    if source_set.contains("data:") {
        return false;
    }
    let mut has_width = false;
    for candidate in source_set.split(',') {
        let parts = candidate.split_whitespace().collect::<Vec<_>>();
        let descriptor = if parts.len() > 1 {
            parts.last().copied().unwrap_or_default()
        } else {
            ""
        };
        if descriptor.strip_suffix('w').is_some_and(|value| {
            !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
        }) {
            has_width = true;
        } else if !is_density_descriptor(descriptor) {
            return false;
        }
    }
    has_width
}

fn is_density_descriptor(descriptor: &str) -> bool {
    if descriptor.is_empty() {
        return true;
    }
    let Some(value) = descriptor.strip_suffix('x') else {
        return false;
    };
    let mut did_see_digit = false;
    let mut did_see_dot = false;
    for byte in value.bytes() {
        if byte.is_ascii_digit() {
            did_see_digit = true;
        } else if byte == b'.' && !did_see_dot {
            did_see_dot = true;
        } else {
            return false;
        }
    }
    did_see_digit && !value.ends_with('.')
}
