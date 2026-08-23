use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This is slow to render because you animate <svg> directly, so wrap it in a <div> or <motion.div> & animate that instead";
const MOTION_ANIMATION_PROPERTY_NAMES: [&str; 8] = [
    "animate",
    "initial",
    "exit",
    "whileHover",
    "whileTap",
    "whileFocus",
    "whileDrag",
    "whileInView",
];

#[derive(Debug, Default, Clone)]
pub struct RenderingAnimateSvgWrapper;

declare_oxc_lint!(
    /// Disallow Motion animation props directly on SVG elements.
    RenderingAnimateSvgWrapper,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow animation props directly on SVG elements.",
);

impl Rule for RenderingAnimateSvgWrapper {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type(opening_element, ctx)
            .is_none_or(|(element_name, _)| element_name != "svg")
            || !opening_element.attributes.iter().any(|attribute| {
                let JSXAttributeItem::Attribute(attribute) = attribute else {
                    return false;
                };
                matches!(
                    &attribute.name,
                    JSXAttributeName::Identifier(identifier)
                        if MOTION_ANIMATION_PROPERTY_NAMES.contains(&identifier.name.as_str())
                )
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}
