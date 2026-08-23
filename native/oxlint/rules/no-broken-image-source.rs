use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::has_jsx_prop_ignore_case,
};

#[derive(Debug, Default, Clone)]
pub struct NoBrokenImageSource;

declare_oxc_lint!(
    /// Disallow images without a usable source.
    NoBrokenImageSource,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow images without a usable source.",
);

impl Rule for NoBrokenImageSource {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !matches!(
            &opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "img"
        ) || has_jsx_prop_ignore_case(opening_element, "ref").is_some()
        {
            return;
        }
        let Some(JSXAttributeItem::Attribute(source_attribute)) =
            has_jsx_prop_ignore_case(opening_element, "src")
        else {
            if opening_element
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
            {
                return;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(
                    "This image has no source and will render as a broken placeholder. Supply an asset or remove the element.",
                )
                .with_label(opening_element.span),
            );
            return;
        };
        if source_attribute.value.is_none() {
            ctx.diagnostic(
                OxcDiagnostic::warn(
                    "This image source is empty, so the browser cannot load an image.",
                )
                .with_label(source_attribute.span),
            );
            return;
        }
        if get_string_literal_attribute_value(source_attribute)
            .is_some_and(|source| matches!(source.trim(), "" | "#"))
        {
            ctx.diagnostic(
                OxcDiagnostic::warn(
                    "This placeholder source does not identify an image. Use a real asset URL or remove the image element.",
                )
                .with_label(source_attribute.span),
            );
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }
}
