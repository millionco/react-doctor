use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const BOTTOM_SHEET_MODULE_SOURCE: &str = "@gorhom/bottom-sheet";
const IGNORED_SCROLL_PROPERTY_NAMES: [&str; 3] = [
    "decelerationRate",
    "onScrollBeginDrag",
    "scrollEventThrottle",
];

#[derive(Debug, Default, Clone)]
pub struct RnBottomSheetNoIgnoredScrollProp;

declare_oxc_lint!(
    /// Disallow ignored BottomSheetScrollView props.
    RnBottomSheetNoIgnoredScrollProp,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow ignored BottomSheetScrollView props.",
);

impl Rule for RnBottomSheetNoIgnoredScrollProp {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_imported_jsx_component_name(opening_element, BOTTOM_SHEET_MODULE_SOURCE, ctx)
            != Some("BottomSheetScrollView")
        {
            return;
        }
        for attribute in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let JSXAttributeName::Identifier(identifier) = &attribute.name else {
                continue;
            };
            let property_name = identifier.name.as_str();
            if !IGNORED_SCROLL_PROPERTY_NAMES.contains(&property_name) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "BottomSheetScrollView ignores `{property_name}`, so this prop cannot affect scrolling. Remove it or handle the behavior outside the scrollable."
                ))
                .with_label(attribute.span),
            );
        }
    }
}
