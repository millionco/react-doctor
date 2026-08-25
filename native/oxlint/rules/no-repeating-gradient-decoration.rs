use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const CLASS_MESSAGE: &str = "This arbitrary repeating gradient acts as generic surface decoration. Replace it with a deliberate texture or plain fill.";
const STYLE_MESSAGE: &str = "This repeating gradient creates a generic decorative texture. Use a purposeful asset or simplify the surface.";
static REPEATING_GRADIENT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)repeating-(?:linear|radial|conic)-gradient\(");

#[derive(Debug, Default, Clone)]
pub struct NoRepeatingGradientDecoration;

declare_oxc_lint!(
    /// Disallow repeating-gradient decoration outside data visualizations.
    NoRepeatingGradientDecoration,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow repeating-gradient decoration outside data visualizations.",
);

impl Rule for NoRepeatingGradientDecoration {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if is_data_visualization_context(opening_element, node, ctx) {
            return;
        }
        if get_static_class_name(opening_element)
            .is_some_and(|class_name| REPEATING_GRADIENT_PATTERN.is_match(class_name))
        {
            ctx.diagnostic(OxcDiagnostic::warn(CLASS_MESSAGE).with_label(opening_element.span));
        }
        for attribute in &opening_element.attributes {
            let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let Some(style) = get_inline_style_object_expression(attribute) else {
                continue;
            };
            for property_name in ["background", "backgroundImage"] {
                let Some(property) = get_effective_static_style_property(style, property_name)
                else {
                    continue;
                };
                let Expression::StringLiteral(value) = &property.value else {
                    continue;
                };
                if REPEATING_GRADIENT_PATTERN.is_match(value.value.as_str()) {
                    ctx.diagnostic(OxcDiagnostic::warn(STYLE_MESSAGE).with_label(property.span));
                }
            }
        }
    }
}
